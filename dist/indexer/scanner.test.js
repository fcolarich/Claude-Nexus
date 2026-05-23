/**
 * Unit tests for discoverProjectDocs in src/indexer/scanner.ts.
 * Uses temp dirs and in-memory SQLite.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { openDatabase, initializeSchema } from '../core/database.js';
import { discoverProjectDocs } from './scanner.js';
const tempDirs = [];
function mktemp() {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-scanner-'));
    tempDirs.push(dir);
    return dir;
}
function freshDb() {
    const db = openDatabase(':memory:');
    initializeSchema(db);
    return db;
}
function seedSession(db, cwd, sessionId = 's1') {
    db.prepare(`INSERT OR IGNORE INTO sessions (session_id, project, jsonl_path, status, cwd)
     VALUES (?, 'test', '/fake/path.jsonl', 'dead', ?)`).run(sessionId, cwd);
}
afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        try {
            rmSync(dir, { recursive: true, force: true });
        }
        catch { }
    }
});
describe('discoverProjectDocs', () => {
    it('basic discovery: two .md files in cwd → both returned as project_doc SourceFiles', () => {
        const dir = mktemp();
        writeFileSync(join(dir, 'notes.md'), '# Notes');
        writeFileSync(join(dir, 'readme.md'), '# Readme');
        const db = freshDb();
        seedSession(db, dir);
        const results = discoverProjectDocs(db);
        const paths = results.map(r => r.path);
        expect(results.every(r => r.sourceType === 'project_doc')).toBe(true);
        expect(paths.some(p => p.includes('notes.md'))).toBe(true);
        expect(paths.some(p => p.includes('readme.md'))).toBe(true);
        db.close();
    });
    it('ignores .md files inside node_modules/', () => {
        const dir = mktemp();
        writeFileSync(join(dir, 'ok.md'), '# OK');
        mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
        writeFileSync(join(dir, 'node_modules', 'pkg', 'README.md'), '# pkg');
        const db = freshDb();
        seedSession(db, dir);
        const results = discoverProjectDocs(db);
        const paths = results.map(r => r.path);
        expect(paths.some(p => p.includes('ok.md'))).toBe(true);
        expect(paths.every(p => !p.includes('node_modules'))).toBe(true);
        db.close();
    });
    it('ignores .md files inside dist/, build/, .git/', () => {
        const dir = mktemp();
        writeFileSync(join(dir, 'real.md'), '# Real');
        for (const ignored of ['dist', 'build', '.git']) {
            mkdirSync(join(dir, ignored), { recursive: true });
            writeFileSync(join(dir, ignored, 'file.md'), `# ${ignored}`);
        }
        const db = freshDb();
        seedSession(db, dir);
        const results = discoverProjectDocs(db);
        const paths = results.map(r => r.path);
        expect(paths.some(p => p.includes('real.md'))).toBe(true);
        expect(paths.every(p => !p.match(/[/\\](dist|build|\.git)[/\\]/i))).toBe(true);
        db.close();
    });
    it('dedup: two sessions with same cwd → each .md file appears exactly once', () => {
        const dir = mktemp();
        writeFileSync(join(dir, 'doc.md'), '# Doc');
        const db = freshDb();
        seedSession(db, dir, 's1');
        seedSession(db, dir, 's2');
        const results = discoverProjectDocs(db);
        const docPaths = results.filter(r => r.path.includes('doc.md'));
        expect(docPaths.length).toBe(1);
        db.close();
    });
    it('nonexistent cwd: handled silently, returns empty result, no throw', () => {
        const db = freshDb();
        seedSession(db, '/nonexistent/path/that/does/not/exist');
        let results = [];
        expect(() => { results = discoverProjectDocs(db); }).not.toThrow();
        expect(results.length).toBe(0);
        db.close();
    });
    it('cwd IS NULL sessions excluded from query', () => {
        const db = freshDb();
        seedSession(db, null, 's1');
        const results = discoverProjectDocs(db);
        expect(results.length).toBe(0);
        db.close();
    });
    it('CLAUDE.md gets atomTypeOverride "reference"', () => {
        const dir = mktemp();
        writeFileSync(join(dir, 'CLAUDE.md'), '# Claude instructions');
        const db = freshDb();
        seedSession(db, dir);
        const results = discoverProjectDocs(db);
        const claudeFile = results.find(r => r.path.endsWith('CLAUDE.md'));
        expect(claudeFile).toBeDefined();
        expect(claudeFile?.atomTypeOverride).toBe('reference');
        db.close();
    });
    it('architecture.md gets atomTypeOverride "architecture"', () => {
        const dir = mktemp();
        writeFileSync(join(dir, 'architecture.md'), '# Architecture');
        const db = freshDb();
        seedSession(db, dir);
        const results = discoverProjectDocs(db);
        const archFile = results.find(r => r.path.endsWith('architecture.md'));
        expect(archFile).toBeDefined();
        expect(archFile?.atomTypeOverride).toBe('architecture');
        db.close();
    });
    it('generic notes.md gets atomTypeOverride "project_note"', () => {
        const dir = mktemp();
        writeFileSync(join(dir, 'notes.md'), '# Notes');
        const db = freshDb();
        seedSession(db, dir);
        const results = discoverProjectDocs(db);
        const notesFile = results.find(r => r.path.endsWith('notes.md'));
        expect(notesFile).toBeDefined();
        expect(notesFile?.atomTypeOverride).toBe('project_note');
        db.close();
    });
    it('plan.md gets atomTypeOverride "plan"', () => {
        const dir = mktemp();
        writeFileSync(join(dir, 'plan.md'), '# Plan');
        const db = freshDb();
        seedSession(db, dir);
        const results = discoverProjectDocs(db);
        const planFile = results.find(r => r.path.endsWith('plan.md'));
        expect(planFile).toBeDefined();
        expect(planFile?.atomTypeOverride).toBe('plan');
        db.close();
    });
});
//# sourceMappingURL=scanner.test.js.map