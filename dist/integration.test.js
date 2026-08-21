/**
 * Integration tests — exercise the seams between modules: capture -> recall,
 * the review gate, decay -> recall drop-out -> verify, and consolidation.
 * Module internals are covered by the per-module unit tests.
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openDatabase, initializeSchema } from './core/database.js';
import { reflect } from './capture/reflector.js';
import { recallMemories } from './core/recall.js';
import { insertMemory, verifyMemory, vecToBlob, normalize } from './core/memories.js';
import { consolidateMemories } from './core/consolidate.js';
import { reindexFile } from './indexer/indexer.js';
import { discoverProjectDocs } from './indexer/scanner.js';
import { linkAtom, buildBm25Corpus } from './core/links.js';
function freshDb() {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    return db;
}
function transcript() {
    const u = (c) => ({ type: 'user', message: { role: 'user', content: c } });
    const a = (t) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] } });
    const entries = [
        u("no, don't hardcode the path here"),
        a('Understood — I will make it configurable.'),
        u('also always run the linter before committing'),
        a('Noted.'),
    ];
    const dir = mkdtempSync(join(tmpdir(), 'nexus-int-'));
    const p = join(dir, 't.jsonl');
    writeFileSync(p, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
    return p;
}
function vecFromText(text) {
    const v = new Float32Array(1024);
    let seed = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++)
        seed = ((seed ^ text.charCodeAt(i)) * 16777619) >>> 0;
    for (let i = 0; i < 1024; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        v[i] = seed / 0xffffffff - 0.5;
    }
    return v;
}
const constVec = () => { const v = new Float32Array(1024); v.fill(0.1); return v; };
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
const candConvention = {
    title: 'No hardcoded paths', body: 'Paths must be configurable, never hardcoded in source.',
    memory_type: 'convention', scope: 'project', decay_class: 'stable', confidence: 0.9, tags: ['config'], promotion_target: 'none',
};
const candPreference = {
    title: 'Lint before commit', body: 'Always run the linter before committing changes.',
    memory_type: 'preference', scope: 'global', decay_class: 'stable', confidence: 0.9, tags: ['workflow'], promotion_target: 'none',
};
describe('integration: capture -> recall', () => {
    it('memories written by the Reflector are retrieved by recall', async () => {
        const db = freshDb();
        await reflect(db, { session_id: 's1', transcript_path: transcript(), project: 'proj' }, { extract: async () => [candConvention, candPreference], embed: async (t) => vecFromText(t) });
        const r = recallMemories(db, { project: 'proj' });
        expect(r.items).toHaveLength(2); // project-scoped + global, dual-bank
        expect(r.markdown).toContain('No hardcoded paths');
        expect(r.markdown).toContain('Lint before commit');
        db.close();
    });
    it('withholds pending memories from recall until approved', async () => {
        const db = freshDb();
        // confidence 0.5 < auto-approve threshold -> stored pending
        await reflect(db, { session_id: 's2', transcript_path: transcript(), project: 'proj' }, { extract: async () => [{ ...candConvention, confidence: 0.5 }], embed: async (t) => vecFromText(t) });
        expect(recallMemories(db, { project: 'proj' }).items).toHaveLength(0);
        const id = db.prepare(`SELECT id FROM memories LIMIT 1`).get().id;
        db.prepare(`UPDATE memories SET review_status='approved' WHERE id=?`).run(id);
        expect(recallMemories(db, { project: 'proj' }).items).toHaveLength(1);
        db.close();
    });
});
describe('integration: decay lifecycle', () => {
    it('a decayed memory drops from recall and verify restores it', () => {
        const db = freshDb();
        const base = {
            memory_type: 'insight', scope: 'project', project: 'proj', confidence: 0.8,
            decay_class: 'implementation', review_status: 'approved',
            source_session_id: null, discovered_from: null, tags: [], promotion_target: 'none',
        };
        const { id } = insertMemory(db, { ...base, title: 'Impl detail', body: 'an implementation detail' });
        db.prepare(`UPDATE memories SET last_verified_at=? WHERE id=?`).run(daysAgo(400), id);
        expect(recallMemories(db, { project: 'proj' }).items).toHaveLength(0); // decayed below threshold
        verifyMemory(db, id);
        expect(recallMemories(db, { project: 'proj' }).items).toHaveLength(1); // decay clock reset
        db.close();
    });
});
describe('integration: project_doc corpus expansion', () => {
    it('indexes project .md files, embeds (fake), links, writes atom_links', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'nexus-projdoc-'));
        try {
            // 1. Create three .md files (≥3 required for BM25 corpus to consolidate)
            writeFileSync(join(tempDir, 'notes.md'), `# Project Notes\n\nThis project uses TypeScript and SQLite.`);
            writeFileSync(join(tempDir, 'architecture.md'), `# Architecture\n\nUses sqlite-vec for vector search.`);
            writeFileSync(join(tempDir, 'CLAUDE.md'), `# Claude\n\nAlways run tests before committing.`);
            const db = freshDb();
            // 2. Seed sessions table with cwd
            db.prepare(`INSERT INTO sessions (session_id, project, jsonl_path, status, cwd) VALUES ('s1', 'test', '/fake.jsonl', 'dead', ?)`).run(tempDir);
            // 3. discoverProjectDocs → verify 3 SourceFiles
            const projectDocs = discoverProjectDocs(db);
            expect(projectDocs.length).toBe(3);
            expect(projectDocs.every(d => d.sourceType === 'project_doc')).toBe(true);
            // 4. indexFile each → verify atoms with source_type='project_doc'
            for (const doc of projectDocs) {
                reindexFile(db, doc.path, doc.sourceType);
            }
            const atoms = db.prepare(`SELECT id, source_type FROM atoms WHERE source_type = 'project_doc'`).all();
            expect(atoms.length).toBe(3);
            expect(atoms.every(a => a.source_type === 'project_doc')).toBe(true);
            // 5. Insert fake vectors into atoms_vec for KNN linking
            const allAtoms = db.prepare(`SELECT id, rowid, title, body FROM atoms`).all();
            for (const a of allAtoms) {
                const vec = vecFromText(`${a.title}\n${a.body}`);
                try {
                    db.prepare(`INSERT OR IGNORE INTO atoms_vec(rowid, embedding) VALUES (${a.rowid}, ?)`).run(vecToBlob(normalize(vec)));
                }
                catch { /* atoms_vec may not be loaded in test env */ }
            }
            // Build corpus for BM25
            const corpus = allAtoms.length >= 3 ? buildBm25Corpus(allAtoms) : undefined;
            // 6. linkAtom with fake embedFn for each project_doc atom
            for (const atom of atoms) {
                await linkAtom(db, atom.id, async (text) => vecFromText(text), corpus);
            }
            // 7. Verify atoms.linked_at is set (not null)
            for (const atom of atoms) {
                const row = db.prepare(`SELECT linked_at FROM atoms WHERE id = ?`).get(atom.id);
                expect(row.linked_at).not.toBeNull();
            }
            // 8. Verify atom_links has rows — the core task-011 criterion
            const linkCount = db.prepare(`SELECT COUNT(*) AS c FROM atom_links`).get().c;
            expect(linkCount).toBeGreaterThan(0);
            db.close();
        }
        finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
describe('integration: consolidation', () => {
    it('merges duplicates so recall returns a single memory', async () => {
        const db = freshDb();
        const base = {
            memory_type: 'convention', scope: 'project', project: 'proj', confidence: 0.9,
            decay_class: 'stable', review_status: 'approved',
            source_session_id: null, discovered_from: null, tags: [], promotion_target: 'none',
        };
        insertMemory(db, { ...base, title: 'A', body: 'first phrasing of the rule', confidence: 0.9 });
        insertMemory(db, { ...base, title: 'B', body: 'second phrasing of the rule', confidence: 0.7 });
        await consolidateMemories(db, async () => constVec(), undefined, async () => 'confirmed'); // identical embeddings -> near-dup
        expect(recallMemories(db, { project: 'proj' }).items).toHaveLength(1);
        db.close();
    });
});
//# sourceMappingURL=integration.test.js.map