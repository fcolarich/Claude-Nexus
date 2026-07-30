/**
 * Scratch, read-only -- NOT part of the project, never committed.
 * Simulates the REAL production cadence: reflect() fires on every Stop/PreCompact
 * event (roughly once per assistant turn), each time compacting only window.rawLines
 * (the delta since the last cursor) via vcc-bridge.compactWindowLines() -- exactly
 * reflector.ts's pre-extraction call -- then extracting from that small window.
 *
 * This is the untested production shape: everything tested so far ran vcc_compact
 * on the WHOLE session at once. Here each window is a small raw-JSONL slice, matching
 * what compactWindowLines() actually receives in prod.
 *
 * Observer gate reimplemented inline (same regexes/thresholds as transcript.ts) so
 * windows with no signal are skipped without an LLM call, matching reflect()'s
 * behavior exactly (advance cursor, skip extraction).
 *
 * No DB access anywhere. compactWindowLines spawns the real `python -m vcc_compact.cli`
 * subprocess per window (same as production) -- VCC_COMPACT_MODULES_PATH must be set.
 *
 * Usage: node --loader ts-node/esm scratch-incremental-sim.ts <session.jsonl> <windowLines> <out.json>
 */
import { readFileSync, writeFileSync } from 'fs';
import { compactWindowLines } from './src/capture/vcc-bridge.js';
import { extractMemories } from './src/capture/extract.js';
import { extractMemoriesTuned, SYSTEM_PROMPT_V2_PHASE } from './scratch-extract-tuned.js';

const CORRECTION_RE = /\b(no,|don'?t|stop|actually|that'?s? wrong|not like that|instead|never (do|use)|that'?s not what)\b/i;
const PREFERENCE_RE = /\b(I prefer|always |never |from now on|going forward|in future|make sure (to|you)|please (always|never))\b/i;

interface RawEntry { type?: string; message?: { role?: string; content?: unknown } }
interface Block { type?: string; text?: string; content?: unknown; is_error?: boolean }

function stripNoise(s: string): string {
  return s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-[^>]*>[\s\S]*?<\/local-command-[^>]*>/g, '')
    .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, '')
    .trim();
}

/** Mirrors transcript.ts's hasSignal gate, applied to a bounded slice of raw lines. */
function hasSignal(rawLines: string[]): boolean {
  let userMessages = 0, exchanges = 0, markerSignal = false, toolErrors = 0;
  for (const line of rawLines) {
    let entry: RawEntry;
    try { entry = JSON.parse(line); } catch { continue; }
    const role = entry.message?.role ?? entry.type;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = entry.message?.content;
    if (typeof content === 'string') {
      exchanges++;
      if (role === 'user') {
        userMessages++;
        const txt = stripNoise(content);
        if (CORRECTION_RE.test(txt) || PREFERENCE_RE.test(txt)) markerSignal = true;
      }
    } else if (Array.isArray(content)) {
      let any = false;
      for (const b of content as Block[]) {
        if (b?.type === 'text' && typeof b.text === 'string' && stripNoise(b.text)) {
          any = true;
          if (role === 'user') {
            userMessages++;
            if (CORRECTION_RE.test(b.text) || PREFERENCE_RE.test(b.text)) markerSignal = true;
          }
        }
        if (b?.type === 'tool_result' && b.is_error) toolErrors++;
      }
      if (any) exchanges++;
    }
  }
  return markerSignal || toolErrors > 0 || (userMessages >= 1 && exchanges >= 4);
}

async function main() {
  const [, , jsonlPath, windowLinesArg, outPath] = process.argv;
  const windowSize = Number(windowLinesArg) || 80;

  const allLines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(l => l.trim());
  console.error(`[sim] ${allLines.length} raw lines, window=${windowSize}`);

  let cursor = 0;
  let windowIdx = 0;
  let skippedWindows = 0;
  let vccFailWindows = 0;
  const untunedAll: unknown[] = [];
  const v2All: unknown[] = [];
  const windowLog: { idx: number; lines: number; signal: boolean; vccOk: boolean; vccChars?: number; untunedCount?: number; v2Count?: number }[] = [];

  while (cursor < allLines.length) {
    const end = Math.min(cursor + windowSize, allLines.length);
    const slice = allLines.slice(cursor, end);
    windowIdx++;

    const signal = hasSignal(slice);
    if (!signal) {
      skippedWindows++;
      windowLog.push({ idx: windowIdx, lines: slice.length, signal: false, vccOk: false });
      cursor = end;
      continue;
    }

    const compacted = compactWindowLines(slice, { timeoutMs: 15_000 });
    if (!compacted.ok || !compacted.text) {
      vccFailWindows++;
      console.error(`[sim] window ${windowIdx} vcc FAILED: ${compacted.error}`);
      windowLog.push({ idx: windowIdx, lines: slice.length, signal: true, vccOk: false });
      cursor = end;
      continue;
    }

    console.error(`[sim] window ${windowIdx} (lines ${cursor}-${end}): vcc ok, ${compacted.text.length} chars`);

    const untuned = await extractMemories(compacted.text, { project: 'LLM_Workflow_Optimization' });
    const v2 = await extractMemoriesTuned(compacted.text, { project: 'LLM_Workflow_Optimization' }, SYSTEM_PROMPT_V2_PHASE);
    console.error(`[sim]   untuned=${untuned.length} v2=${v2.length}`);

    untunedAll.push(...untuned.map(c => ({ ...c, _window: windowIdx })));
    v2All.push(...v2.map(c => ({ ...c, _window: windowIdx })));
    windowLog.push({ idx: windowIdx, lines: slice.length, signal: true, vccOk: true, vccChars: compacted.text.length, untunedCount: untuned.length, v2Count: v2.length });

    cursor = end;
  }

  console.error(`[sim] done: ${windowIdx} windows, ${skippedWindows} skipped (no signal), ${vccFailWindows} vcc failures`);
  console.error(`[sim] total untuned candidates: ${untunedAll.length}, total v2 candidates: ${v2All.length}`);

  writeFileSync(outPath, JSON.stringify({
    totalRawLines: allLines.length,
    windowSize,
    totalWindows: windowIdx,
    skippedWindows,
    vccFailWindows,
    windowLog,
    untuned_candidates: untunedAll,
    v2_candidates: v2All,
  }, null, 2));
  console.error(`Wrote ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
