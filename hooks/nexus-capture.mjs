#!/usr/bin/env node
/**
 * nexus-capture — Claude Code Stop / PreCompact / SessionEnd hook.
 *
 * Reads the hook payload from stdin, then spawns the Reflector runner as a
 * fully detached background process and exits immediately. It NEVER blocks the
 * session: any failure is swallowed and the hook still exits 0.
 *
 * Register in ~/.claude/settings.json — see hooks/README.md.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

async function readStdin() {
  let input = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

try {
  const raw = await readStdin();
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { /* malformed — exit clean */ }

  const sessionId = payload.session_id;
  const transcriptPath = payload.transcript_path;
  const cwd = payload.cwd || process.cwd();

  const here = dirname(fileURLToPath(import.meta.url));
  const runner = join(here, '..', 'dist', 'capture', 'runner.js');

  if (sessionId && transcriptPath && existsSync(runner)) {
    const child = spawn(process.execPath, [runner, sessionId, transcriptPath, cwd], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }
} catch {
  // Capture is best-effort — never disrupt the session.
}

process.exit(0);
