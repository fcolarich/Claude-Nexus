import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { classifyOrigin } from './origin.js';
const cfg = { commands: ['harvest-knowledge'], scheduled_tasks: ['nexus-memory-distill'] };
function transcript(...lines) {
    const dir = mkdtempSync(join(tmpdir(), 'origin-'));
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
        const v = classifyOrigin('/does/not/exist.jsonl', cfg, { NEXUS_NO_CAPTURE: '1' });
        expect(v.excluded).toBe(true);
        expect(v.reason).toBe('NEXUS_NO_CAPTURE');
    });
    it('ignores NEXUS_NO_CAPTURE=0', () => {
        expect(classifyOrigin(transcript(plainLine), cfg, { NEXUS_NO_CAPTURE: '0' }).excluded).toBe(false);
    });
    it('excludes a denylisted scheduled task through JSON escaping', () => {
        const v = classifyOrigin(transcript(scheduledLine), cfg, {});
        expect(v.excluded).toBe(true);
        expect(v.reason).toBe('scheduled-task:nexus-memory-distill');
    });
    it('excludes a denylisted command', () => {
        const v = classifyOrigin(transcript(commandLine), cfg, {});
        expect(v.excluded).toBe(true);
        expect(v.reason).toBe('command:/harvest-knowledge');
    });
    it('does not exclude an ordinary session', () => {
        expect(classifyOrigin(transcript(plainLine), cfg, {}).excluded).toBe(false);
    });
    it('does not exclude a task/command that is not on the denylist', () => {
        const other = JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '<scheduled-task name="some-other-task" file="x">go</scheduled-task>' },
        });
        expect(classifyOrigin(transcript(other), cfg, {}).excluded).toBe(false);
    });
    it('fails OPEN when the transcript is missing', () => {
        expect(classifyOrigin('/does/not/exist.jsonl', cfg, {}).excluded).toBe(false);
    });
    it('finds a marker pushed past 40KB by injected context', () => {
        const bigInjection = JSON.stringify({
            type: 'user',
            message: { role: 'user', content: 'CLAUDE.md context: ' + 'x'.repeat(60_000) },
        });
        const v = classifyOrigin(transcript(bigInjection, scheduledLine), cfg, {});
        expect(v.excluded).toBe(true);
        expect(v.reason).toBe('scheduled-task:nexus-memory-distill');
    });
    it('matches a plugin-namespaced command against a bare denylist entry', () => {
        const line = JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '<command-name>llm-workflow-knowledge:harvest-knowledge</command-name>' },
        });
        const v = classifyOrigin(transcript(line), cfg, {});
        expect(v.excluded).toBe(true);
    });
    it('matches when the denylist entry is itself fully qualified', () => {
        const qualified = { commands: ['unity-knowledge:extract-knowledge'], scheduled_tasks: [] };
        const line = JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '<command-name>unity-knowledge:extract-knowledge</command-name>' },
        });
        expect(classifyOrigin(transcript(line), qualified, {}).excluded).toBe(true);
    });
    it('still does not match an unrelated namespaced command', () => {
        const line = JSON.stringify({
            type: 'user',
            message: { role: 'user', content: '<command-name>shared-skills:brainstorming</command-name>' },
        });
        expect(classifyOrigin(transcript(line), cfg, {}).excluded).toBe(false);
    });
});
//# sourceMappingURL=origin.test.js.map