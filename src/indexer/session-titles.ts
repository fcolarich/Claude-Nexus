import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CLAUDE_METADATA_DB = join(homedir(), '.claude', 'cache', 'session-metadata.db');

/**
 * Generate a short title from the first user message.
 * Mimics Claude Code's behavior: extract the core request in ~60 chars.
 */
export function generateTitle(firstMessage: string): string {
  if (!firstMessage) return 'Untitled session';

  let text = firstMessage.trim();

  // Remove common prefixes
  text = text.replace(/^(hey|hi|hello|please|can you|could you|i want to|i need to|help me)\s+/i, '');

  // Capitalize first letter
  text = text.charAt(0).toUpperCase() + text.slice(1);

  // Truncate at sentence boundary if possible
  const sentenceEnd = text.search(/[.!?\n]/);
  if (sentenceEnd > 0 && sentenceEnd <= 80) {
    text = text.slice(0, sentenceEnd);
  }

  // Truncate at word boundary around 60 chars
  if (text.length > 65) {
    const cutoff = text.lastIndexOf(' ', 60);
    text = text.slice(0, cutoff > 20 ? cutoff : 60) + '...';
  }

  return text;
}

/**
 * Import session titles from Claude Code's own session-metadata.db.
 * Reads `first_user_message` and generates short titles.
 */
export function importSessionTitles(nexusDb: Database.Database): number {
  if (!existsSync(CLAUDE_METADATA_DB)) {
    return 0;
  }

  let claudeDb: Database.Database;
  try {
    claudeDb = new Database(CLAUDE_METADATA_DB, { readonly: true });
  } catch {
    return 0;
  }

  let updated = 0;
  try {
    // Get all sessions from Claude's metadata that have a first_user_message
    const claudeSessions = claudeDb.prepare(`
      SELECT session_id, first_user_message, total_tokens, models_used
      FROM session_metadata
      WHERE first_user_message IS NOT NULL AND first_user_message != ''
    `).all() as {
      session_id: string;
      first_user_message: string;
      total_tokens: number;
      models_used: string;
    }[];

    // Update our sessions that don't have a title yet
    const updateTitle = nexusDb.prepare(`
      UPDATE sessions SET title = ?, input_tokens = COALESCE(NULLIF(input_tokens, 0), ?)
      WHERE session_id = ? AND (title IS NULL OR title = '')
    `);

    const updateAll = nexusDb.transaction(() => {
      for (const s of claudeSessions) {
        const title = generateTitle(s.first_user_message);
        const result = updateTitle.run(title, s.total_tokens, s.session_id);
        if (result.changes > 0) updated++;
      }
    });
    updateAll();
  } finally {
    claudeDb.close();
  }

  return updated;
}

/**
 * Also backfill titles from our own summary field for sessions
 * that aren't in Claude's metadata DB.
 */
export function backfillTitlesFromSummary(db: Database.Database): number {
  const sessions = db.prepare(`
    SELECT session_id, summary FROM sessions
    WHERE (title IS NULL OR title = '') AND summary IS NOT NULL AND summary != ''
  `).all() as { session_id: string; summary: string }[];

  const update = db.prepare(`UPDATE sessions SET title = ? WHERE session_id = ?`);
  let count = 0;

  const updateAll = db.transaction(() => {
    for (const s of sessions) {
      update.run(generateTitle(s.summary), s.session_id);
      count++;
    }
  });
  updateAll();

  return count;
}
