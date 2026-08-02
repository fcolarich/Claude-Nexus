/**
 * Origin classifier — decides whether a session may write memories at all.
 *
 * Capture noise has three sources. Two are about WHO is running: book/article
 * processing (prose insights that belong in the Knowledge bases, not Nexus) and
 * distill-audit runs (the system generating memories about auditing its own
 * memories, a self-feeding loop). This module owns those. The third — file
 * content read during ordinary work — is a WHAT question, handled by the
 * tool-result scrubber in transcript.ts.
 *
 * Consumed by reflect() for live capture and by scripts/purge-origin.mjs for the
 * retroactive pass, so historical and going-forward rules cannot drift apart.
 */

import { readFileSync, existsSync } from 'fs';

export interface OriginVerdict {
  excluded: boolean;
  reason: string | null;
}

export interface ExcludeConfig {
  commands: string[];
  scheduled_tasks: string[];
}

const NOT_EXCLUDED: OriginVerdict = { excluded: false, reason: null };

/** Origin markers live in the opening turns; no need to scan a 40MB transcript. */
const SCAN_CHARS = 40_000;

// Transcript lines are JSON-encoded, so a marker written as name="x" is stored
// as name=\"x\". Tolerate the optional backslash on both sides of the value.
const SCHEDULED_TASK_RE = /<scheduled-task\s+name=\\?"([^"\\]+)/g;
const COMMAND_NAME_RE = /<command-name>\\?\/?([a-z0-9:_-]+)<\/command-name>/gi;

const normalize = (s: string) => s.replace(/^\//, '').toLowerCase();

export function classifyOrigin(
  transcriptPath: string,
  cfg: ExcludeConfig,
  env: NodeJS.ProcessEnv = process.env,
): OriginVerdict {
  // Explicit opt-out wins and needs no transcript, so a wrapper script can
  // silence capture for anything (CI, manual bulk runs) without config edits.
  const optOut = env.NEXUS_NO_CAPTURE;
  if (optOut && optOut !== '0' && optOut.toLowerCase() !== 'false') {
    return { excluded: true, reason: 'NEXUS_NO_CAPTURE' };
  }

  let head: string;
  try {
    if (!existsSync(transcriptPath)) return NOT_EXCLUDED;
    head = readFileSync(transcriptPath, 'utf-8').slice(0, SCAN_CHARS);
  } catch {
    // Fail OPEN. A classifier that cannot read the transcript must never be
    // the reason a real memory is silently lost.
    return NOT_EXCLUDED;
  }

  const tasks = (cfg.scheduled_tasks ?? []).map(normalize);
  for (const m of head.matchAll(SCHEDULED_TASK_RE)) {
    if (tasks.includes(normalize(m[1]))) {
      return { excluded: true, reason: `scheduled-task:${m[1]}` };
    }
  }

  const commands = (cfg.commands ?? []).map(normalize);
  for (const m of head.matchAll(COMMAND_NAME_RE)) {
    const name = normalize(m[1]);
    if (commands.includes(name)) {
      return { excluded: true, reason: `command:/${name}` };
    }
  }

  return NOT_EXCLUDED;
}
