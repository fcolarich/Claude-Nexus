/**
 * The Reflector — core of the capture pipeline.
 *
 * Reads a session transcript from its reflection cursor, condenses it, extracts
 * typed memory candidates, dedup/merges them against existing memories, writes
 * the survivors, and advances the cursor. Idempotent: re-running only processes
 * transcript lines added since the last run.
 *
 * Markdown export is the caller's responsibility (runner / API) so reflect()
 * stays filesystem-free and unit-testable.
 */
import Database from 'better-sqlite3';
import { type Extractor } from './extract.js';
import { compactWindowLines, compactFileInPlace } from './vcc-bridge.js';
import { redactSecrets } from './secrets.js';
export interface ReflectOptions {
    session_id: string;
    transcript_path: string;
    project: string | null;
    cwd?: string;
}
export interface ReflectDeps {
    extract?: Extractor;
    embed?: (text: string) => Promise<Float32Array | null>;
    vcc?: {
        compactWindowLines: typeof compactWindowLines;
        compactFileInPlace: typeof compactFileInPlace;
    };
    redact?: typeof redactSecrets;
}
export interface ReflectResult {
    session_id: string;
    project: string | null;
    newLines: number;
    extracted: number;
    inserted: number;
    merged: number;
    upgraded: number;
    skipped: boolean;
    excluded_reason?: string | null;
    redactions?: number;
    redaction_kinds?: string[];
}
/**
 * Reflect over a session transcript and write any new memories.
 * `deps` lets tests inject a fake extractor / embedder.
 */
export declare function reflect(db: Database.Database, opts: ReflectOptions, deps?: ReflectDeps): Promise<ReflectResult>;
//# sourceMappingURL=reflector.d.ts.map