import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readTranscriptWindow } from './transcript.js';

function makeTranscript(entries: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-tx-'));
  const p = join(dir, 'transcript.jsonl');
  writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return p;
}

const userMsg = (content: unknown) => ({ type: 'user', message: { role: 'user', content } });
const asstMsg = (content: unknown) => ({ type: 'assistant', message: { role: 'assistant', content } });

describe('readTranscriptWindow', () => {
  it('condenses user and assistant text', () => {
    const p = makeTranscript([
      userMsg('Build the parser'),
      asstMsg([{ type: 'text', text: 'Done.' }]),
    ]);
    const w = readTranscriptWindow(p, 0);
    expect(w.text).toContain('User: Build the parser');
    expect(w.text).toContain('Assistant: Done.');
    expect(w.newLines).toBe(2);
    expect(w.totalLines).toBe(2);
  });

  it('strips system-reminder noise', () => {
    const p = makeTranscript([
      userMsg('real instruction <system-reminder>ignore this junk</system-reminder>'),
      asstMsg([{ type: 'text', text: 'ok' }]),
    ]);
    const w = readTranscriptWindow(p, 0);
    expect(w.text).toContain('real instruction');
    expect(w.text).not.toContain('junk');
  });

  it('honours the cursor — only reads new lines', () => {
    const p = makeTranscript([
      userMsg('one'), asstMsg([{ type: 'text', text: 'a' }]),
      userMsg('two'), asstMsg([{ type: 'text', text: 'b' }]),
      userMsg('three'),
    ]);
    const w = readTranscriptWindow(p, 3);
    expect(w.newLines).toBe(2);
    expect(w.totalLines).toBe(5);
    expect(w.text).toContain('three');
    expect(w.text).not.toContain('one');
  });

  it('renders tool use and tool errors', () => {
    const p = makeTranscript([
      asstMsg([{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }]),
      userMsg([{ type: 'tool_result', content: 'boom', is_error: true }]),
    ]);
    const w = readTranscriptWindow(p, 0);
    expect(w.text).toContain('Assistant → Bash(');
    expect(w.text).toContain('[tool ERROR] boom');
  });

  it('gates out a trivial window (no signal)', () => {
    const p = makeTranscript([userMsg('hi')]);
    const w = readTranscriptWindow(p, 0);
    expect(w.hasSignal).toBe(false);
  });

  it('flags a window with a correction marker as signal', () => {
    const p = makeTranscript([
      userMsg("no, don't do it that way"),
      asstMsg([{ type: 'text', text: 'understood' }]),
    ]);
    const w = readTranscriptWindow(p, 0);
    expect(w.hasSignal).toBe(true);
  });

  it('returns an empty window for a missing file', () => {
    const w = readTranscriptWindow(join(tmpdir(), 'does-not-exist-xyz.jsonl'), 0);
    expect(w.totalLines).toBe(0);
    expect(w.hasSignal).toBe(false);
  });
});
