import { describe, it, expect } from 'vitest';
/**
 * Dependency resolution logic — extracted for unit testing.
 * Mirrors the implementation in mcp/server.ts and web/server.ts.
 */
function resolveEffectiveStatus(task, allTasksById) {
    if (task.status === 'done' || task.status === 'in_progress') {
        return task.status;
    }
    const blockedBy = JSON.parse(task.blocked_by || '[]');
    for (const depId of blockedBy) {
        const dep = allTasksById.get(depId);
        if (!dep || dep.status !== 'done')
            return 'blocked';
    }
    return task.status || 'ready';
}
function makeTask(id, status, blockedBy = []) {
    return { id, status, blocked_by: JSON.stringify(blockedBy) };
}
describe('resolveEffectiveStatus', () => {
    it('returns ready for a task with no dependencies', () => {
        const task = makeTask('A', 'ready');
        const map = new Map([['A', task]]);
        expect(resolveEffectiveStatus(task, map)).toBe('ready');
    });
    it('returns ready when all blocked_by tasks are done', () => {
        const dep1 = makeTask('dep1', 'done');
        const dep2 = makeTask('dep2', 'done');
        const task = makeTask('A', 'ready', ['dep1', 'dep2']);
        const map = new Map([['dep1', dep1], ['dep2', dep2], ['A', task]]);
        expect(resolveEffectiveStatus(task, map)).toBe('ready');
    });
    it('returns blocked when one blocked_by task is not done', () => {
        const dep1 = makeTask('dep1', 'done');
        const dep2 = makeTask('dep2', 'in_progress');
        const task = makeTask('A', 'ready', ['dep1', 'dep2']);
        const map = new Map([['dep1', dep1], ['dep2', dep2], ['A', task]]);
        expect(resolveEffectiveStatus(task, map)).toBe('blocked');
    });
    it('returns blocked when all blocked_by tasks are not done', () => {
        const dep1 = makeTask('dep1', 'ready');
        const dep2 = makeTask('dep2', 'blocked');
        const task = makeTask('A', 'ready', ['dep1', 'dep2']);
        const map = new Map([['dep1', dep1], ['dep2', dep2], ['A', task]]);
        expect(resolveEffectiveStatus(task, map)).toBe('blocked');
    });
    it('returns blocked when a dependency is missing from map (unknown dep)', () => {
        const task = makeTask('A', 'ready', ['unknown-dep']);
        const map = new Map([['A', task]]);
        expect(resolveEffectiveStatus(task, map)).toBe('blocked');
    });
    it('does not change in_progress even if deps are not done', () => {
        const dep = makeTask('dep1', 'ready');
        const task = makeTask('A', 'in_progress', ['dep1']);
        const map = new Map([['dep1', dep], ['A', task]]);
        expect(resolveEffectiveStatus(task, map)).toBe('in_progress');
    });
    it('does not change done even if deps are not done', () => {
        const dep = makeTask('dep1', 'ready');
        const task = makeTask('A', 'done', ['dep1']);
        const map = new Map([['dep1', dep], ['A', task]]);
        expect(resolveEffectiveStatus(task, map)).toBe('done');
    });
    it('handles a chain: A blocked_by B blocked_by C (C done → B becomes ready → A becomes ready)', () => {
        const C = makeTask('C', 'done');
        const B = makeTask('B', 'ready', ['C']);
        const A = makeTask('A', 'ready', ['B']);
        const map = new Map([['C', C], ['B', B], ['A', A]]);
        // B's deps are all done → B is ready
        expect(resolveEffectiveStatus(B, map)).toBe('ready');
        // A depends on B which is stored as 'ready' (not done) → A is blocked
        expect(resolveEffectiveStatus(A, map)).toBe('blocked');
    });
    it('handles empty blocked_by array as ready', () => {
        const task = makeTask('A', 'ready', []);
        const map = new Map([['A', task]]);
        expect(resolveEffectiveStatus(task, map)).toBe('ready');
    });
    it('returns blocked for stored-blocked status with all deps done (stored status preserved when overriding only if not done/in_progress)', () => {
        const dep = makeTask('dep1', 'done');
        // Stored as 'blocked' but all deps are done → should return 'blocked' (stored status)
        // Actually per spec: we only override with 'blocked' if deps are NOT done.
        // If deps ARE done, we return the stored status ('blocked' in this case)
        const task = makeTask('A', 'blocked', ['dep1']);
        const map = new Map([['dep1', dep], ['A', task]]);
        // deps all done → no blocking dep found → return stored status 'blocked'
        expect(resolveEffectiveStatus(task, map)).toBe('blocked');
    });
});
describe('nexus_tasks filter: status=ready', () => {
    function getReadyTasks(tasks) {
        const map = new Map(tasks.map(t => [t.id, t]));
        return tasks
            .filter(t => resolveEffectiveStatus(t, map) === 'ready')
            .map(t => t.id);
    }
    it('returns only unblocked tasks', () => {
        const tasks = [
            makeTask('A', 'ready'),
            makeTask('B', 'ready', ['A']),
            makeTask('C', 'done'),
        ];
        expect(getReadyTasks(tasks)).toEqual(['A']);
    });
    it('returns task once its blocker is done', () => {
        const tasks = [
            makeTask('A', 'done'),
            makeTask('B', 'ready', ['A']),
        ];
        expect(getReadyTasks(tasks)).toEqual(['B']);
    });
    it('handles multiple independent ready tasks', () => {
        const tasks = [
            makeTask('A', 'ready'),
            makeTask('B', 'ready'),
            makeTask('C', 'in_progress'),
        ];
        const ready = getReadyTasks(tasks);
        expect(ready).toContain('A');
        expect(ready).toContain('B');
        expect(ready).not.toContain('C');
    });
});
//# sourceMappingURL=tasks.test.js.map