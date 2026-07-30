/**
 * Scratch, read-only control experiment -- NOT part of the project, never committed.
 * Tests whether vcc_compact's lower extracted-candidate count is explained by input
 * LENGTH (197K chars vs raw's 60K-capped tail) rather than by its narrative FORMAT.
 * Truncates vcc's compacted text to the same 60,000-char tail-keep policy Nexus's own
 * condenser uses, then extracts from that -- same format, same size as the raw run.
 */
import { extractMemories } from './src/capture/extract.js';
import { readFileSync, writeFileSync } from 'fs';

const [, , compactedPath] = process.argv;
if (!compactedPath) {
  console.error('Usage: node --loader ts-node/esm scratch-vcc-compare2.ts <compacted.txt>');
  process.exit(1);
}

const MAX_CHARS = 60_000;

async function main() {
  const fullText = readFileSync(compactedPath, 'utf-8');
  const truncated = fullText.length > MAX_CHARS ? fullText.slice(fullText.length - MAX_CHARS) : fullText;
  console.error(`[vcc-full] ${fullText.length} chars`);
  console.error(`[vcc-60k-tail] ${truncated.length} chars (same tail-keep policy as raw)`);

  console.error('Extracting from vcc full text (197K, already have this from run 1)...');
  console.error('Extracting from vcc 60K-tail-truncated text (length-matched control)...');
  const truncatedCandidates = await extractMemories(truncated, { project: 'LLM_Workflow_Optimization' });
  console.error(`[vcc-60k-tail] extracted ${truncatedCandidates.length} candidates`);

  writeFileSync('scratch-vcc-compare2-result.json', JSON.stringify({
    vcc_60k_tail_chars: truncated.length,
    vcc_60k_tail_candidates: truncatedCandidates,
  }, null, 2));
  console.error('Wrote scratch-vcc-compare2-result.json');
}

main().catch(e => { console.error(e); process.exit(1); });
