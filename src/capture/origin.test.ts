import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { join, parse } from 'path';
import * as os from 'os';
import { classifyOrigin } from './origin.js';

// Node's `os` module namespace is not configurable in ESM, so vi.spyOn(os, 'homedir')
// throws ("Cannot redefine property"). Re-exporting homedir as a vi.fn() wrapper
// around the real implementation keeps every other os.* export untouched while
// making homedir mockable for the fail-open test below.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: vi.fn(actual.homedir) };
});

const cfg = { commands: ['harvest-knowledge'], scheduled_tasks: ['nexus-memory-distill'] };

// A real, non-home, non-root cwd — used for every test that isn't specifically
// exercising the new non-project-cwd check, so the existing scheduled-task /
// command-name coverage keeps asserting only what it always has.
const projectCwd = join(os.tmpdir(), 'origin-test-project');

function transcript(...lines: string[]): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'origin-'));
  const p = join(dir, 'session.jsonl');
  writeFileSync(p, lines.join('\n') + '\n', 'utf-8');
  return p;
}

// Transcripts are JSON-encoded, so the marker's quotes arrive escaped on disk.
const scheduledLine = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: '<scheduled-task name="nexus-memory-distill" file="x">go</scheduled-task>' },
});
const commandLine = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: '<command-name>/harvest-knowledge</command-name>' },
});
const plainLine = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: 'refactor the auth module' },
});

describe('classifyOrigin', () => {
  it('excludes on NEXUS_NO_CAPTURE without needing a transcript', () => {
    const v = classifyOrigin('/does/not/exist.jsonl', projectCwd, cfg, { NEXUS_NO_CAPTURE: '1' });
    expect(v.excluded).toBe(true);
    expect(v.reason).toBe('NEXUS_NO_CAPTURE');
  });

  it('ignores NEXUS_NO_CAPTURE=0', () => {
    expect(classifyOrigin(transcript(plainLine), projectCwd, cfg, { NEXUS_NO_CAPTURE: '0' }).excluded).toBe(false);
  });

  it('excludes a denylisted scheduled task through JSON escaping', () => {
    const v = classifyOrigin(transcript(scheduledLine), projectCwd, cfg, {});
    expect(v.excluded).toBe(true);
    expect(v.reason).toBe('scheduled-task:nexus-memory-distill');
  });

  it('excludes a denylisted command', () => {
    const v = classifyOrigin(transcript(commandLine), projectCwd, cfg, {});
    expect(v.excluded).toBe(true);
    expect(v.reason).toBe('command:/harvest-knowledge');
  });

  it('does not exclude an ordinary session', () => {
    expect(classifyOrigin(transcript(plainLine), projectCwd, cfg, {}).excluded).toBe(false);
  });

  it('does not exclude a task/command that is not on the denylist', () => {
    const other = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: '<scheduled-task name="some-other-task" file="x">go</scheduled-task>' },
    });
    expect(classifyOrigin(transcript(other), projectCwd, cfg, {}).excluded).toBe(false);
  });

  it('fails OPEN when the transcript is missing', () => {
    expect(classifyOrigin('/does/not/exist.jsonl', projectCwd, cfg, {}).excluded).toBe(false);
  });

  it('finds a marker pushed past 40KB by injected context', () => {
    const bigInjection = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'CLAUDE.md context: ' + 'x'.repeat(60_000) },
    });
    const v = classifyOrigin(transcript(bigInjection, scheduledLine), projectCwd, cfg, {});
    expect(v.excluded).toBe(true);
    expect(v.reason).toBe('scheduled-task:nexus-memory-distill');
  });

  it('matches a plugin-namespaced command against a bare denylist entry', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: '<command-name>llm-workflow-knowledge:harvest-knowledge</command-name>' },
    });
    const v = classifyOrigin(transcript(line), projectCwd, cfg, {});
    expect(v.excluded).toBe(true);
  });

  it('matches when the denylist entry is itself fully qualified', () => {
    const qualified = { commands: ['unity-knowledge:extract-knowledge'], scheduled_tasks: [] };
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: '<command-name>unity-knowledge:extract-knowledge</command-name>' },
    });
    expect(classifyOrigin(transcript(line), projectCwd, qualified, {}).excluded).toBe(true);
  });

  it('still does not match an unrelated namespaced command', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: '<command-name>shared-skills:brainstorming</command-name>' },
    });
    expect(classifyOrigin(transcript(line), projectCwd, cfg, {}).excluded).toBe(false);
  });
});

describe('classifyOrigin — non-project-cwd exclusion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('excludes when cwd is exactly the OS home directory', () => {
    const home = os.homedir();
    const v = classifyOrigin(transcript(plainLine), home, cfg, {});
    expect(v.excluded).toBe(true);
    expect(v.reason).toBe(`non-project-cwd:${home}`);
  });

  it('excludes when cwd is a filesystem/drive root', () => {
    // parse(...).root gives the platform-correct root (C:\ on win32, / on POSIX)
    // for wherever this test happens to run, matching architecture.md's
    // path.parse().root-based detection rather than a hand-rolled regex.
    const root = parse(process.cwd()).root;
    const v = classifyOrigin(transcript(plainLine), root, cfg, {});
    expect(v.excluded).toBe(true);
    expect(v.reason).toBe(`non-project-cwd:${root}`);
  });

  it('does not exclude a real project directory (regression: narrow denylist must not over-match)', () => {
    const v = classifyOrigin(transcript(plainLine), 'C:\\Fran\\claude-nexus', cfg, {});
    expect(v.excluded).toBe(false);
  });

  it('fails OPEN when os.homedir() throws internally', () => {
    // Per architecture.md's isNonProjectCwd/classifyOrigin split, classifyOrigin
    // owns the only fallible call (os.homedir()) in a try/catch. The cwd value
    // here is irrelevant to the assertion — classifyOrigin must never reach
    // isNonProjectCwd once os.homedir() has thrown.
    vi.mocked(os.homedir).mockImplementationOnce(() => {
      throw new Error('boom: cannot resolve home directory');
    });
    const v = classifyOrigin(transcript(plainLine), projectCwd, cfg, {});
    expect(v.excluded).toBe(false);
    expect(v.reason).toBe(null);
  });
});
