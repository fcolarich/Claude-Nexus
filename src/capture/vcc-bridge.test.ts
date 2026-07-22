import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const spawnSyncMock = vi.fn();
vi.mock('child_process', () => ({ spawnSync: (...args: unknown[]) => spawnSyncMock(...args) }));

// Imported after the mock so the module under test picks up the mocked spawnSync.
const { compactWindowLines, compactFileInPlace } = await import('./vcc-bridge.js');

function ok(stdout = '', stderr = 'pre=100 post=40 ratio=0.400'): ReturnType<typeof spawnSyncMock> {
  return { status: 0, stdout, stderr, error: undefined, signal: null } as never;
}

describe('vcc-bridge', () => {
  let workDir: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    spawnSyncMock.mockReset();
    workDir = mkdtempSync(join(tmpdir(), 'vcc-bridge-test-'));
    process.env = { ...origEnv };
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    process.env = { ...origEnv };
  });

  describe('compactWindowLines', () => {
    it('returns ok:true with compacted text on success', () => {
      spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
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
      spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
        call++;
        if (call === 1) {
          expect(cmd).toBe('python');
          const err = new Error('spawn python ENOENT') as NodeJS.ErrnoException;
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
      spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
        call++;
        if (call === 1) {
          expect(cmd).toBe('nonexistent-python-bin');
          const err = new Error('spawn nonexistent-python-bin ENOENT') as NodeJS.ErrnoException;
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

      spawnSyncMock.mockImplementation((_cmd: string, args: string[]) => {
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
      expect((callArgs[2] as { timeout: number }).timeout).toBe(15_000);
    });
  });
});
