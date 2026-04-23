import Database from 'better-sqlite3';
/**
 * Generate a short title from the first user message.
 * Mimics Claude Code's behavior: extract the core request in ~60 chars.
 */
export declare function generateTitle(firstMessage: string): string;
/**
 * Import session titles from Claude Code's own session-metadata.db.
 * Reads `first_user_message` and generates short titles.
 */
export declare function importSessionTitles(nexusDb: Database.Database): number;
/**
 * Also backfill titles from our own summary field for sessions
 * that aren't in Claude's metadata DB.
 */
export declare function backfillTitlesFromSummary(db: Database.Database): number;
//# sourceMappingURL=session-titles.d.ts.map