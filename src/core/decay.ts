/**
 * Confidence decay — memories lose trustworthiness as they age.
 *
 * Non-destructive: the stored `confidence` is the Reflector's intrinsic
 * assessment and is only changed by reconfirmation / verify / feedback. Decay
 * is a multiplier computed from `last_verified_at`, so reconfirming a memory
 * (which resets that clock) instantly restores its effective confidence.
 *
 * Decay schedule per decay_class (grace period / half-life), from the
 * pipeline memory-decay model:
 *   architecture   30d grace / 60d half-life
 *   api_contract   14d / 30d
 *   implementation  7d / 14d
 *   stable         never decays (preferences, conventions)
 */

import Database from 'better-sqlite3';
import type { Memory, DecayClass } from './types.js';

interface DecayProfile { graceDays: number; halfLifeDays: number; }

const DECAY: Record<DecayClass, DecayProfile | null> = {
  stable: null,
  architecture: { graceDays: 30, halfLifeDays: 60 },
  api_contract: { graceDays: 14, halfLifeDays: 30 },
  implementation: { graceDays: 7, halfLifeDays: 14 },
};

/** Days between a SQLite datetime string (UTC) and now. */
function ageDays(lastVerifiedAt: string): number {
  const t = Date.parse(lastVerifiedAt.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (Date.now() - t) / 86_400_000);
}

/** Decay multiplier in (0,1]. 1 within the grace period, halving each half-life after. */
export function decayFactor(decayClass: DecayClass, lastVerifiedAt: string): number {
  const p = DECAY[decayClass];
  if (!p) return 1;
  const age = ageDays(lastVerifiedAt);
  if (age <= p.graceDays) return 1;
  return Math.pow(0.5, (age - p.graceDays) / p.halfLifeDays);
}

/** Confidence adjusted for age — what recall ranks and filters on. */
export function effectiveConfidence(
  m: Pick<Memory, 'confidence' | 'decay_class' | 'last_verified_at'>
): number {
  return m.confidence * decayFactor(m.decay_class, m.last_verified_at);
}

/**
 * Flag approved memories whose effective confidence has decayed below the
 * recall threshold. Rewrites the 'stale' diagnostics each run so the set
 * always reflects current state. Returns the count flagged.
 */
export function flagStaleMemories(db: Database.Database, threshold: number): number {
  const memoriesExists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='memories'`
  ).get();
  if (!memoriesExists) return 0;

  const rows = db.prepare(`
    SELECT id, title, confidence, decay_class, last_verified_at
    FROM memories WHERE review_status = 'approved' AND superseded_by IS NULL
  `).all() as Pick<Memory, 'id' | 'title' | 'confidence' | 'decay_class' | 'last_verified_at'>[];

  const stale = rows.filter(m => effectiveConfidence(m) < threshold);

  db.prepare(`DELETE FROM diagnostics WHERE type = 'stale'`).run();
  const ins = db.prepare(
    `INSERT INTO diagnostics (type, atom_id, message, details) VALUES ('stale', NULL, ?, ?)`
  );
  for (const m of stale) {
    ins.run(
      `Memory decayed below recall threshold: ${m.title}`,
      JSON.stringify({ memory_id: m.id, effective_confidence: Number(effectiveConfidence(m).toFixed(3)) })
    );
  }
  return stale.length;
}
