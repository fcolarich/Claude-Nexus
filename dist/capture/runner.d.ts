/**
 * Reflector runner — standalone entry point spawned (detached) by the
 * nexus-capture hook. Does not depend on the Nexus web server.
 *
 * Usage: node dist/capture/runner.js <session_id> <transcript_path> [cwd]
 */
import Database from 'better-sqlite3';
import type { HaikuFn } from './feedback-judge.js';
/**
 * Retrospective usefulness pass: reads the session's recall-state file, judges
 * any not-yet-evaluated injected memories against the full transcript, records
 * feedback, and marks those ids evaluated so a later Stop/PreCompact/SessionEnd
 * firing in the same session doesn't re-judge them.
 *
 * Best-effort by design (mirrors reflect()): a missing state file, an empty
 * unevaluated set, or a malformed judge response are all silent no-ops — this
 * runs in the same detached process that must never fail loudly. `haikuFn` is
 * injectable for tests; omit it in production to use judgeMemoryUsefulness's
 * own default (callModel).
 */
export declare function runFeedbackPass(db: Database.Database, sessionId: string, transcriptText: string, stateDir?: string, haikuFn?: HaikuFn): Promise<void>;
//# sourceMappingURL=runner.d.ts.map