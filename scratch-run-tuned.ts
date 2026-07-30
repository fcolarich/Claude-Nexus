/**
 * Scratch runner -- NOT part of the project, never committed.
 * Runs all 3 tuned prompt variants (scratch-extract-tuned.ts) against one vcc_compact
 * output, full text (no truncation). No DB access -- pure LLM calls.
 *
 * Usage: node --loader ts-node/esm scratch-run-tuned.ts <compacted.txt> <output.json>
 */
import { readFileSync, writeFileSync } from 'fs';
import {
  extractMemoriesTuned,
  SYSTEM_PROMPT_V1_ENUMERATE,
  SYSTEM_PROMPT_V2_PHASE,
  SYSTEM_PROMPT_V3_COMBINED,
} from './scratch-extract-tuned.js';

const [, , compactedPath, outPath] = process.argv;
if (!compactedPath || !outPath) {
  console.error('Usage: node --loader ts-node/esm scratch-run-tuned.ts <compacted.txt> <output.json>');
  process.exit(1);
}

async function main() {
  const text = readFileSync(compactedPath, 'utf-8');
  console.error(`[input] ${text.length} chars`);

  console.error('Running V1 (enumerate-all)...');
  const v1 = await extractMemoriesTuned(text, { project: 'LLM_Workflow_Optimization' }, SYSTEM_PROMPT_V1_ENUMERATE);
  console.error(`[v1] ${v1.length} candidates`);

  console.error('Running V2 (phase-cue)...');
  const v2 = await extractMemoriesTuned(text, { project: 'LLM_Workflow_Optimization' }, SYSTEM_PROMPT_V2_PHASE);
  console.error(`[v2] ${v2.length} candidates`);

  console.error('Running V3 (combined)...');
  const v3 = await extractMemoriesTuned(text, { project: 'LLM_Workflow_Optimization' }, SYSTEM_PROMPT_V3_COMBINED);
  console.error(`[v3] ${v3.length} candidates`);

  writeFileSync(outPath, JSON.stringify({
    input_chars: text.length,
    v1_enumerate: v1,
    v2_phase: v2,
    v3_combined: v3,
  }, null, 2));
  console.error(`Wrote ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
