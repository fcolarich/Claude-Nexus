/**
 * Session-message full-text index — a USER-facing feature.
 *
 * Indexes raw session transcript text so the dashboard can search past
 * sessions ("which session did I work on the auth bug?"). This is never fed to
 * the LLM — the model gets distilled memories via recall, not raw transcripts.
 *
 * Rebuilt wholesale at web-server startup. New sessions become searchable on
 * the next restart — acceptable for browsing session history.
 */
import Database from 'better-sqlite3';
/** Rebuild the session-message FTS index from every known session transcript. */
export declare function reindexSessionMessages(db: Database.Database): number;
export interface SessionMessageHit {
    session_id: string;
    role: string;
    snippet: string;
}
/** Full-text search over session messages. */
export declare function searchSessionMessages(db: Database.Database, query: string, limit?: number): SessionMessageHit[];
//# sourceMappingURL=session-messages.d.ts.map