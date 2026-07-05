import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileSyncMock = vi.fn();
vi.mock('child_process', () => ({ execFileSync: (...args: unknown[]) => execFileSyncMock(...args) }));

const { resolveGitProjectRoot, resolveProjectSlug, cwdToProjectSlug } = await import('./project-root.js');

describe('resolveGitProjectRoot', () => {
  beforeEach(() => execFileSyncMock.mockReset());

  it('resolves to the cwd itself when cwd is the repo root', () => {
    execFileSyncMock.mockReturnValue('.git\n');
    expect(resolveGitProjectRoot('C:\\Fran\\Voodoo Magic')).toBe('C:\\Fran\\Voodoo Magic');
  });

  it('resolves a subdirectory up to the repo root', () => {
    execFileSyncMock.mockReturnValue('../.git\n');
    expect(resolveGitProjectRoot('C:\\Fran\\Voodoo Magic\\tools')).toBe('C:\\Fran\\Voodoo Magic');
  });

  it('collapses a worktree onto the main checkout via an absolute common-dir', () => {
    execFileSyncMock.mockReturnValue('C:\\Fran\\Voodoo Magic\\.git\n');
    expect(resolveGitProjectRoot('C:\\Fran\\Voodoo Magic\\.worktrees\\refactor-x')).toBe('C:\\Fran\\Voodoo Magic');
  });

  it('falls back to cwd when git fails or cwd is not a repo', () => {
    execFileSyncMock.mockImplementationOnce(() => { throw new Error('fatal: not a git repository'); });
    expect(resolveGitProjectRoot('C:\\Fran\\NotARepo')).toBe('C:\\Fran\\NotARepo');
  });
});

describe('resolveProjectSlug', () => {
  beforeEach(() => execFileSyncMock.mockReset());

  it('composes git-root resolution with slugging', () => {
    execFileSyncMock.mockReturnValue('../.git\n');
    expect(resolveProjectSlug('C:\\Fran\\Voodoo Magic\\tools')).toBe('C--Fran-Voodoo-Magic');
  });

  it('falls back to plain cwd slugging when not a git repo', () => {
    execFileSyncMock.mockImplementationOnce(() => { throw new Error('not a git repository'); });
    expect(resolveProjectSlug('C:\\Fran\\Voodoo Magic')).toBe('C--Fran-Voodoo-Magic');
  });
});

describe('cwdToProjectSlug (unchanged, moved here)', () => {
  it('converts a Windows absolute path', () => {
    expect(cwdToProjectSlug('C:\\Fran\\Monster-Hotel')).toBe('C--Fran-Monster-Hotel');
  });
});
