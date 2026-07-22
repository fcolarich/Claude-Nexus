/**
 * VccBridge — owns every subprocess invocation of `python -m vcc_compact.cli`
 * from claude-nexus. Single fail-open primitive reused by both Reflector call
 * sites (pre-extraction window compaction, post-extraction whole-file shrink).
 *
 * Env vars:
 *   PYTHON_BIN               optional. Overrides the default 'python' binary
 *                            tried first (before the 'py -3' Windows-launcher
 *                            fallback on ENOENT).
 *   VCC_COMPACT_MODULES_PATH required. Absolute path to the flow-shared
 *                            directory containing the `vcc_compact` Python
 *                            package (its parent is passed to the child
 *                            process's PYTHONPATH so `python -m vcc_compact.cli`
 *                            resolves). The same env var backs
 *                            scripts/backfill_vcc_shrink.py's sys.path insert —
 *                            one place an operator points at the module dir.
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'fs';
import { join, delimiter } from 'path';
import { tmpdir } from 'os';

export interface CompactOptions {
  keep?: number;        // --keep N, forwarded to the CLI
  timeoutMs?: number;   // spawnSync timeout; default per call site
  pythonBin?: string;   // default: process.env.PYTHON_BIN ?? 'python'
}

export interface CompactResult {
  ok: boolean;
  text?: string;        // compacted output, present iff ok
  preTokens?: number;
  postTokens?: number;
  error?: string;       // present iff !ok — never throws
}

const DEFAULT_TIMEOUT_MS = 10_000;

function buildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const modulesPath = process.env.VCC_COMPACT_MODULES_PATH;
  if (modulesPath) {
    const existing = env.PYTHONPATH;
    env.PYTHONPATH = existing ? `${modulesPath}${delimiter}${existing}` : modulesPath;
  }
  return env;
}

function parseTokenStats(stderr: string): { preTokens?: number; postTokens?: number } {
  const m = stderr.match(/pre=(\d+)\s+post=(\d+)/);
  if (!m) return {};
  return { preTokens: Number(m[1]), postTokens: Number(m[2]) };
}

/** Runs `python -m vcc_compact.cli <args>`, resolving the python binary with
 * PYTHON_BIN -> 'python' -> (on ENOENT) 'py -3' fallback. Never throws. */
function runCli(args: string[], opts?: CompactOptions): { ok: boolean; stdout?: string; stderr: string; error?: string } {
  const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = buildEnv();

  const preferred = opts?.pythonBin ?? process.env.PYTHON_BIN ?? 'python';
  const attempts: { cmd: string; args: string[] }[] = [
    { cmd: preferred, args: ['-m', 'vcc_compact.cli', ...args] },
    { cmd: 'py', args: ['-3', '-m', 'vcc_compact.cli', ...args] },
  ];

  let lastError: string | undefined;
  for (const attempt of attempts) {
    const res = spawnSync(attempt.cmd, attempt.args, { encoding: 'utf-8', timeout, env });

    if (res.error) {
      // ENOENT -> try next fallback (e.g. 'py -3'); any other spawn error stops here.
      const code = (res.error as NodeJS.ErrnoException).code;
      lastError = res.error.message;
      if (code === 'ENOENT') continue;
      return { ok: false, stderr: '', error: lastError };
    }

    if (res.signal) {
      return { ok: false, stderr: res.stderr ?? '', error: `killed by signal ${res.signal} (timeout?)` };
    }

    if (res.status !== 0) {
      return { ok: false, stderr: res.stderr ?? '', error: `exit code ${res.status}: ${res.stderr ?? ''}`.trim() };
    }

    return { ok: true, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
  }

  return { ok: false, stderr: '', error: lastError ?? 'no python interpreter found' };
}

/** Compacts a raw JSONL window (array of raw line strings, not yet joined) via a
 * throwaway temp input file. Used by the pre-extraction call site — the window is
 * a slice of the transcript, not the whole file, so it cannot be run through the
 * CLI in place. */
export function compactWindowLines(rawLines: string[], opts?: CompactOptions): CompactResult {
  let dir: string;
  try {
    dir = mkdtempSync(join(tmpdir(), 'vcc-window-'));
  } catch (err) {
    return { ok: false, error: `could not create temp dir: ${(err as Error).message}` };
  }

  const inputPath = join(dir, 'window.jsonl');
  const outPath = join(dir, 'window.out');

  try {
    writeFileSync(inputPath, rawLines.join('\n') + (rawLines.length ? '\n' : ''), 'utf-8');

    const cliArgs = [inputPath, '--out', outPath];
    if (opts?.keep !== undefined) cliArgs.push('--keep', String(opts.keep));

    const res = runCli(cliArgs, opts);
    if (!res.ok) {
      return { ok: false, error: res.error };
    }

    if (!existsSync(outPath)) {
      return { ok: false, error: 'compaction produced no output file' };
    }

    const text = readFileSync(outPath, 'utf-8');
    const stats = parseTokenStats(res.stderr);
    return { ok: true, text, ...stats };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}

/** Compacts a whole JSONL file in place: runs the CLI with --out to a sibling temp
 * file, then atomically renames the temp file over jsonlPath on success. Leaves
 * jsonlPath untouched on any failure. Used by the post-extraction shrink and by
 * the cold-session backfill's TS-callable counterpart (none needed — backfill is
 * pure Python, see ColdSessionBackfill). */
export function compactFileInPlace(jsonlPath: string, opts?: CompactOptions): CompactResult {
  const tmpOut = `${jsonlPath}.vcc-tmp`;

  try {
    const cliArgs = [jsonlPath, '--out', tmpOut];
    if (opts?.keep !== undefined) cliArgs.push('--keep', String(opts.keep));

    const res = runCli(cliArgs, opts);
    if (!res.ok) {
      try { rmSync(tmpOut, { force: true }); } catch { /* best-effort cleanup */ }
      return { ok: false, error: res.error };
    }

    if (!existsSync(tmpOut)) {
      return { ok: false, error: 'compaction produced no output file' };
    }

    const text = readFileSync(tmpOut, 'utf-8');
    renameSync(tmpOut, jsonlPath);
    const stats = parseTokenStats(res.stderr);
    return { ok: true, text, ...stats };
  } catch (err) {
    try { rmSync(tmpOut, { force: true }); } catch { /* best-effort cleanup */ }
    return { ok: false, error: (err as Error).message };
  }
}
