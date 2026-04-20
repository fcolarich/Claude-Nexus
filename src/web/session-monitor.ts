import { readFileSync, statSync, existsSync, openSync, readSync, closeSync } from 'fs';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import type { SessionStatus } from '../core/types.js';

interface LiveSessionState {
  sessionId: string;
  status: SessionStatus;
  pendingPrompt: string | null;
  lastActivity: string | null;
}

/**
 * Get PIDs of running Claude Code processes.
 * Returns a set of session IDs extracted from process arguments.
 */
function getRunningClaudePids(): Set<string> {
  const sessionIds = new Set<string>();
  try {
    // On Windows, look for node processes running Claude Code
    const output = execSync(
      'wmic process where "name=\'node.exe\'" get CommandLine /format:list',
      { encoding: 'utf-8', timeout: 5000 }
    );
    // Extract session IDs from command lines that reference .claude/projects
    const lines = output.split('\n');
    for (const line of lines) {
      // Look for session UUID patterns in command arguments
      const uuidMatch = line.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (uuidMatch && line.includes('.claude')) {
        sessionIds.add(uuidMatch[1]);
      }
    }
  } catch {
    // Fallback: try tasklist
    try {
      const output = execSync('tasklist /fi "imagename eq claude.exe" /fo csv /nh', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      if (output.includes('claude')) {
        // Claude CLI is running but we can't determine which session
        // Mark sessions with very recent activity as potentially active
      }
    } catch {}
  }
  return sessionIds;
}

/**
 * Read the tail of a JSONL file to determine session state.
 * Looks at the last few entries to determine if it's waiting for input.
 */
function parseSessionTail(jsonlPath: string): {
  status: SessionStatus;
  pendingPrompt: string | null;
  lastTimestamp: string | null;
} {
  if (!existsSync(jsonlPath)) {
    return { status: 'dead', pendingPrompt: null, lastTimestamp: null };
  }

  try {
    const stat = statSync(jsonlPath);
    // Read last ~8KB of file for tail analysis
    const size = stat.size;
    const readSize = Math.min(size, 8192);
    const fd = openSync(jsonlPath, 'r');
    const buf = Buffer.alloc(readSize);
    readSync(fd, buf, 0, readSize, Math.max(0, size - readSize));
    closeSync(fd);

    const tail = buf.toString('utf-8');
    const lines = tail.split('\n').filter(l => l.trim()).reverse();

    let lastTimestamp: string | null = null;
    let lastEntryType: string | null = null;
    let hasQueueEnqueue = false;
    let pendingPrompt: string | null = null;

    for (let i = 0; i < Math.min(lines.length, 15); i++) {
      try {
        const entry = JSON.parse(lines[i]);

        if (!lastTimestamp && entry.timestamp) {
          lastTimestamp = entry.timestamp;
        }

        if (i === 0) {
          lastEntryType = entry.type;
        }

        // Queue operations indicate waiting for input
        if (entry.type === 'queue-operation' && entry.operation === 'enqueue') {
          hasQueueEnqueue = true;
          if (entry.content) {
            pendingPrompt = typeof entry.content === 'string'
              ? entry.content.slice(0, 200)
              : JSON.stringify(entry.content).slice(0, 200);
          }
        }

        // If last entry is assistant and no recent user follow-up, might be waiting
        if (i === 0 && entry.type === 'assistant') {
          // Check if there's tool use in progress
          const content = entry.message?.content;
          if (Array.isArray(content)) {
            const hasToolUse = content.some((c: any) => c.type === 'tool_use');
            if (hasToolUse) {
              return { status: 'processing', pendingPrompt: null, lastTimestamp };
            }
          }
        }
      } catch {}
    }

    // Determine status based on recency
    if (lastTimestamp) {
      const age = Date.now() - new Date(lastTimestamp).getTime();
      const FIVE_MINUTES = 5 * 60 * 1000;
      const ONE_HOUR = 60 * 60 * 1000;

      if (age < FIVE_MINUTES) {
        if (hasQueueEnqueue) return { status: 'waiting_input', pendingPrompt, lastTimestamp };
        if (lastEntryType === 'assistant') return { status: 'waiting_input', pendingPrompt: null, lastTimestamp };
        return { status: 'active', pendingPrompt: null, lastTimestamp };
      }

      if (age < ONE_HOUR) {
        return { status: 'idle', pendingPrompt: null, lastTimestamp };
      }
    }

    return { status: 'dead', pendingPrompt: null, lastTimestamp };
  } catch {
    return { status: 'dead', pendingPrompt: null, lastTimestamp: null };
  }
}

/**
 * Update all session statuses in the database based on live state.
 */
export function refreshSessionStatuses(db: Database.Database): void {
  const sessions = db.prepare(
    `SELECT session_id, jsonl_path FROM sessions`
  ).all() as { session_id: string; jsonl_path: string }[];

  const update = db.prepare(`
    UPDATE sessions SET status = ?, summary = COALESCE(?, summary), last_active = COALESCE(?, last_active)
    WHERE session_id = ?
  `);

  const runAll = db.transaction(() => {
    for (const session of sessions) {
      const state = parseSessionTail(session.jsonl_path);
      update.run(
        state.status,
        state.pendingPrompt,
        state.lastTimestamp,
        session.session_id
      );
    }
  });

  runAll();
}
