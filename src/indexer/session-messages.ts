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
import { readFileSync } from 'fs';
import { sanitizeFts5Query } from '../core/search.js';

const NOISE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as { type?: string; text?: string }[])
      .filter(b => b?.type === 'text')
      .map(b => b.text ?? '')
      .join(' ');
  }
  return '';
}

function ftsExists(db: Database.Database): boolean {
  return !!db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='session_messages_fts'`
  ).get();
}

/** Rebuild the session-message FTS index from every known session transcript. */
export function reindexSessionMessages(db: Database.Database): number {
  if (!ftsExists(db)) return 0;

  db.exec(`DELETE FROM session_messages_fts`);
  const ins = db.prepare(`INSERT INTO session_messages_fts(session_id, role, text) VALUES (?, ?, ?)`);
  const sessions = db.prepare(`SELECT session_id, jsonl_path FROM sessions`).all() as
    { session_id: string; jsonl_path: string }[];

  let count = 0;
  const tx = db.transaction(() => {
    for (const s of sessions) {
      let content: string;
      try { content = readFileSync(s.jsonl_path, 'utf-8'); } catch { continue; }
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        let entry: { type?: string; message?: { role?: string; content?: unknown } };
        try { entry = JSON.parse(line); } catch { continue; }
        const role = entry.message?.role ?? entry.type;
        if (role !== 'user' && role !== 'assistant') continue;
        const text = extractText(entry.message?.content).replace(NOISE, '').trim();
        if (text.length < 4) continue;
        ins.run(s.session_id, role, text);
        count++;
      }
    }
  });
  tx();
  return count;
}

export interface SessionMessageHit {
  session_id: string;
  role: string;
  snippet: string;
}

/** Full-text search over session messages. */
export function searchSessionMessages(db: Database.Database, query: string, limit = 30): SessionMessageHit[] {
  if (!ftsExists(db) || !query.trim()) return [];
  try {
    return db.prepare(`
      SELECT session_id, role,
             snippet(session_messages_fts, 2, '<mark>', '</mark>', '…', 16) AS snippet
      FROM session_messages_fts
      WHERE session_messages_fts MATCH ?
      LIMIT ?
    `).all(sanitizeFts5Query(query), limit) as SessionMessageHit[];
  } catch {
    return [];
  }
}
