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
import { join, delimiter, resolve } from 'path';
import { tmpdir } from 'os';
/** Suffix used for the sibling shrunk-file written by compactToParallelFile. */
export const VCC_SHRUNK_SUFFIX = '.vcc-shrunk.jsonl';
const DEFAULT_TIMEOUT_MS = 10_000;
function buildEnv() {
    const env = { ...process.env };
    const modulesPath = process.env.VCC_COMPACT_MODULES_PATH;
    if (modulesPath) {
        const existing = env.PYTHONPATH;
        env.PYTHONPATH = existing ? `${modulesPath}${delimiter}${existing}` : modulesPath;
    }
    return env;
}
function parseTokenStats(stderr) {
    const m = stderr.match(/pre=(\d+)\s+post=(\d+)/);
    if (!m)
        return {};
    return { preTokens: Number(m[1]), postTokens: Number(m[2]) };
}
/** Runs `python -m vcc_compact.cli <args>`, resolving the python binary with
 * PYTHON_BIN -> 'python' -> (on ENOENT) 'py -3' fallback. Never throws. */
function runCli(args, opts) {
    const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const env = buildEnv();
    const preferred = opts?.pythonBin ?? process.env.PYTHON_BIN ?? 'python';
    const attempts = [
        { cmd: preferred, args: ['-m', 'vcc_compact.cli', ...args] },
        { cmd: 'py', args: ['-3', '-m', 'vcc_compact.cli', ...args] },
    ];
    let lastError;
    for (const attempt of attempts) {
        const res = spawnSync(attempt.cmd, attempt.args, { encoding: 'utf-8', timeout, env });
        if (res.error) {
            // ENOENT -> try next fallback (e.g. 'py -3'); any other spawn error stops here.
            const code = res.error.code;
            lastError = res.error.message;
            if (code === 'ENOENT')
                continue;
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
export function compactWindowLines(rawLines, opts) {
    let dir;
    try {
        dir = mkdtempSync(join(tmpdir(), 'vcc-window-'));
    }
    catch (err) {
        return { ok: false, error: `could not create temp dir: ${err.message}` };
    }
    const inputPath = join(dir, 'window.jsonl');
    const outPath = join(dir, 'window.out');
    try {
        writeFileSync(inputPath, rawLines.join('\n') + (rawLines.length ? '\n' : ''), 'utf-8');
        const cliArgs = [inputPath, '--out', outPath];
        if (opts?.keep !== undefined)
            cliArgs.push('--keep', String(opts.keep));
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
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
    finally {
        try {
            rmSync(dir, { recursive: true, force: true });
        }
        catch { /* best-effort cleanup */ }
    }
}
/** Compacts a whole JSONL file in place: runs the CLI with --out to a sibling temp
 * file, then atomically renames the temp file over jsonlPath on success. Leaves
 * jsonlPath untouched on any failure. Used by the post-extraction shrink and by
 * the cold-session backfill's TS-callable counterpart (none needed — backfill is
 * pure Python, see ColdSessionBackfill). */
export function compactFileInPlace(jsonlPath, opts) {
    const tmpOut = `${jsonlPath}.vcc-tmp`;
    try {
        const cliArgs = [jsonlPath, '--out', tmpOut];
        if (opts?.keep !== undefined)
            cliArgs.push('--keep', String(opts.keep));
        const res = runCli(cliArgs, opts);
        if (!res.ok) {
            try {
                rmSync(tmpOut, { force: true });
            }
            catch { /* best-effort cleanup */ }
            return { ok: false, error: res.error };
        }
        if (!existsSync(tmpOut)) {
            return { ok: false, error: 'compaction produced no output file' };
        }
        const text = readFileSync(tmpOut, 'utf-8');
        renameSync(tmpOut, jsonlPath);
        const stats = parseTokenStats(res.stderr);
        return { ok: true, text, ...stats };
    }
    catch (err) {
        try {
            rmSync(tmpOut, { force: true });
        }
        catch { /* best-effort cleanup */ }
        return { ok: false, error: err.message };
    }
}
/** Belt-and-braces tripwire for compactToParallelFile: throws if the rename target
 * would resolve to the source jsonlPath. Unreachable in practice — the public
 * function takes no destination parameter, so target is always derived via
 * parallelShrunkPath — but guards against future refactors reintroducing that
 * class of bug. */
function assertNotSource(target, jsonlPath) {
    if (resolve(target) === resolve(jsonlPath)) {
        throw new Error('assertNotSource: rename target resolves to source jsonlPath');
    }
}
/** Returns the sibling shrunk-file path for jsonlPath. Pure — no I/O. */
export function parallelShrunkPath(jsonlPath) {
    return `${jsonlPath}${VCC_SHRUNK_SUFFIX}`;
}
/** Compacts a whole JSONL file to a sibling `.vcc-shrunk.jsonl` file, never touching
 * jsonlPath itself. Reuses compactFileInPlace's runCli/temp-file flow, but renames
 * the temp output to parallelShrunkPath(jsonlPath) instead of over jsonlPath. There
 * is deliberately no destination parameter — the sibling path is always derived. */
export function compactToParallelFile(jsonlPath, opts) {
    const tmpOut = `${jsonlPath}.vcc-tmp`;
    const destPath = parallelShrunkPath(jsonlPath);
    try {
        const cliArgs = [jsonlPath, '--out', tmpOut];
        const res = runCli(cliArgs, opts);
        if (!res.ok) {
            try {
                rmSync(tmpOut, { force: true });
            }
            catch { /* best-effort cleanup */ }
            return { ok: false, error: res.error };
        }
        if (!existsSync(tmpOut)) {
            return { ok: false, error: 'compaction produced no output file' };
        }
        const text = readFileSync(tmpOut, 'utf-8');
        assertNotSource(destPath, jsonlPath);
        renameSync(tmpOut, destPath);
        const stats = parseTokenStats(res.stderr);
        return { ok: true, text, path: destPath, ...stats };
    }
    catch (err) {
        try {
            rmSync(tmpOut, { force: true });
        }
        catch { /* best-effort cleanup */ }
        return { ok: false, error: err.message };
    }
}
//# sourceMappingURL=vcc-bridge.js.map