/**
 * Scratch runner -- NOT part of the project, never committed.
 * Runs V3 (combined enumerate+phase cue) with a 40-candidate cap to see if 20 was a
 * natural stop or a real truncation on session 82629d86's 197K-char compacted output.
 */
import { readFileSync, writeFileSync } from 'fs';
import { SYSTEM_PROMPT_V3_COMBINED } from './scratch-extract-tuned.js';
import { extractUncapped } from './scratch-parse-uncapped.js';

const [, , compactedPath, outPath] = process.argv;
async function main() {
  const text = readFileSync(compactedPath, 'utf-8');
  const cands = await extractUncapped(text, { project: 'LLM_Workflow_Optimization' }, SYSTEM_PROMPT_V3_COMBINED);
  console.error(`[v3-uncapped] ${cands.length} candidates`);
  writeFileSync(outPath, JSON.stringify({ count: cands.length, candidates: cands }, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
