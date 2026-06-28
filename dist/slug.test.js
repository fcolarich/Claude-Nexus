import { describe, it, expect } from 'vitest';
import { cwdToProjectSlug } from './indexer/indexer.js';
// ── cwdToProjectSlug ──────────────────────────────────────────────────
describe('cwdToProjectSlug', () => {
    it('converts a Windows absolute path', () => {
        expect(cwdToProjectSlug('C:\\Fran\\Monster-Hotel')).toBe('C--Fran-Monster-Hotel');
    });
    it('converts a POSIX absolute path', () => {
        expect(cwdToProjectSlug('/home/fran/monster-hotel')).toBe('home-fran-monster-hotel');
    });
    it('strips leading and trailing dashes', () => {
        expect(cwdToProjectSlug('/foo')).toBe('foo');
    });
    it('returns null for degenerate bare-segment paths', () => {
        expect(cwdToProjectSlug('p')).toBeNull();
        expect(cwdToProjectSlug('ab')).toBeNull();
        expect(cwdToProjectSlug('C:\\p')).toBe('C--p'); // full drive path: slug is 4 chars, not degenerate
    });
    it('collapses colon-drive separator', () => {
        expect(cwdToProjectSlug('C:/Projects/MyApp')).toBe('C--Projects-MyApp');
    });
    it('converts underscores to dashes (matches Claude Code project dir convention)', () => {
        expect(cwdToProjectSlug('C:\\Fran\\LLM_Workflow_Optimization')).toBe('C--Fran-LLM-Workflow-Optimization');
    });
    it('converts spaces to dashes', () => {
        expect(cwdToProjectSlug('C:\\Fran\\Voodoo Magic')).toBe('C--Fran-Voodoo-Magic');
    });
    it('converts dots to dashes', () => {
        expect(cwdToProjectSlug('C:\\Fran\\RumblePool\\com.rr.pool')).toBe('C--Fran-RumblePool-com-rr-pool');
    });
    it('collapses a .worktrees checkout onto its parent project', () => {
        expect(cwdToProjectSlug('C:\\Fran\\Voodoo Magic\\.worktrees\\refactor-x')).toBe('C--Fran-Voodoo-Magic');
    });
    it('collapses a .claude-worktrees checkout onto its parent project', () => {
        expect(cwdToProjectSlug('C:\\Fran\\IntoTheEndlessSea\\.claude-worktrees\\amazing-mayer-af7718'))
            .toBe('C--Fran-IntoTheEndlessSea');
    });
});
// ── resolveProjectFromCwd (inlined logic) ─────────────────────────────
// We test the slug-derivation portion directly via cwdToProjectSlug since
// the DB-lookup fallback requires a live database.
describe('resolveProjectFromCwd slug derivation', () => {
    it('produces the same slug regardless of slash style', () => {
        const win = cwdToProjectSlug('C:\\Fran\\claude-nexus');
        const posix = cwdToProjectSlug('C:/Fran/claude-nexus');
        expect(win).toBe(posix);
    });
});
// ── getSharedKnowledge split (load_at_init) ───────────────────────────
function makeAtom(overrides) {
    return {
        id: 'test-id',
        title: 'Test',
        body: 'body text',
        atom_type: 'memory',
        scope: 'global',
        source_path: '/fake/path.md',
        source_type: 'nexus_native',
        project: null,
        tags: [],
        content_hash: 'abc',
        frontmatter: null,
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
        status: null,
        priority: null,
        blocks: null,
        blocked_by: null,
        discovered_from: null,
        load_at_init: 0,
        linked_at: null,
        ...overrides,
    };
}
// Mirror the filtering logic from getSharedKnowledge so we can unit-test it.
function splitAtoms(atoms) {
    return {
        initAtoms: atoms.filter(a => a.load_at_init),
        indexAtoms: atoms.filter(a => !a.load_at_init),
    };
}
describe('load_at_init atom splitting', () => {
    it('puts load_at_init=1 atoms in initAtoms', () => {
        const a = makeAtom({ id: 'A', load_at_init: 1 });
        const b = makeAtom({ id: 'B', load_at_init: 0 });
        const { initAtoms, indexAtoms } = splitAtoms([a, b]);
        expect(initAtoms.map(x => x.id)).toEqual(['A']);
        expect(indexAtoms.map(x => x.id)).toEqual(['B']);
    });
    it('all atoms in indexAtoms when none flagged', () => {
        const atoms = [makeAtom({ id: 'A' }), makeAtom({ id: 'B' })];
        const { initAtoms, indexAtoms } = splitAtoms(atoms);
        expect(initAtoms).toHaveLength(0);
        expect(indexAtoms).toHaveLength(2);
    });
    it('all atoms in initAtoms when all flagged', () => {
        const atoms = [
            makeAtom({ id: 'A', load_at_init: 1 }),
            makeAtom({ id: 'B', load_at_init: 1 }),
        ];
        const { initAtoms, indexAtoms } = splitAtoms(atoms);
        expect(initAtoms).toHaveLength(2);
        expect(indexAtoms).toHaveLength(0);
    });
    it('handles empty atom list', () => {
        const { initAtoms, indexAtoms } = splitAtoms([]);
        expect(initAtoms).toHaveLength(0);
        expect(indexAtoms).toHaveLength(0);
    });
});
//# sourceMappingURL=slug.test.js.map