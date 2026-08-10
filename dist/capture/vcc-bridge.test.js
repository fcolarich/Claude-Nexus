import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
const spawnSyncMock = vi.fn();
vi.mock('child_process', () => ({ spawnSync: (...args) => spawnSyncMock(...args) }));
// Trackable pass-through wrapper around the real renameSync: the ESM `fs` namespace
// isn't spyable directly (its exports are non-configurable), so this mock records
// every call while still delegating to the real implementation, keeping the
// success-path tests' actual filesystem behavior intact.
const renameSyncMock = vi.fn();
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        renameSync: (...args) => {
            renameSyncMock(...args);
            return actual.renameSync(...args);
        },
    };
});
// Lets a single test simulate two syntactically-distinct paths (destPath vs
// jsonlPath) resolving to the same real path — e.g. a symlink or case-folding
// collision that string comparison alone wouldn't catch — to force the internal
// assertNotSource tripwire. Inert (pure passthrough to the real path.resolve)
// unless a test flips `active`.
const resolveOverride = vi.hoisted(() => ({ active: false, jsonlPath: '' }));
vi.mock('path', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        resolve: (...args) => {
            const real = actual.resolve(...args);
            if (resolveOverride.active) {
                const collidedTarget = actual.resolve(`${resolveOverride.jsonlPath}.vcc-shrunk.jsonl`);
                const source = actual.resolve(resolveOverride.jsonlPath);
                if (real === collidedTarget)
                    return source;
            }
            return real;
        },
    };
});
// Imported after the mocks so the module under test picks up mocked spawnSync/renameSync.
const { compactWindowLines, compactFileInPlace, parallelShrunkPath, compactToParallelFile } = await import('./vcc-bridge.js');
function ok(stdout = '', stderr = 'pre=100 post=40 ratio=0.400') {
    return { status: 0, stdout, stderr, error: undefined, signal: null };
}
describe('vcc-bridge', () => {
    let workDir;
    const origEnv = { ...process.env };
    // Regression guard for ADR-015: no renameSync call from this module may ever
    // target jsonlPath itself, in success or forced-failure runs alike.
    function assertRenameSyncNeverTargetedSource(jsonlPath) {
        for (const call of renameSyncMock.mock.calls) {
            const target = call[1];
            expect(resolve(String(target))).not.toBe(resolve(jsonlPath));
        }
    }
    beforeEach(() => {
        spawnSyncMock.mockReset();
        renameSyncMock.mockReset();
        workDir = mkdtempSync(join(tmpdir(), 'vcc-bridge-test-'));
        process.env = { ...origEnv };
    });
    afterEach(() => {
        rmSync(workDir, { recursive: true, force: true });
        process.env = { ...origEnv };
    });
    describe('compactWindowLines', () => {
        it('returns ok:true with compacted text on success', () => {
            spawnSyncMock.mockImplementation((_cmd, args) => {
                // The CLI writes to whatever --out path it was given.
                const outIdx = args.indexOf('--out');
                const outPath = args[outIdx + 1];
                writeFileSync(outPath, 'compacted summary text', 'utf-8');
                return ok();
            });
            const result = compactWindowLines(['{"a":1}', '{"b":2}']);
            expect(result.ok).toBe(true);
            expect(result.text).toBe('compacted summary text');
            expect(result.preTokens).toBe(100);
            expect(result.postTokens).toBe(40);
            expect(spawnSyncMock).toHaveBeenCalledTimes(1);
        });
        it('returns ok:false on non-zero exit, never throws', () => {
            spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: 'boom', error: undefined, signal: null });
            const result = compactWindowLines(['{"a":1}']);
            expect(result.ok).toBe(false);
            expect(result.text).toBeUndefined();
            expect(result.error).toContain('boom');
        });
        it('falls back to "py -3" on ENOENT from the primary python binary', () => {
            let call = 0;
            spawnSyncMock.mockImplementation((cmd, args) => {
                call++;
                if (call === 1) {
                    expect(cmd).toBe('python');
                    const err = new Error('spawn python ENOENT');
                    err.code = 'ENOENT';
                    return { status: null, stdout: '', stderr: '', error: err, signal: null };
                }
                expect(cmd).toBe('py');
                expect(args[0]).toBe('-3');
                const outIdx = args.indexOf('--out');
                writeFileSync(args[outIdx + 1], 'ok via py -3', 'utf-8');
                return ok();
            });
            const result = compactWindowLines(['{"a":1}']);
            expect(result.ok).toBe(true);
            expect(result.text).toBe('ok via py -3');
            expect(spawnSyncMock).toHaveBeenCalledTimes(2);
        });
        it('falls back to "py -3" on ENOENT when PYTHON_BIN is set to a bogus binary', () => {
            process.env.PYTHON_BIN = 'nonexistent-python-bin';
            let call = 0;
            spawnSyncMock.mockImplementation((cmd, args) => {
                call++;
                if (call === 1) {
                    expect(cmd).toBe('nonexistent-python-bin');
                    const err = new Error('spawn nonexistent-python-bin ENOENT');
                    err.code = 'ENOENT';
                    return { status: null, stdout: '', stderr: '', error: err, signal: null };
                }
                expect(cmd).toBe('py');
                expect(args[0]).toBe('-3');
                const outIdx = args.indexOf('--out');
                writeFileSync(args[outIdx + 1], 'ok via py -3 fallback', 'utf-8');
                return ok();
            });
            const result = compactWindowLines(['{"a":1}']);
            expect(result.ok).toBe(true);
            expect(result.text).toBe('ok via py -3 fallback');
            expect(spawnSyncMock).toHaveBeenCalledTimes(2);
        });
        it('returns ok:false when the process times out (killed by signal)', () => {
            spawnSyncMock.mockReturnValue({ status: null, stdout: '', stderr: '', error: undefined, signal: 'SIGTERM' });
            const result = compactWindowLines(['{"a":1}'], { timeoutMs: 5 });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('SIGTERM');
        });
        it('never throws when a non-ENOENT spawn error occurs', () => {
            spawnSyncMock.mockReturnValue({
                status: null, stdout: '', stderr: '', signal: null,
                error: Object.assign(new Error('EACCES'), { code: 'EACCES' }),
            });
            expect(() => compactWindowLines(['{"a":1}'])).not.toThrow();
            const result = compactWindowLines(['{"a":1}']);
            expect(result.ok).toBe(false);
        });
    });
    describe('compactFileInPlace', () => {
        it('renames the compacted temp file over jsonlPath on success', () => {
            const jsonlPath = join(workDir, 'session.jsonl');
            writeFileSync(jsonlPath, 'raw\n', 'utf-8');
            spawnSyncMock.mockImplementation((_cmd, args) => {
                const outIdx = args.indexOf('--out');
                writeFileSync(args[outIdx + 1], 'shrunk content', 'utf-8');
                return ok();
            });
            const result = compactFileInPlace(jsonlPath);
            expect(result.ok).toBe(true);
            expect(result.text).toBe('shrunk content');
            expect(existsSync(`${jsonlPath}.vcc-tmp`)).toBe(false);
            expect(readFileSync(jsonlPath, 'utf-8')).toBe('shrunk content');
        });
        it('leaves jsonlPath untouched on failure', () => {
            const jsonlPath = join(workDir, 'session2.jsonl');
            writeFileSync(jsonlPath, 'original raw content', 'utf-8');
            spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: 'compaction failed', error: undefined, signal: null });
            const result = compactFileInPlace(jsonlPath);
            expect(result.ok).toBe(false);
            expect(result.error).toContain('compaction failed');
            expect(readFileSync(jsonlPath, 'utf-8')).toBe('original raw content');
            expect(existsSync(`${jsonlPath}.vcc-tmp`)).toBe(false);
        });
        it('respects timeoutMs by passing it through to spawnSync', () => {
            const jsonlPath = join(workDir, 'session3.jsonl');
            writeFileSync(jsonlPath, 'raw', 'utf-8');
            spawnSyncMock.mockReturnValue({ status: null, stdout: '', stderr: '', error: undefined, signal: 'SIGTERM' });
            const result = compactFileInPlace(jsonlPath, { timeoutMs: 15_000 });
            expect(result.ok).toBe(false);
            const callArgs = spawnSyncMock.mock.calls[0];
            expect(callArgs[2].timeout).toBe(15_000);
        });
    });
    describe('parallelShrunkPath', () => {
        it('returns the sibling path with a .vcc-shrunk.jsonl suffix, no I/O', () => {
            const jsonlPath = join(workDir, 'session.jsonl');
            expect(parallelShrunkPath(jsonlPath)).toBe(`${jsonlPath}.vcc-shrunk.jsonl`);
            // Pure function: must not touch the filesystem, so the path need not exist.
            expect(existsSync(jsonlPath)).toBe(false);
        });
    });
    describe('compactToParallelFile', () => {
        it('writes the sibling shrunk file, leaves the source untouched, and returns ok:true with the sibling path', () => {
            const jsonlPath = join(workDir, 'session.jsonl');
            const sourceBytes = 'raw\nline two\n';
            writeFileSync(jsonlPath, sourceBytes, 'utf-8');
            const preReadBuffer = readFileSync(jsonlPath);
            spawnSyncMock.mockImplementation((_cmd, args) => {
                const outIdx = args.indexOf('--out');
                writeFileSync(args[outIdx + 1], 'shrunk parallel content', 'utf-8');
                return ok();
            });
            const result = compactToParallelFile(jsonlPath);
            expect(result.ok).toBe(true);
            expect(result.path).toBe(parallelShrunkPath(jsonlPath));
            expect(existsSync(parallelShrunkPath(jsonlPath))).toBe(true);
            expect(readFileSync(parallelShrunkPath(jsonlPath), 'utf-8')).toBe('shrunk parallel content');
            // Source file bytes must be byte-for-byte unchanged from before the call.
            expect(readFileSync(jsonlPath).equals(preReadBuffer)).toBe(true);
            assertRenameSyncNeverTargetedSource(jsonlPath);
        });
        it('on forced non-zero exit from the CLI: never renames onto jsonlPath, leaves the source byte-identical, leaves no shrunk sibling, and returns ok:false with no path', () => {
            const jsonlPath = join(workDir, 'session-fail.jsonl');
            const sourceBytes = 'raw\nline two\n';
            writeFileSync(jsonlPath, sourceBytes, 'utf-8');
            const preReadBuffer = readFileSync(jsonlPath);
            spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: 'compaction failed', error: undefined, signal: null });
            const result = compactToParallelFile(jsonlPath);
            expect(result.ok).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.path).toBeUndefined();
            assertRenameSyncNeverTargetedSource(jsonlPath);
            expect(readFileSync(jsonlPath).equals(preReadBuffer)).toBe(true);
            expect(existsSync(parallelShrunkPath(jsonlPath))).toBe(false);
        });
        it('on a forced throw from the spawnSync boundary: never renames onto jsonlPath, leaves the source byte-identical, leaves no shrunk sibling, and returns ok:false with no path', () => {
            const jsonlPath = join(workDir, 'session-throw.jsonl');
            const sourceBytes = 'raw\nline two\n';
            writeFileSync(jsonlPath, sourceBytes, 'utf-8');
            const preReadBuffer = readFileSync(jsonlPath);
            spawnSyncMock.mockImplementation(() => {
                throw new Error('spawnSync boundary exploded');
            });
            const result = compactToParallelFile(jsonlPath);
            expect(result.ok).toBe(false);
            expect(result.error).toContain('spawnSync boundary exploded');
            expect(result.path).toBeUndefined();
            assertRenameSyncNeverTargetedSource(jsonlPath);
            expect(readFileSync(jsonlPath).equals(preReadBuffer)).toBe(true);
            expect(existsSync(parallelShrunkPath(jsonlPath))).toBe(false);
        });
        it('on an assertNotSource trip (destPath resolves to jsonlPath): never calls renameSync, leaves the source byte-identical, leaves no shrunk sibling, and returns ok:false with no path', () => {
            const jsonlPath = join(workDir, 'session-collision.jsonl');
            const sourceBytes = 'raw\nline two\n';
            writeFileSync(jsonlPath, sourceBytes, 'utf-8');
            const preReadBuffer = readFileSync(jsonlPath);
            spawnSyncMock.mockImplementation((_cmd, args) => {
                const outIdx = args.indexOf('--out');
                writeFileSync(args[outIdx + 1], 'shrunk parallel content', 'utf-8');
                return ok();
            });
            resolveOverride.active = true;
            resolveOverride.jsonlPath = jsonlPath;
            try {
                const result = compactToParallelFile(jsonlPath);
                expect(result.ok).toBe(false);
                expect(result.error).toMatch(/assertNotSource/);
                expect(result.path).toBeUndefined();
                expect(renameSyncMock).not.toHaveBeenCalled();
                expect(readFileSync(jsonlPath).equals(preReadBuffer)).toBe(true);
                expect(existsSync(parallelShrunkPath(jsonlPath))).toBe(false);
            }
            finally {
                resolveOverride.active = false;
            }
        });
    });
});
//# sourceMappingURL=vcc-bridge.test.js.map