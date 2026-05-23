/**
 * Reflector runner — standalone entry point spawned (detached) by the
 * nexus-capture hook. Does not depend on the Nexus web server.
 *
 * Usage: node dist/capture/runner.js <session_id> <transcript_path> [cwd]
 */

import { openDatabase, initializeSchema } from '../core/database.js';
import { cwdToProjectSlug } from '../indexer/indexer.js';
import { reflect } from './reflector.js';
import { exportAll } from './export.js';

async function main(): Promise<void> {
  const [sessionId, transcriptPath, cwd] = process.argv.slice(2);
  if (!sessionId || !transcriptPath) {
    console.error('[nexus-reflect] usage: runner.js <session_id> <transcript_path> [cwd]');
    process.exit(1);
  }

  const project = cwd ? cwdToProjectSlug(cwd) : null;
  const db = openDatabase();
  initializeSchema(db);

  try {
    const result = await reflect(db, {
      session_id: sessionId,
      transcript_path: transcriptPath,
      project,
      cwd,
    });

    if (!result.skipped && (result.inserted > 0 || result.merged > 0)) {
      const exp = exportAll(db);
      console.error(`[nexus-reflect] ${JSON.stringify({ ...result, exported: exp.files })}`);
    } else {
      console.error(`[nexus-reflect] ${JSON.stringify(result)}`);
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('[nexus-reflect] error:', err);
  process.exit(1);
});
