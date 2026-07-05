/**
 * Reflector runner — standalone entry point spawned (detached) by the
 * nexus-capture hook. Does not depend on the Nexus web server.
 *
 * Usage: node dist/capture/runner.js <session_id> <transcript_path> [cwd]
 */

import { openDatabase, initializeSchema } from '../core/database.js';
import { resolveProjectSlug } from '../core/project-root.js';
import { reflect } from './reflector.js';
import { exportAll } from './export.js';

async function main(): Promise<void> {
  const [sessionId, transcriptPath, cwd] = process.argv.slice(2);
  if (!sessionId || !transcriptPath) {
    console.error('[nexus-reflect] usage: runner.js <session_id> <transcript_path> [cwd]');
    process.exit(1);
  }

  // Tag this detached automation run's telemetry so it is distinguishable from interactive
  // sessions in OTel/Langfuse. The spawned `claude` CLI (Agent SDK) inherits process.env.
  // Override any inherited value so the nexus identity is clean.
  process.env.OTEL_RESOURCE_ATTRIBUTES = 'service.namespace=nexus,automation=nexus';

  const project = cwd ? resolveProjectSlug(cwd) : null;
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
