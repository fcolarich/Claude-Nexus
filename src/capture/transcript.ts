/**
 * Transcript reader + condenser — the Observer layer of the capture pipeline.
 *
 * Reads a Claude Code session JSONL from a cursor index, strips noise (system
 * reminders, bulky tool output), and condenses it into LLM-ready text for the
 * Reflector. Also reports whether the new window holds any memory-worthy signal,
 * so the Reflector can skip the LLM call on trivial windows.
 */

import { readFileSync, existsSync } from 'fs';

/** Hard cap on condensed text handed to the extractor (~15-20k tokens). */
const MAX_CHARS = 60_000;
const TOOL_RESULT_CAP = 200;
const TOOL_INPUT_CAP = 160;

export interface TranscriptWindow {
  text: string;          // condensed, LLM-ready
  rawLines: string[];    // raw JSONL lines sliced from fromIndex (uncondensed)
  totalLines: number;    // total lines in the file (the next cursor value)
  newLines: number;      // lines read in this window
  hasSignal: boolean;    // false => trivial window, skip extraction
  truncated: boolean;    // condensed text exceeded MAX_CHARS
}

interface RawEntry {
  type?: string;
  message?: { role?: string; content?: unknown };
}

/** Remove harness-injected noise that is never memory-worthy. */
function stripNoise(s: string): string {
  return s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<local-command-[^>]*>[\s\S]*?<\/local-command-[^>]*>/g, '')
    .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, '')
    .replace(/<[a-z-]*system[a-z-]*>[\s\S]*?<\/[a-z-]*system[a-z-]*>/gi, '')
    .trim();
}

function truncate(s: string, cap: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > cap ? t.slice(0, cap) + '…' : t;
}

interface Block { type?: string; text?: string; name?: string; input?: unknown; content?: unknown; is_error?: boolean }

/** Convert one message's content blocks into condensed transcript lines. */
function renderContent(content: unknown, role: string): string[] {
  const out: string[] = [];

  if (typeof content === 'string') {
    const clean = stripNoise(content);
    if (clean) out.push(`${role === 'user' ? 'User' : 'Assistant'}: ${clean}`);
    return out;
  }
  if (!Array.isArray(content)) return out;

  for (const raw of content as Block[]) {
    if (!raw || typeof raw !== 'object') continue;
    if (raw.type === 'text' && typeof raw.text === 'string') {
      const clean = stripNoise(raw.text);
      if (clean) out.push(`${role === 'user' ? 'User' : 'Assistant'}: ${clean}`);
    } else if (raw.type === 'tool_use') {
      const input = raw.input !== undefined ? truncate(JSON.stringify(raw.input), TOOL_INPUT_CAP) : '';
      out.push(`Assistant → ${raw.name ?? 'tool'}(${input})`);
    } else if (raw.type === 'tool_result') {
      let body = '';
      if (typeof raw.content === 'string') body = raw.content;
      else if (Array.isArray(raw.content)) {
        body = (raw.content as Block[]).filter(b => b?.type === 'text').map(b => b.text ?? '').join(' ');
      }
      const tag = raw.is_error ? 'tool ERROR' : 'tool result';
      const t = truncate(body, TOOL_RESULT_CAP);
      if (t) out.push(`[${tag}] ${t}`);
      else if (raw.is_error) out.push(`[${tag}]`);
    }
    // 'thinking' and other block types are dropped
  }
  return out;
}

const CORRECTION_RE = /\b(no,|don'?t|stop|actually|that'?s? wrong|not like that|instead|never (do|use)|that'?s not what)\b/i;
const PREFERENCE_RE = /\b(I prefer|always |never |from now on|going forward|in future|make sure (to|you)|please (always|never))\b/i;

/**
 * Read a session JSONL from `fromIndex` to the end and condense it.
 * `fromIndex` is the count of lines already reflected (sessions.last_reflected_index).
 */
export function readTranscriptWindow(jsonlPath: string, fromIndex: number): TranscriptWindow {
  if (!existsSync(jsonlPath)) {
    return { text: '', rawLines: [], totalLines: 0, newLines: 0, hasSignal: false, truncated: false };
  }

  const lines = readFileSync(jsonlPath, 'utf-8').split('\n').filter(l => l.trim());
  const totalLines = lines.length;
  const fresh = lines.slice(Math.max(0, fromIndex));

  const rendered: string[] = [];
  let userMessages = 0;
  let exchanges = 0;
  let markerSignal = false;
  let toolErrors = 0;

  for (const line of fresh) {
    let entry: RawEntry;
    try { entry = JSON.parse(line); } catch { continue; }

    const role = entry.message?.role ?? entry.type;
    if (role !== 'user' && role !== 'assistant') continue;

    const parts = renderContent(entry.message?.content, role);
    if (parts.length === 0) continue;
    exchanges++;

    for (const p of parts) {
      if (p.startsWith('User: ')) {
        userMessages++;
        const txt = p.slice(6);
        if (CORRECTION_RE.test(txt) || PREFERENCE_RE.test(txt)) markerSignal = true;
      }
      if (p.startsWith('[tool ERROR]')) toolErrors++;
    }
    rendered.push(parts.join('\n'));
  }

  let text = rendered.join('\n\n');
  let truncated = false;
  if (text.length > MAX_CHARS) {
    text = text.slice(text.length - MAX_CHARS); // keep most recent
    truncated = true;
  }

  // Observer gate: extract when there is a real exchange or an explicit marker.
  const hasSignal = markerSignal || toolErrors > 0 || (userMessages >= 1 && exchanges >= 4);

  return { text, rawLines: fresh, totalLines, newLines: fresh.length, hasSignal, truncated };
}
