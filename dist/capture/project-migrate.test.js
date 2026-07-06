import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openDatabase, initializeSchema } from '../core/database.js';
import { insertMemory } from '../core/memories.js';
const resolveProjectSlugMock = vi.fn();
vi.mock('../core/project-root.js', () => ({ resolveProjectSlug: (cwd) => resolveProjectSlugMock(cwd) }));
const { buildProjectAliases, applyProjectAliases, migrateProjects } = await import('./project-migrate.js');
function freshDb() {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    return db;
}
function insertSession(db, o) {
    db.prepare(`
    INSERT INTO sessions (session_id, project, cwd, jsonl_path, status, message_count, last_active)
    VALUES (?, ?, ?, '/nonexistent.jsonl', 'dead', 5, ?)
  `).run(o.id, o.project, o.cwd, o.lastActive);
}
describe('buildProjectAliases', () => {
    beforeEach(() => resolveProjectSlugMock.mockReset());
    it('finds a project whose recorded slug does not match git-root resolution', () => {
        const db = freshDb();
        insertSession(db, { id: 's1', project: 'C--Fran-Automatic Encyclopedias', cwd: 'C:\\Fran\\Automatic Encyclopedias', lastActive: '2026-06-01' });
        resolveProjectSlugMock.mockReturnValue('C--Fran-Automatic-Encyclopedias');
        const aliases = buildProjectAliases(db);
        expect(aliases).toEqual([{ alias: 'C--Fran-Automatic Encyclopedias', canonical: 'C--Fran-Automatic-Encyclopedias' }]);
        db.close();
    });
    it('skips a project already matching its git-root resolution', () => {
        const db = freshDb();
        insertSession(db, { id: 's1', project: 'C--Fran-claude-nexus', cwd: 'C:\\Fran\\claude-nexus', lastActive: '2026-06-01' });
        resolveProjectSlugMock.mockReturnValue('C--Fran-claude-nexus');
        expect(buildProjectAliases(db)).toEqual([]);
        db.close();
    });
});
describe('applyProjectAliases', () => {
    it('merges memories, atoms, and sessions onto the canonical slug', () => {
        const db = freshDb();
        insertMemory(db, { scope: 'project', project: 'old-slug', title: 'A', body: 'body a', memory_type: 'convention', decay_class: 'stable', confidence: 0.8, review_status: 'approved', source_session_id: null, discovered_from: null, tags: [] });
        insertSession(db, { id: 's1', project: 'old-slug', cwd: 'x', lastActive: '2026-06-01' });
        const report = applyProjectAliases(db, [{ alias: 'old-slug', canonical: 'new-slug' }], false);
        expect(report.memoriesUpdated).toBe(1);
        expect(report.sessionsUpdated).toBe(1);
        expect(db.prepare(`SELECT project FROM memories`).get().project).toBe('new-slug');
        db.close();
    });
    it('does nothing in dry-run mode', () => {
        const db = freshDb();
        insertSession(db, { id: 's1', project: 'old-slug', cwd: 'x', lastActive: '2026-06-01' });
        const report = applyProjectAliases(db, [{ alias: 'old-slug', canonical: 'new-slug' }], true);
        expect(report.sessionsUpdated).toBe(0);
        expect(db.prepare(`SELECT project FROM sessions`).get().project).toBe('old-slug');
        db.close();
    });
});
describe('migrateProjects', () => {
    beforeEach(() => resolveProjectSlugMock.mockReset());
    it('applies aliases and calls the injected consolidate + export dependencies', async () => {
        const db = freshDb();
        insertSession(db, { id: 's1', project: 'old-slug', cwd: 'C:\\x', lastActive: '2026-06-01' });
        insertMemory(db, { scope: 'project', project: 'old-slug', title: 'A', body: 'body a', memory_type: 'convention', decay_class: 'stable', confidence: 0.8, review_status: 'approved', source_session_id: null, discovered_from: null, tags: [] });
        resolveProjectSlugMock.mockReturnValue('new-slug');
        const consolidate = vi.fn().mockResolvedValue({ embedded: 0, merged: 2, pruned: 0 });
        const exportFn = vi.fn().mockReturnValue({ buckets: 1, files: 1, dir: '/x' });
        const report = await migrateProjects(db, { dryRun: false, projectsDir: '/does/not/exist' }, { consolidate, exportAll: exportFn });
        expect(report.aliases).toEqual([{ alias: 'old-slug', canonical: 'new-slug' }]);
        expect(consolidate).toHaveBeenCalledOnce();
        expect(exportFn).toHaveBeenCalledOnce();
        expect(report.merged).toBe(2);
        db.close();
    });
    it('dry run finds aliases but calls neither dependency', async () => {
        const db = freshDb();
        insertSession(db, { id: 's1', project: 'old-slug', cwd: 'C:\\x', lastActive: '2026-06-01' });
        resolveProjectSlugMock.mockReturnValue('new-slug');
        const consolidate = vi.fn();
        const exportFn = vi.fn();
        const report = await migrateProjects(db, { dryRun: true, projectsDir: '/does/not/exist' }, { consolidate, exportAll: exportFn });
        expect(report.aliases.length).toBe(1);
        expect(consolidate).not.toHaveBeenCalled();
        expect(exportFn).not.toHaveBeenCalled();
        db.close();
    });
});
//# sourceMappingURL=project-migrate.test.js.map