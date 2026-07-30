/**
 * Scratch, read-only comparison script -- NOT part of the project, never committed.
 * Compares Nexus's built-in transcript condenser (readTranscriptWindow) against
 * vcc_compact's compacted output as input to the real memory extractor, on the
 * same real session. No DB is opened, no writes happen anywhere -- extractMemories()
 * only calls the extraction LLM and returns an in-memory result.
 *
 * Usage: node --loader ts-node/esm scratch-vcc-compare.ts <session.jsonl> <compacted.txt>
 */
import { readTranscriptWindow } from './src/capture/transcript.js';
import { extractMemories } from './src/capture/extract.js';
import { readFileSync, writeFileSync } from 'fs';

const [, , jsonlPath, compactedPath] = process.argv;
if (!jsonlPath || !compactedPath) {
  console.error('Usage: node --loader ts-node/esm scratch-vcc-compare.ts <session.jsonl> <compacted.txt>');
  process.exit(1);
}

async function main() {
  const window = readTranscriptWindow(jsonlPath, 0);
  console.error(`[raw] condensed length: ${window.text.length} chars, truncated: ${window.truncated}, hasSignal: ${window.hasSignal}`);

  const compactedText = readFileSync(compactedPath, 'utf-8');
  console.error(`[vcc] compacted length: ${compactedText.length} chars`);

  console.error('Extracting from raw-condensed text...');
  const rawCandidates = await extractMemories(window.text, { project: 'LLM_Workflow_Optimization' });
  console.error(`[raw] extracted ${rawCandidates.length} candidates`);

  console.error('Extracting from vcc_compact text...');
  const compactedCandidates = await extractMemories(compactedText, { project: 'LLM_Workflow_Optimization' });
  console.error(`[vcc] extracted ${compactedCandidates.length} candidates`);

  const result = {
    input_sizes: { raw_condensed_chars: window.text.length, raw_truncated: window.truncated, vcc_compacted_chars: compactedText.length },
    raw_candidates: rawCandidates,
    compacted_candidates: compactedCandidates,
  };
  writeFileSync('scratch-vcc-compare-result.json', JSON.stringify(result, null, 2));
  console.error('Wrote scratch-vcc-compare-result.json');
}

main().catch(e => { console.error(e); process.exit(1); });
