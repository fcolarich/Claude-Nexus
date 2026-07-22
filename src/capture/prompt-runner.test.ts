import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadInjected, saveInjected } from './prompt-runner.js';

describe('recall-state file (injected-memory tracking)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nexus-recall-state-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loadInjected returns an empty map for a missing file', () => {
    const result = loadInjected('no-such-session', dir);
    expect(result.size).toBe(0);
  });

  it('saveInjected then loadInjected round-trips ids with evaluated:false by default', () => {
    saveInjected('sess-1', new Map([['mem-a', false], ['mem-b', false]]), dir);
    const result = loadInjected('sess-1', dir);
    expect(result.get('mem-a')).toBe(false);
    expect(result.get('mem-b')).toBe(false);
  });

  it('loadInjected migrates a legacy flat string[] file to {evaluated:false} entries', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sess-legacy.json'), JSON.stringify(['mem-x', 'mem-y']));
    const result = loadInjected('sess-legacy', dir);
    expect(result.get('mem-x')).toBe(false);
    expect(result.get('mem-y')).toBe(false);
  });

  it('saveInjected preserves evaluated:true entries', () => {
    saveInjected('sess-2', new Map([['mem-a', true], ['mem-b', false]]), dir);
    const raw = JSON.parse(readFileSync(join(dir, 'sess-2.json'), 'utf-8'));
    expect(raw.find((e: { id: string }) => e.id === 'mem-a').evaluated).toBe(true);
    expect(raw.find((e: { id: string }) => e.id === 'mem-b').evaluated).toBe(false);
  });

  it('loadInjected on a corrupt file returns an empty map', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sess-bad.json'), '{not json');
    const result = loadInjected('sess-bad', dir);
    expect(result.size).toBe(0);
  });
});
