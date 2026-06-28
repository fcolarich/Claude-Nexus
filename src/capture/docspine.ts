/**
 * Doc-spine reader — surfaces a project's existing ADR/DDR decisions so the
 * extractor can prefer thin pointers over restating canonical decisions.
 * Any filesystem error degrades to [] — a missing spine is the normal case.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DECISION_FILE_RE = /^(adr|ddr)-\d+.*\.md$/i;

/** e.g. ["ADR-001: UPM package-per-tool baseline", "DDR-001: Naming convention"]. */
export function readDecisionIndex(cwd: string | undefined): string[] {
  if (!cwd) return [];
  try {
    const dir = join(cwd, '_documents', 'decisions');
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const f of readdirSync(dir).sort()) {
      if (!DECISION_FILE_RE.test(f)) continue;
      const id = f.replace(/\.md$/i, '').split('-').slice(0, 2).join('-').toUpperCase(); // ADR-001
      let title = '';
      try {
        const text = readFileSync(join(dir, f), 'utf-8');
        const m = text.match(/^#\s+(.+)$/m);
        title = m ? m[1].trim() : '';
      } catch { /* unreadable file — keep the id alone */ }
      out.push(title ? `${id}: ${title}` : id);
    }
    return out;
  } catch {
    return [];
  }
}
