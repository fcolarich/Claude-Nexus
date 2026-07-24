import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { insertMemory, embedMemory, type MemoryInput } from './memories.js';
import { distillMemories, buildEligibleQuery, countEligible, resolveScope, type ResolvedScope } from './distill.js';

function freshDb() {
  const db = openDatabase(':memory:');
  initializeSchema(db);
  return db;
}

/** Unit vectors with controlled cosine: A·B = 0.78 (related band), C orthogonal. */
function unit(...pairs: [number, number][]): Float32Array {
  const v = new Float32Array(1024);
  for (const [i, x] of pairs) v[i] = x;
  return v;
}
const vecA = unit([0, 1]);
const vecB = unit([0, 0.78], [1, Math.sqrt(1 - 0.78 * 0.78)]);
const vecC = unit([2, 1]);

// Keyed on a marker substring so `title\nbody` and `body` resolve to the same vec.
const fakeEmbed = (text: string): Promise<Float32Array | null> =>
  Promise.resolve(text.includes('ALPHA') ? vecA : text.includes('BETA') ? vecB : vecC);

const fakeMerge = async () => JSON.stringify({
  title: 'Merged rule', body: 'consolidated body', memory_type: 'convention',
  scope: 'project', decay_class: 'stable', tags: ['x'],
});

const base: Omit<MemoryInput, 'title' | 'body'> = {
  memory_type: 'convention', scope: 'project', project: 'p', confidence: 0.8,
  decay_class: 'stable', review_status: 'approved',
  source_session_id: null, discovered_from: null, tags: [], promotion_target: 'none',
};
const liveCount = (db: ReturnType<typeof freshDb>) =>
  (db.prepare(`SELECT COUNT(*) c FROM memories WHERE superseded_by IS NULL`).get() as { c: number }).c;

describe('distillMemories', () => {
  it('clusters related memories and merges each cluster into one', async () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'One', body: 'ALPHA first phrasing', confidence: 0.9 });
    insertMemory(db, { ...base, title: 'Two', body: 'BETA second phrasing', confidence: 0.7 });
    insertMemory(db, { ...base, title: 'Three', body: 'GAMMA unrelated thing' });

    const r = await distillMemories(db, undefined, fakeEmbed, fakeMerge);
    expect(r.clusters).toBe(1);
    expect(r.created).toBe(1);
    expect(r.merged).toBe(2);
    expect(liveCount(db)).toBe(2);  // the unrelated memory + the new merged one
    db.close();
  });

  it('leaves unrelated memories untouched', async () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'A', body: 'ALPHA only' });
    insertMemory(db, { ...base, title: 'C', body: 'GAMMA only' });

    const r = await distillMemories(db, undefined, fakeEmbed, fakeMerge);
    expect(r.clusters).toBe(0);
    expect(r.merged).toBe(0);
    expect(liveCount(db)).toBe(2);
    db.close();
  });
});

describe('distillMemories — scoped/limited pool + accounting', () => {
  it('pool never exceeds limit regardless of total rows (SC-3)', async () => {
    const db = freshDb();
    for (let i = 0; i < 10; i++) {
      insertMemory(db, { ...base, title: `M${i}`, body: `GAMMA row ${i}` });
    }
    const r = await distillMemories(db, { limit: 3 }, fakeEmbed, fakeMerge);
    expect(r.processed).toBeLessThanOrEqual(3);
    db.close();
  });

  it('only project-matching rows are eligible under a project scope (SC-4)', async () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'A1', body: 'ALPHA in proj-a', project: 'proj-a' });
    insertMemory(db, { ...base, title: 'A2', body: 'BETA in proj-a', project: 'proj-a' });
    insertMemory(db, { ...base, title: 'B1', body: 'ALPHA in proj-b', project: 'proj-b' });

    const r = await distillMemories(db, { project: 'proj-a' }, fakeEmbed, fakeMerge);
    expect(r.processed).toBe(2);
    // cross-project memory untouched: still live, not superseded
    const row = db.prepare(`SELECT superseded_by FROM memories WHERE title = 'B1'`).get() as { superseded_by: string | null };
    expect(row.superseded_by).toBeNull();
    db.close();
  });

  it('processed/scope/eligibleRemaining are correct for a small scenario', async () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'X1', body: 'GAMMA one', project: 'proj-x' });
    insertMemory(db, { ...base, title: 'X2', body: 'GAMMA two', project: 'proj-x' });
    insertMemory(db, { ...base, title: 'X3', body: 'GAMMA three', project: 'proj-x' });

    const r = await distillMemories(db, { project: 'proj-x', limit: 2 }, fakeEmbed, fakeMerge);
    expect(r.processed).toBe(2);
    expect(r.scope).toBe('proj-x');
    expect(r.eligibleRemaining).toBe(1);
    db.close();
  });

  it('empty/non-matching scope returns a clean zero result without throwing or hanging', async () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'Only', body: 'GAMMA thing', project: 'proj-real' });

    let embedCalls = 0;
    let callCalls = 0;
    const countingEmbed = async (t: string) => { embedCalls++; return fakeEmbed(t); };
    const countingCall = async () => { callCalls++; return fakeMerge(); };

    const r = await distillMemories(db, { project: 'no-such-project' }, countingEmbed, countingCall);
    expect(r.processed).toBe(0);
    expect(r.eligibleRemaining).toBe(0);
    // embedUnindexedMemories may still call embedFn to index the seeded row;
    // the clustering loop itself must make zero additional calls beyond that.
    expect(callCalls).toBe(0);
    db.close();
  });

  it('limit normalization: 0/negative defaults to 200 (still processes seeded rows)', async () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'N1', body: 'GAMMA n1' });
    insertMemory(db, { ...base, title: 'N2', body: 'GAMMA n2' });

    const r = await distillMemories(db, { limit: 0 }, fakeEmbed, fakeMerge);
    expect(r.processed).toBe(2);
    db.close();
  });

  it('limit normalization: huge limit clamps to 500, matching eligible count for a small set', async () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'H1', body: 'GAMMA h1' });
    insertMemory(db, { ...base, title: 'H2', body: 'GAMMA h2' });

    const r = await distillMemories(db, { limit: 9999 }, fakeEmbed, fakeMerge);
    expect(r.processed).toBe(2);
    expect(r.eligibleRemaining).toBe(0);
    db.close();
  });

  it('limit normalization: fractional value in (0,1) clamps to minimum 1, not 0', async () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'F1', body: 'GAMMA f1' });
    insertMemory(db, { ...base, title: 'F2', body: 'GAMMA f2' });

    const r = await distillMemories(db, { limit: 0.5 }, fakeEmbed, fakeMerge);
    expect(r.processed).toBe(1);
    expect(r.eligibleRemaining).toBe(1);
    db.close();
  });
});

describe('distillMemories — embedding reuse (loadStoredVector)', () => {
  it('reuses stored vectors instead of re-embedding already-indexed memories (SC-2)', async () => {
    const db = freshDb();
    const ids: string[] = [];
    // Same vector (GAMMA) on all three -> similarity ~1.0, above the related
    // band's high end, so nothing clusters; isolates the reuse assertion.
    for (const body of ['GAMMA row 1', 'GAMMA row 2', 'GAMMA row 3']) {
      const { id } = insertMemory(db, { ...base, title: body, body });
      ids.push(id);
    }
    // Pre-populate memories_vec so embedUnindexedMemories has nothing to do.
    for (const id of ids) await embedMemory(db, id, fakeEmbed);

    let embedCalls = 0;
    const spyEmbed = async (t: string) => { embedCalls++; return fakeEmbed(t); };

    const r = await distillMemories(db, undefined, spyEmbed, fakeMerge);
    expect(r.embedded).toBe(0); // nothing left unindexed for embedUnindexedMemories
    expect(embedCalls).toBe(0); // clustering loop reused memories_vec, no embedFn fallback
    db.close();
  });

  it('falls back to embedFn when a memory has no stored vector (vector miss)', async () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'NoVec', body: 'GAMMA solo' });

    let call = 0;
    // First call (embedUnindexedMemories) fails -> no row lands in memories_vec,
    // so the clustering loop's loadStoredVector genuinely misses and must retry.
    const flaky = async (t: string): Promise<Float32Array | null> => {
      call++;
      return call === 1 ? null : fakeEmbed(t);
    };

    await distillMemories(db, undefined, flaky, fakeMerge);
    expect(call).toBeGreaterThanOrEqual(2); // embedUnindexedMemories miss, then the loop's fallback call
    db.close();
  });
});

describe('distillMemories — dryRun short-circuit (SC-5)', () => {
  it('dryRun: true makes zero embedFn/callFn calls and returns populated counts', async () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'D1', body: 'GAMMA one', project: 'proj-d' });
    insertMemory(db, { ...base, title: 'D2', body: 'GAMMA two', project: 'proj-d' });
    insertMemory(db, { ...base, title: 'D3', body: 'GAMMA three', project: 'proj-d' });

    let embedCalls = 0;
    let callCalls = 0;
    const spyEmbed = async (t: string) => { embedCalls++; return fakeEmbed(t); };
    const spyCall = async () => { callCalls++; return fakeMerge(); };

    const r = await distillMemories(db, { project: 'proj-d', limit: 2, dryRun: true }, spyEmbed, spyCall);

    expect(embedCalls).toBe(0);
    expect(callCalls).toBe(0);
    expect(r.dryRun).toBe(true);
    expect(r.embedded).toBe(0);
    expect(r.clusters).toBe(0);
    expect(r.merged).toBe(0);
    expect(r.created).toBe(0);
    expect(r.sanitized).toBe(0);
    expect(r.scope).toBe('proj-d');
    expect(r.processed).toBe(2);
    expect(r.eligibleRemaining).toBe(1);
    db.close();
  });

  it('dry_run with unindexed memories: never calls embedUnindexedMemories, embedded reports 0', async () => {
    const db = freshDb();
    // No embedMemory() call here -> memories_vec has no row for this memory,
    // which would normally trigger embedUnindexedMemories on a real run.
    insertMemory(db, { ...base, title: 'Unindexed', body: 'GAMMA unindexed', project: 'proj-e' });

    let embedCalls = 0;
    const spyEmbed = async (t: string) => { embedCalls++; return fakeEmbed(t); };

    const r = await distillMemories(db, { project: 'proj-e', dryRun: true }, spyEmbed, fakeMerge);

    expect(embedCalls).toBe(0);
    expect(r.embedded).toBe(0);
    expect(r.processed).toBe(1);
    expect(r.eligibleRemaining).toBe(0);
    db.close();
  });
});

describe('distillMemories — sanitize bound (7)', () => {
  it('sanitize pass only touches the scoped/limited pool; out-of-scope oversized memories are untouched', async () => {
    const db = freshDb();
    // Distinct bodies -> distinct content-hash ids (insertMemory derives id from
    // memory_type+body via computeMemoryId + INSERT OR IGNORE); identical bodies
    // would collapse both inserts onto the same row.
    const longBodyA = 'GAMMA InScope '.repeat(60); // > SANITIZE_OVER_CHARS (800)
    const longBodyB = 'GAMMA OutScope '.repeat(60); // > SANITIZE_OVER_CHARS (800)
    const inScope = insertMemory(db, { ...base, title: 'InScope', body: longBodyA, project: 'proj-a' });
    const outScope = insertMemory(db, { ...base, title: 'OutScope', body: longBodyB, project: 'proj-b' });

    const calls: string[] = [];
    const spyCall = async (_system: string, user: string) => {
      calls.push(user);
      return JSON.stringify({ title: 'Tight', body: 'short tightened body' });
    };

    const r = await distillMemories(db, { project: 'proj-a' }, fakeEmbed, spyCall);

    // In-scope oversized memory was sanitized; the out-of-scope one was never
    // passed to callFn at all.
    expect(r.sanitized).toBeGreaterThan(0);
    expect(calls.some(c => c.includes('OutScope'))).toBe(false);

    const inRow = db.prepare(`SELECT body FROM memories WHERE id = ?`).get(inScope.id) as { body: string };
    const outRow = db.prepare(`SELECT body FROM memories WHERE id = ?`).get(outScope.id) as { body: string };
    expect(inRow.body).not.toBe(longBodyA);
    expect(outRow.body).toBe(longBodyB);

    db.close();
  });
});

describe('distillMemories — backward-compat regression (10, SC-6)', () => {
  it('unscoped distillMemories(db) on a small (<200) set preserves clustering/merge/sanitize/supersede/link bookkeeping unchanged, default scope resolves to "all", default limit does not alter the outcome', async () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'One', body: 'ALPHA first phrasing', confidence: 0.9 });
    insertMemory(db, { ...base, title: 'Two', body: 'BETA second phrasing', confidence: 0.7 });
    insertMemory(db, { ...base, title: 'Three', body: 'GAMMA unrelated thing' });

    const r = await distillMemories(db, undefined, fakeEmbed, fakeMerge);

    // Byte-identical bookkeeping to the pre-chunking behavior (same seed/assertions
    // as the original 'clusters related memories...' test at the top of this file).
    expect(r.clusters).toBe(1);
    expect(r.created).toBe(1);
    expect(r.merged).toBe(2);
    expect(liveCount(db)).toBe(2); // the unrelated memory + the new merged one

    // Default scope/limit resolution, proven on a set well under the 200 default.
    expect(r.scope).toBe('all');
    expect(r.processed).toBe(3); // all 3 seeded memories considered — default limit didn't truncate

    // Supersede + link bookkeeping, not just counts: the two merged originals
    // ('One' and 'Two') must now point at the new merged memory, with a matching
    // 'refines' link row from the new memory back to each original.
    const mergedRow = db.prepare(
      `SELECT id FROM memories WHERE superseded_by IS NULL AND title != 'Three'`
    ).get() as { id: string } | undefined;
    expect(mergedRow).toBeTruthy();
    const newId = mergedRow!.id;

    const originals = db.prepare(
      `SELECT id, superseded_by FROM memories WHERE title IN ('One', 'Two')`
    ).all() as { id: string; superseded_by: string | null }[];
    expect(originals).toHaveLength(2);
    for (const o of originals) expect(o.superseded_by).toBe(newId);

    const links = db.prepare(
      `SELECT source_id, target_id, link_type FROM memory_links WHERE source_id = ? AND link_type = 'refines'`
    ).all(newId) as { source_id: string; target_id: string; link_type: string }[];
    const linkedTargets = links.map(l => l.target_id).sort();
    expect(linkedTargets).toEqual(originals.map(o => o.id).sort());

    db.close();
  });
});

describe('buildEligibleQuery', () => {
  it('project scope filters by project column and appends LIMIT :limit', () => {
    const scope: ResolvedScope = { kind: 'project', slug: 'my-proj' };
    const { sql, params } = buildEligibleQuery(scope, 200);
    expect(sql).toBe(
      `SELECT * FROM memories WHERE project = :slug AND scope != 'global' AND superseded_by IS NULL AND review_status != 'rejected' ORDER BY confidence DESC, created_at ASC LIMIT :limit`
    );
    expect(sql).toContain(`scope != 'global'`);
    expect(params).toEqual({ slug: 'my-proj', limit: 200 });
  });

  it('global scope filters by scope column, no project param, appends LIMIT :limit', () => {
    const scope: ResolvedScope = { kind: 'global' };
    const { sql, params } = buildEligibleQuery(scope, 50);
    expect(sql).toBe(
      `SELECT * FROM memories WHERE scope = 'global' AND superseded_by IS NULL AND review_status != 'rejected' ORDER BY confidence DESC, created_at ASC LIMIT :limit`
    );
    expect(params).toEqual({ limit: 50 });
  });

  it('all scope has no project/scope filter, appends LIMIT :limit', () => {
    const scope: ResolvedScope = { kind: 'all' };
    const { sql, params } = buildEligibleQuery(scope, 500);
    expect(sql).toBe(
      `SELECT * FROM memories WHERE superseded_by IS NULL AND review_status != 'rejected' ORDER BY confidence DESC, created_at ASC LIMIT :limit`
    );
    expect(params).toEqual({ limit: 500 });
  });
});

describe('countEligible', () => {
  it('never prepares a SQL statement containing LIMIT, for any scope kind', () => {
    const db = freshDb();
    const seenSql: string[] = [];
    const realPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => { seenSql.push(sql); return realPrepare(sql); }) as typeof db.prepare;

    countEligible(db, { kind: 'project', slug: 'proj-a' });
    countEligible(db, { kind: 'global' });
    countEligible(db, { kind: 'all' });

    expect(seenSql.length).toBeGreaterThan(0);
    for (const sql of seenSql) expect(sql.toUpperCase()).not.toContain('LIMIT');
    db.prepare = realPrepare;
    db.close();
  });

  it('computes eligible counts matching the scope filter', () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'P1', body: 'a', project: 'proj-a' });
    insertMemory(db, { ...base, title: 'P2', body: 'b', project: 'proj-a' });
    insertMemory(db, { ...base, title: 'Other', body: 'c', project: 'proj-b' });
    insertMemory(db, { ...base, title: 'G1', body: 'd', project: 'proj-a', scope: 'global' });

    expect(countEligible(db, { kind: 'project', slug: 'proj-a' })).toBe(2); // excludes the scope='global' row
    expect(countEligible(db, { kind: 'global' })).toBe(1);
    expect(countEligible(db, { kind: 'all' })).toBe(4);
    db.close();
  });

  it('excludes superseded and rejected rows from the count', () => {
    const db = freshDb();
    const a = insertMemory(db, { ...base, title: 'Live', body: 'a', project: 'proj-a' });
    insertMemory(db, { ...base, title: 'Rejected', body: 'b', project: 'proj-a', review_status: 'rejected' });
    const superseded = insertMemory(db, { ...base, title: 'ToSupersede', body: 'c', project: 'proj-a' });
    db.prepare(`UPDATE memories SET superseded_by = ? WHERE id = ?`).run(a.id, superseded.id);

    expect(countEligible(db, { kind: 'project', slug: 'proj-a' })).toBe(1);
    db.close();
  });

  it('project and global scopes are disjoint', () => {
    const db = freshDb();
    insertMemory(db, { ...base, title: 'ProjOnly', body: 'a', project: 'proj-a', scope: 'project' });
    insertMemory(db, { ...base, title: 'GlobalOnly', body: 'b', project: 'proj-a', scope: 'global' });

    expect(countEligible(db, { kind: 'project', slug: 'proj-a' })).toBe(1); // excludes the scope='global' row
    expect(countEligible(db, { kind: 'global' })).toBe(1); // only the scope='global' row
    db.close();
  });
});

describe('resolveScope', () => {
  it('project set -> project scope with that slug', () => {
    const db = freshDb();
    expect(resolveScope(db, { project: 'my-proj' })).toEqual({ kind: 'project', slug: 'my-proj' });
    db.close();
  });

  it('project: "global" -> global scope', () => {
    const db = freshDb();
    expect(resolveScope(db, { project: 'global' })).toEqual({ kind: 'global' });
    db.close();
  });

  it('project wins over cwd when both set', () => {
    const db = freshDb();
    expect(resolveScope(db, { project: 'my-proj', cwd: '/some/unrelated/path' })).toEqual({ kind: 'project', slug: 'my-proj' });
    db.close();
  });

  it('only cwd set -> derives a project slug via resolveProjectFromCwd', () => {
    const db = freshDb();
    const result = resolveScope(db, { cwd: '/home/user/my-project' });
    expect(result.kind).toBe('project');
    expect((result as { kind: 'project'; slug: string }).slug.length).toBeGreaterThan(0);
    db.close();
  });

  it('neither project nor cwd set -> all scope', () => {
    const db = freshDb();
    expect(resolveScope(db, undefined)).toEqual({ kind: 'all' });
    expect(resolveScope(db, {})).toEqual({ kind: 'all' });
    db.close();
  });

  it('cwd resolves to a short-name slug when only that slug has memories stored (falls back like nexus_backfill/nexus_search)', () => {
    const db = freshDb();
    // Memories stored under the short-name slug only — no row under the full git-root-derived slug.
    insertMemory(db, { ...base, title: 'ShortSlug', body: 'b', project: 'my-project' });

    const result = resolveScope(db, { cwd: '/home/user/my-project' });
    expect(result).toEqual({ kind: 'project', slug: 'my-project' });
    db.close();
  });
});
