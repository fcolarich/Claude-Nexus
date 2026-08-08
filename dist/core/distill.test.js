import { describe, it, expect } from 'vitest';
import { openDatabase, initializeSchema } from './database.js';
import { insertMemory, embedMemory } from './memories.js';
import { distillMemories, buildEligibleQuery, countEligible, cursorClause, coverageShortfall, hasEscapeDamage, resolveScope } from './distill.js';
function freshDb() {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    return db;
}
/** Unit vectors with controlled cosine: A·B = 0.78 (related band), C orthogonal. */
function unit(...pairs) {
    const v = new Float32Array(1024);
    for (const [i, x] of pairs)
        v[i] = x;
    return v;
}
const vecA = unit([0, 1]);
const vecB = unit([0, 0.78], [1, Math.sqrt(1 - 0.78 * 0.78)]);
const vecC = unit([2, 1]);
// Keyed on a marker substring so `title\nbody` and `body` resolve to the same vec.
const fakeEmbed = (text) => Promise.resolve(text.includes('ALPHA') ? vecA : text.includes('BETA') ? vecB : vecC);
// Body carries ALPHA so the merge embeds to vecA — cosine 1.0 to an ALPHA source
// and 0.78 to a BETA one, both clearing MERGE_COVERAGE_FLOOR. A markerless body
// would embed to vecC, orthogonal to its own sources, and the coverage gate would
// (rightly) reject it as a merge that abandoned everything it folded in.
const fakeMerge = async () => JSON.stringify({
    title: 'Merged rule', body: 'ALPHA consolidated body', memory_type: 'convention',
    scope: 'project', decay_class: 'stable', tags: ['x'],
});
const base = {
    memory_type: 'convention', scope: 'project', project: 'p', confidence: 0.8,
    decay_class: 'stable', review_status: 'approved',
    source_session_id: null, discovered_from: null, tags: [], promotion_target: 'none',
};
const liveCount = (db) => db.prepare(`SELECT COUNT(*) c FROM memories WHERE superseded_by IS NULL`).get().c;
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
        expect(liveCount(db)).toBe(2); // the unrelated memory + the new merged one
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
describe('distillMemories — Phase 1: identifier set-union on merge', () => {
    it('merged memory carries every source identifier even when the merge prose drops them', async () => {
        const db = freshDb();
        // Sources carry code-like identifiers in their bodies (auto-extracted at insert time).
        insertMemory(db, { ...base, title: 'One', body: 'ALPHA uses src/core/distill.ts and MERGE_COVERAGE_FLOOR', confidence: 0.9 });
        insertMemory(db, { ...base, title: 'Two', body: 'BETA also touches src/core/memories.ts and ADR-018', confidence: 0.7 });
        // fakeMerge's prose ("ALPHA consolidated body") reproduces none of those identifiers —
        // the exact failure mode this design eliminates structurally.
        const r = await distillMemories(db, undefined, fakeEmbed, fakeMerge);
        expect(r.created).toBe(1);
        const merged = db.prepare(`SELECT identifiers FROM memories WHERE superseded_by IS NULL AND identifiers != '[]'`).get();
        expect(merged).toBeDefined();
        const ids = JSON.parse(merged.identifiers);
        expect(ids).toContain('src/core/distill.ts');
        expect(ids).toContain('MERGE_COVERAGE_FLOOR');
        expect(ids).toContain('src/core/memories.ts');
        expect(ids).toContain('ADR-018');
        db.close();
    });
    it('supersedes originals but preserves their identifiers row (recoverable via rollback)', async () => {
        const db = freshDb();
        const a = insertMemory(db, { ...base, title: 'One', body: 'ALPHA first src/core/distill.ts', confidence: 0.9 });
        insertMemory(db, { ...base, title: 'Two', body: 'BETA second src/core/memories.ts', confidence: 0.7 });
        await distillMemories(db, undefined, fakeEmbed, fakeMerge);
        const original = db.prepare(`SELECT identifiers, superseded_by FROM memories WHERE id = ?`).get(a.id);
        expect(original.superseded_by).not.toBeNull();
        expect(JSON.parse(original.identifiers)).toContain('src/core/distill.ts');
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
        const row = db.prepare(`SELECT superseded_by FROM memories WHERE title = 'B1'`).get();
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
        const countingEmbed = async (t) => { embedCalls++; return fakeEmbed(t); };
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
describe('distillMemories — sweep cursor across successive runs', () => {
    // All bodies carry the GAMMA marker -> identical vectors -> similarity 1.0,
    // above the related band. Nothing clusters, so these tests isolate the cursor.
    const markedIds = (db) => db.prepare(`SELECT id FROM memories WHERE distilled_at IS NOT NULL ORDER BY id`).all().map(r => r.id);
    it('two successive runs with a limit smaller than the eligible pool examine disjoint candidate sets', async () => {
        const db = freshDb();
        // > SANITIZE_OVER_CHARS (800) so every candidate reaches the sanitize call,
        // giving an independent record of what each run actually looked at.
        for (let i = 0; i < 6; i++) {
            insertMemory(db, { ...base, title: `C${i}`, body: `GAMMA c${i} `.repeat(100), project: 'proj-cursor' });
        }
        let seen = [];
        const spyCall = async (_system, user) => {
            seen.push(user);
            return JSON.stringify({ title: 'Tight', body: 'tightened' });
        };
        const titlesSeen = () => new Set(seen.flatMap(u => u.match(/\bC\d\b/g) ?? []));
        seen = [];
        const r1 = await distillMemories(db, { project: 'proj-cursor', limit: 3 }, fakeEmbed, spyCall);
        const first = titlesSeen();
        const markedAfterFirst = markedIds(db);
        seen = [];
        const r2 = await distillMemories(db, { project: 'proj-cursor', limit: 3 }, fakeEmbed, spyCall);
        const second = titlesSeen();
        expect(r1.processed).toBe(3);
        expect(r2.processed).toBe(3);
        expect(first.size).toBe(3);
        expect(second.size).toBe(3);
        expect([...first].filter(t => second.has(t))).toEqual([]); // disjoint
        expect(new Set([...first, ...second]).size).toBe(6); // together they cover the whole pool
        // The cursor itself, not just the LLM traffic: run 2 marked 3 rows that run 1 had not.
        expect(markedAfterFirst).toHaveLength(3);
        expect(markedIds(db)).toHaveLength(6);
        db.close();
    });
    it('eligibleRemaining decreases monotonically to 0 across a full sweep', async () => {
        const db = freshDb();
        for (let i = 0; i < 7; i++) {
            insertMemory(db, { ...base, title: `S${i}`, body: `GAMMA sweep ${i}`, project: 'proj-sweep' });
        }
        const remaining = [];
        let totalProcessed = 0;
        for (let guard = 0; guard < 20; guard++) {
            const r = await distillMemories(db, { project: 'proj-sweep', limit: 2 }, fakeEmbed, fakeMerge);
            totalProcessed += r.processed;
            remaining.push(r.eligibleRemaining);
            if (r.eligibleRemaining === 0)
                break;
        }
        expect(remaining).toEqual([5, 3, 1, 0]);
        for (let i = 1; i < remaining.length; i++)
            expect(remaining[i]).toBeLessThan(remaining[i - 1]);
        expect(totalProcessed).toBe(7); // every memory examined exactly once
        db.close();
    });
    it('a fully swept scope stays at 0 on re-invocation, and `since` re-opens it', async () => {
        const db = freshDb();
        for (let i = 0; i < 3; i++) {
            insertMemory(db, { ...base, title: `R${i}`, body: `GAMMA reopen ${i}`, project: 'proj-reopen' });
        }
        const swept = await distillMemories(db, { project: 'proj-reopen' }, fakeEmbed, fakeMerge);
        expect(swept.processed).toBe(3);
        expect(swept.eligibleRemaining).toBe(0);
        let callCalls = 0;
        const countingCall = async () => { callCalls++; return fakeMerge(); };
        const noop = await distillMemories(db, { project: 'proj-reopen' }, fakeEmbed, countingCall);
        expect(noop.processed).toBe(0);
        expect(noop.eligibleRemaining).toBe(0);
        expect(callCalls).toBe(0); // no LLM spend once the scope is swept
        // Backdate the cursor, then sweep again with a cutoff after it. The re-stamp
        // uses "now", which is not < the cutoff, so the new sweep still terminates.
        db.prepare(`UPDATE memories SET distilled_at = '2019-01-01 00:00:00' WHERE project = 'proj-reopen'`).run();
        const reopened = await distillMemories(db, { project: 'proj-reopen', since: '2020-01-01 00:00:00' }, fakeEmbed, fakeMerge);
        expect(reopened.processed).toBe(3);
        expect(reopened.eligibleRemaining).toBe(0);
        db.close();
    });
    it('the cursor advances even for candidates that produce no cluster (clusters == 0 is not a stop signal)', async () => {
        const db = freshDb();
        for (let i = 0; i < 4; i++) {
            insertMemory(db, { ...base, title: `N${i}`, body: `GAMMA nocluster ${i}`, project: 'proj-nocluster' });
        }
        const r1 = await distillMemories(db, { project: 'proj-nocluster', limit: 2 }, fakeEmbed, fakeMerge);
        expect(r1.clusters).toBe(0);
        expect(r1.eligibleRemaining).toBe(2); // work remains despite a zero-cluster run
        const r2 = await distillMemories(db, { project: 'proj-nocluster', limit: 2 }, fakeEmbed, fakeMerge);
        expect(r2.processed).toBe(2);
        expect(r2.eligibleRemaining).toBe(0);
        db.close();
    });
    it('dryRun projects the post-run remainder without advancing the cursor', async () => {
        const db = freshDb();
        for (let i = 0; i < 5; i++) {
            insertMemory(db, { ...base, title: `P${i}`, body: `GAMMA preview ${i}`, project: 'proj-preview' });
        }
        const preview = await distillMemories(db, { project: 'proj-preview', limit: 2, dryRun: true }, fakeEmbed, fakeMerge);
        expect(preview.processed).toBe(2);
        expect(preview.eligibleRemaining).toBe(3);
        expect(markedIds(db)).toEqual([]); // nothing consumed
        const real = await distillMemories(db, { project: 'proj-preview', limit: 2 }, fakeEmbed, fakeMerge);
        expect(real.processed).toBe(2);
        expect(real.eligibleRemaining).toBe(3); // the dry run's projection held
        db.close();
    });
});
describe('countEligible — cursor awareness', () => {
    it('excludes rows already marked distilled, and re-includes them under a `since` cutoff', () => {
        const db = freshDb();
        insertMemory(db, { ...base, title: 'E1', body: 'a', project: 'proj-a' });
        const done = insertMemory(db, { ...base, title: 'E2', body: 'b', project: 'proj-a' });
        db.prepare(`UPDATE memories SET distilled_at = '2019-01-01 00:00:00' WHERE id = ?`).run(done.id);
        expect(countEligible(db, { kind: 'project', slug: 'proj-a' })).toBe(1);
        expect(countEligible(db, { kind: 'project', slug: 'proj-a' }, '2020-01-01 00:00:00')).toBe(2);
        db.close();
    });
});
describe('distillMemories — merge coverage gate', () => {
    // ALPHA/BETA cluster (cosine 0.78, inside the related band). What varies per
    // test is the vector the MERGE lands on, keyed off its body text.
    const seedCluster = (db) => {
        insertMemory(db, { ...base, title: 'One', body: 'ALPHA first phrasing', confidence: 0.9 });
        insertMemory(db, { ...base, title: 'Two', body: 'BETA second phrasing', confidence: 0.7 });
    };
    it('rejects a merge that drifts away from one of its sources, leaving both originals live', async () => {
        const db = freshDb();
        seedCluster(db);
        // Merge body carries no ALPHA/BETA marker -> vecC, orthogonal to both sources.
        const driftingMerge = async () => JSON.stringify({
            title: 'Drifted', body: 'GAMMA unrelated consolidation', memory_type: 'convention',
            scope: 'project', decay_class: 'stable', tags: [],
        });
        const r = await distillMemories(db, undefined, fakeEmbed, driftingMerge);
        expect(r.clusters).toBe(1);
        expect(r.rejected).toBe(1);
        expect(r.created).toBe(0);
        expect(r.merged).toBe(0);
        // Both originals still live and unsuperseded — nothing was destroyed.
        const live = db.prepare(`SELECT title FROM memories WHERE superseded_by IS NULL ORDER BY title`).all();
        expect(live.map(l => l.title)).toEqual(['One', 'Two']);
        // The rejected merge left no row behind.
        const drifted = db.prepare(`SELECT id FROM memories WHERE title = 'Drifted'`).get();
        expect(drifted).toBeUndefined();
        db.close();
    });
    it('accepts a merge that stays close to its sources', async () => {
        const db = freshDb();
        seedCluster(db);
        // Merge body carries ALPHA -> vecA: cosine 1.0 to 'One', 0.78 to 'Two',
        // both at/above the 0.72 floor.
        const faithfulMerge = async () => JSON.stringify({
            title: 'Merged rule', body: 'ALPHA consolidated body', memory_type: 'convention',
            scope: 'project', decay_class: 'stable', tags: [],
        });
        const r = await distillMemories(db, undefined, fakeEmbed, faithfulMerge);
        expect(r.rejected).toBe(0);
        expect(r.created).toBe(1);
        expect(r.merged).toBe(2);
        db.close();
    });
    it('a rejected merge does not consume its sources — a later run can retry them', async () => {
        const db = freshDb();
        seedCluster(db);
        const driftingMerge = async () => JSON.stringify({
            title: 'Drifted', body: 'GAMMA unrelated consolidation', memory_type: 'convention',
            scope: 'project', decay_class: 'stable', tags: [],
        });
        await distillMemories(db, undefined, fakeEmbed, driftingMerge);
        const rows = db.prepare(`SELECT title, distilled_at, superseded_by FROM memories ORDER BY title`).all();
        expect(rows).toHaveLength(2);
        // The guarantee that matters: neither original was consumed.
        for (const row of rows)
            expect(row.superseded_by).toBeNull();
        // 'One' (confidence 0.9) led the cluster, so it is stamped — the work was
        // genuinely done and the verdict was "these should not merge". Re-examining
        // it would just buy the same rejection again on every future sweep.
        expect(rows.find(r => r.title === 'One').distilled_at).not.toBeNull();
        // 'Two' was only pulled in as a member, so it stays eligible and may lead a
        // different cluster later.
        expect(rows.find(r => r.title === 'Two').distilled_at).toBeNull();
        db.close();
    });
});
describe('distillMemories — backend failure does not burn the cursor', () => {
    // Each pair gets its OWN vector direction (dimensions 2i / 2i+1) at cosine 0.78
    // to its partner and orthogonal to every other pair. The shared vecA/vecB
    // fixture cannot be used here: with many memories collapsed onto two
    // directions, relatedMemories' KNN (LIMIT 12) truncates before reaching the
    // same-project partner and most pairs never cluster at all.
    const pairEmbed = (text) => {
        const i = Number(text.match(/phrasing (\d+)/)?.[1] ?? 0);
        const v = new Float32Array(1024);
        if (text.includes('ALPHA'))
            v[i * 2] = 1;
        else {
            v[i * 2] = 0.78;
            v[i * 2 + 1] = Math.sqrt(1 - 0.78 * 0.78);
        }
        return Promise.resolve(v);
    };
    const seedPairs = (db, n) => {
        for (let i = 0; i < n; i++) {
            insertMemory(db, { ...base, project: `p${i}`, title: `A${i}`, body: `ALPHA phrasing ${i}`, confidence: 0.9 });
            insertMemory(db, { ...base, project: `p${i}`, title: `B${i}`, body: `BETA phrasing ${i}`, confidence: 0.7 });
        }
    };
    it('a dead backend aborts the run and leaves every candidate re-examinable', async () => {
        const db = freshDb();
        seedPairs(db, 8);
        let calls = 0;
        const deadBackend = async () => { calls++; return ''; }; // what callModel returns on failure
        const r = await distillMemories(db, undefined, pairEmbed, deadBackend);
        expect(r.backendFailed).toBe(true);
        expect(r.created).toBe(0);
        expect(r.merged).toBe(0);
        // Gave up after the abort threshold instead of grinding through all 8 clusters.
        expect(calls).toBeLessThanOrEqual(5);
        // The cursor did NOT advance: nothing was genuinely examined.
        const stamped = db.prepare(`SELECT COUNT(*) c FROM memories WHERE distilled_at IS NOT NULL`).get();
        expect(stamped.c).toBe(0);
        // And the work is still queued rather than silently skipped.
        expect(r.eligibleRemaining).toBe(16);
        db.close();
    });
    it('an isolated bad response un-stamps only that cluster and the run continues', async () => {
        const db = freshDb();
        seedPairs(db, 4);
        let calls = 0;
        // First cluster returns junk, the rest merge fine — a transient hiccup, not an outage.
        // Bodies must differ per call: insertMemory derives the id from memory_type +
        // body, so identical merge text would collapse all three onto one row.
        const flaky = async () => {
            calls++;
            return calls === 1 ? 'not json at all' : JSON.stringify({
                title: `Merged ${calls}`, body: `ALPHA consolidated ${calls}`, memory_type: 'convention',
                scope: 'project', decay_class: 'stable', tags: [],
            });
        };
        const r = await distillMemories(db, undefined, pairEmbed, flaky);
        // One bad response is not an outage: the run kept going.
        expect(r.backendFailed).toBe(false);
        expect(calls).toBe(4); // all 4 clusters still attempted
        expect(r.created + r.rejected).toBe(3); // the 3 after the bad one were processed
        // The failed cluster's members were handed back — still live, still eligible.
        const failedPair = db.prepare(`SELECT distilled_at, superseded_by FROM memories WHERE title IN ('A0','B0')`).all();
        expect(failedPair).toHaveLength(2);
        for (const row of failedPair) {
            expect(row.distilled_at).toBeNull();
            expect(row.superseded_by).toBeNull();
        }
        db.close();
    });
    it('a dead EMBEDDING backend also aborts without consuming candidates', async () => {
        const db = freshDb();
        seedPairs(db, 8);
        // Vectors never land in memories_vec, so the clustering loop's loadStoredVector
        // misses and its embedFn fallback fails too — the shape of an Ollama outage.
        const deadEmbed = async () => null;
        let merges = 0;
        const countingMerge = async () => { merges++; return fakeMerge(); };
        const r = await distillMemories(db, undefined, deadEmbed, countingMerge);
        expect(r.backendFailed).toBe(true);
        expect(merges).toBe(0); // never got far enough to attempt a merge
        const stamped = db.prepare(`SELECT COUNT(*) c FROM memories WHERE distilled_at IS NOT NULL`).get();
        expect(stamped.c).toBe(0);
        expect(r.eligibleRemaining).toBe(16);
        db.close();
    });
    it('backend failure skips the sanitize pass rather than retrying doomed calls', async () => {
        const db = freshDb();
        seedPairs(db, 8);
        // An oversized singleton that would normally be sanitized.
        insertMemory(db, { ...base, project: 'solo', title: 'Verbose', body: 'GAMMA '.repeat(200) });
        let calls = 0;
        const deadBackend = async () => { calls++; return ''; };
        await distillMemories(db, undefined, pairEmbed, deadBackend);
        // Only the merge attempts up to the abort threshold — no sanitize calls after.
        expect(calls).toBeLessThanOrEqual(5);
        db.close();
    });
});
describe('distillMemories — merge responses containing code', () => {
    it('parses a fenced response whose body carries regex and Windows-path backslashes', async () => {
        const db = freshDb();
        insertMemory(db, { ...base, title: 'One', body: 'ALPHA first phrasing', confidence: 0.9 });
        insertMemory(db, { ...base, title: 'Two', body: 'BETA second phrasing', confidence: 0.7 });
        // `\s` and `\c` are NOT legal JSON escapes (only \" \\ \/ \b \f \n \r \t \uXXXX
        // are). Models emit them verbatim whenever the memory is about a regex or a
        // Windows path, which is most of the low-confidence tail. Strict JSON.parse
        // rejects the whole object, silently discarding an otherwise good merge.
        const codeMerge = async () => '```json\n{"title": "Merged", "body": "ALPHA matches [SerializeField]\\s+ under C:\\Fran\\claude", ' +
            '"memory_type": "convention", "scope": "project", "decay_class": "stable", "tags": []}\n```';
        const r = await distillMemories(db, undefined, fakeEmbed, codeMerge);
        expect(r.clusters).toBe(1);
        expect(r.created).toBe(1); // would be 0 before the escape repair
        expect(r.merged).toBe(2);
        const merged = db.prepare(`SELECT body FROM memories WHERE title = 'Merged'`).get();
        expect(merged).toBeTruthy();
        // The identifiers survive the repair rather than being mangled.
        expect(merged.body).toContain('[SerializeField]');
        expect(merged.body).toContain('C:');
        db.close();
    });
    it('rejects a merge whose text carries mangled-escape damage', async () => {
        const db = freshDb();
        insertMemory(db, { ...base, title: 'One', body: 'ALPHA first phrasing', confidence: 0.9 });
        insertMemory(db, { ...base, title: 'Two', body: 'BETA second phrasing', confidence: 0.7 });
        // What constrained JSON decoding produced on 2026-08-08: the model could not
        // legally escape C:\Fran_Unity\… so it emitted \t and \n, which parse cleanly
        // into control characters. Valid JSON, corrupted content.
        const damaged = async () => JSON.stringify({
            title: 'Merged', body: 'ALPHA docs live in C:\tran_Unity\nity-workflow-optimization now',
            memory_type: 'convention', scope: 'project', decay_class: 'stable', tags: [],
        });
        const r = await distillMemories(db, undefined, fakeEmbed, damaged);
        expect(r.created).toBe(0);
        expect(r.merged).toBe(0);
        // Both originals survive — corruption must never supersede good data.
        const live = db.prepare(`SELECT COUNT(*) c FROM memories WHERE superseded_by IS NULL`).get();
        expect(live.c).toBe(2);
        db.close();
    });
    it('hasEscapeDamage accepts ordinary prose and flags control/bidi characters', () => {
        expect(hasEscapeDamage('Use tabs for indentation; see C:\\Fran_Unity\\unity-workflow.')).toBe(false);
        expect(hasEscapeDamage('Multi-line\nbodies are fine.')).toBe(false); // \n is legitimate prose
        expect(hasEscapeDamage('C:\tran_Unity')).toBe(true); // tab from a mangled \t
        expect(hasEscapeDamage('C:\u202Bran_unity')).toBe(true); // bidi mark
    });
    it('still rejects genuinely unparseable output', async () => {
        const db = freshDb();
        insertMemory(db, { ...base, title: 'One', body: 'ALPHA first phrasing', confidence: 0.9 });
        insertMemory(db, { ...base, title: 'Two', body: 'BETA second phrasing', confidence: 0.7 });
        const prose = async () => 'These two memories are unrelated, so I will not merge them.';
        const r = await distillMemories(db, undefined, fakeEmbed, prose);
        expect(r.created).toBe(0);
        expect(r.merged).toBe(0);
        // Sources handed back, not consumed.
        const live = db.prepare(`SELECT COUNT(*) c FROM memories WHERE superseded_by IS NULL`).get();
        expect(live.c).toBe(2);
        db.close();
    });
});
describe('coverageShortfall', () => {
    it('returns null when vectors are unreadable, so the gate fails open', () => {
        const db = freshDb();
        const { id } = insertMemory(db, { ...base, title: 'NoVec', body: 'ALPHA unindexed' });
        const source = { ...base, id: 'missing-source', title: 'S', body: 'BETA' };
        // Neither memory has a row in memories_vec — must not block the merge.
        expect(coverageShortfall(db, id, [source])).toBeNull();
        db.close();
    });
    it('names the worst source when several fall below the floor', async () => {
        const db = freshDb();
        const merge = insertMemory(db, { ...base, title: 'M', body: 'GAMMA merged' });
        const a = insertMemory(db, { ...base, title: 'A', body: 'ALPHA source' });
        const b = insertMemory(db, { ...base, title: 'B', body: 'BETA source' });
        for (const { id } of [merge, a, b])
            await embedMemory(db, id, fakeEmbed);
        const sources = db.prepare(`SELECT * FROM memories WHERE title IN ('A','B')`).all();
        const worst = coverageShortfall(db, merge.id, sources);
        expect(worst).not.toBeNull();
        // vecC is orthogonal to both vecA and vecB, so both are below the floor.
        expect(['A', 'B'].length).toBe(2);
        expect(worst.similarity).toBeLessThan(0.72);
        db.close();
    });
});
describe('distillMemories — embedding reuse (loadStoredVector)', () => {
    it('reuses stored vectors instead of re-embedding already-indexed memories (SC-2)', async () => {
        const db = freshDb();
        const ids = [];
        // Same vector (GAMMA) on all three -> similarity ~1.0, above the related
        // band's high end, so nothing clusters; isolates the reuse assertion.
        for (const body of ['GAMMA row 1', 'GAMMA row 2', 'GAMMA row 3']) {
            const { id } = insertMemory(db, { ...base, title: body, body });
            ids.push(id);
        }
        // Pre-populate memories_vec so embedUnindexedMemories has nothing to do.
        for (const id of ids)
            await embedMemory(db, id, fakeEmbed);
        let embedCalls = 0;
        const spyEmbed = async (t) => { embedCalls++; return fakeEmbed(t); };
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
        const flaky = async (t) => {
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
        const spyEmbed = async (t) => { embedCalls++; return fakeEmbed(t); };
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
        const spyEmbed = async (t) => { embedCalls++; return fakeEmbed(t); };
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
        const calls = [];
        const spyCall = async (_system, user) => {
            calls.push(user);
            return JSON.stringify({ title: 'Tight', body: 'short tightened body' });
        };
        const r = await distillMemories(db, { project: 'proj-a' }, fakeEmbed, spyCall);
        // In-scope oversized memory was sanitized; the out-of-scope one was never
        // passed to callFn at all.
        expect(r.sanitized).toBeGreaterThan(0);
        expect(calls.some(c => c.includes('OutScope'))).toBe(false);
        const inRow = db.prepare(`SELECT body FROM memories WHERE id = ?`).get(inScope.id);
        const outRow = db.prepare(`SELECT body FROM memories WHERE id = ?`).get(outScope.id);
        expect(inRow.body).not.toBe(longBodyA);
        expect(outRow.body).toBe(longBodyB);
        db.close();
    });
    it('sanitize preserves identifiers even when the tightened prose drops them (ADR-20260808214308-a0 regression)', async () => {
        const db = freshDb();
        const longBody = `GAMMA touches src/core/distill.ts and MERGE_COVERAGE_FLOOR. ${'padding text here. '.repeat(50)}`;
        const inserted = insertMemory(db, { ...base, title: 'Oversized', body: longBody, project: 'proj-a' });
        const seeded = db.prepare(`SELECT identifiers FROM memories WHERE id = ?`).get(inserted.id);
        expect(JSON.parse(seeded.identifiers)).toEqual(expect.arrayContaining(['src/core/distill.ts', 'MERGE_COVERAGE_FLOOR']));
        // Tightened prose reproduces neither identifier — the exact failure mode
        // the audit found: a shorter rewrite that drops what the original named.
        const spySanitize = async () => JSON.stringify({ title: 'Tight', body: 'short tightened body with nothing specific' });
        const r = await distillMemories(db, { project: 'proj-a' }, fakeEmbed, spySanitize);
        expect(r.sanitized).toBe(1);
        const row = db.prepare(`SELECT identifiers FROM memories WHERE id = ?`).get(inserted.id);
        const ids = JSON.parse(row.identifiers);
        expect(ids).toContain('src/core/distill.ts');
        expect(ids).toContain('MERGE_COVERAGE_FLOOR');
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
        const mergedRow = db.prepare(`SELECT id FROM memories WHERE superseded_by IS NULL AND title != 'Three'`).get();
        expect(mergedRow).toBeTruthy();
        const newId = mergedRow.id;
        const originals = db.prepare(`SELECT id, superseded_by FROM memories WHERE title IN ('One', 'Two')`).all();
        expect(originals).toHaveLength(2);
        for (const o of originals)
            expect(o.superseded_by).toBe(newId);
        const links = db.prepare(`SELECT source_id, target_id, link_type FROM memory_links WHERE source_id = ? AND link_type = 'refines'`).all(newId);
        const linkedTargets = links.map(l => l.target_id).sort();
        expect(linkedTargets).toEqual(originals.map(o => o.id).sort());
        db.close();
    });
});
describe('buildEligibleQuery', () => {
    it('project scope filters by project column, applies the cursor, and appends LIMIT :limit', () => {
        const scope = { kind: 'project', slug: 'my-proj' };
        const { sql, params } = buildEligibleQuery(scope, 200);
        expect(sql).toBe(`SELECT * FROM memories WHERE project = :slug AND scope != 'global' AND superseded_by IS NULL AND review_status != 'rejected' AND distilled_at IS NULL ORDER BY confidence DESC, created_at ASC LIMIT :limit`);
        expect(sql).toContain(`scope != 'global'`);
        expect(params).toEqual({ slug: 'my-proj', limit: 200 });
    });
    it('global scope filters by scope column, no project param, appends LIMIT :limit', () => {
        const scope = { kind: 'global' };
        const { sql, params } = buildEligibleQuery(scope, 50);
        expect(sql).toBe(`SELECT * FROM memories WHERE scope = 'global' AND superseded_by IS NULL AND review_status != 'rejected' AND distilled_at IS NULL ORDER BY confidence DESC, created_at ASC LIMIT :limit`);
        expect(params).toEqual({ limit: 50 });
    });
    it('all scope has no project/scope filter, appends LIMIT :limit', () => {
        const scope = { kind: 'all' };
        const { sql, params } = buildEligibleQuery(scope, 500);
        expect(sql).toBe(`SELECT * FROM memories WHERE superseded_by IS NULL AND review_status != 'rejected' AND distilled_at IS NULL ORDER BY confidence DESC, created_at ASC LIMIT :limit`);
        expect(params).toEqual({ limit: 500 });
    });
    it('since widens the cursor to also re-open previously distilled rows, and binds :since', () => {
        const { sql, params } = buildEligibleQuery({ kind: 'all' }, 100, '2026-07-26 00:00:00');
        expect(sql).toContain(`AND (distilled_at IS NULL OR distilled_at < :since)`);
        expect(params).toEqual({ limit: 100, since: '2026-07-26 00:00:00' });
    });
});
describe('cursorClause', () => {
    it('without since, only never-examined rows are candidates', () => {
        expect(cursorClause(undefined)).toBe(`distilled_at IS NULL`);
    });
    it('with since, rows examined before the cutoff are candidates again', () => {
        expect(cursorClause('2026-01-01 00:00:00')).toBe(`(distilled_at IS NULL OR distilled_at < :since)`);
    });
});
describe('countEligible', () => {
    it('never prepares a SQL statement containing LIMIT, for any scope kind', () => {
        const db = freshDb();
        const seenSql = [];
        const realPrepare = db.prepare.bind(db);
        db.prepare = ((sql) => { seenSql.push(sql); return realPrepare(sql); });
        countEligible(db, { kind: 'project', slug: 'proj-a' });
        countEligible(db, { kind: 'global' });
        countEligible(db, { kind: 'all' });
        expect(seenSql.length).toBeGreaterThan(0);
        for (const sql of seenSql)
            expect(sql.toUpperCase()).not.toContain('LIMIT');
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
        expect(result.slug.length).toBeGreaterThan(0);
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
//# sourceMappingURL=distill.test.js.map