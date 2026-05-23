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
/** Decay multiplier in (0,1]. 1 within the grace period, halving each half-life after. */
export declare function decayFactor(decayClass: DecayClass, lastVerifiedAt: string): number;
/** Confidence adjusted for age — what recall ranks and filters on. */
export declare function effectiveConfidence(m: Pick<Memory, 'confidence' | 'decay_class' | 'last_verified_at'>): number;
/**
 * Flag approved memories whose effective confidence has decayed below the
 * recall threshold. Rewrites the 'stale' diagnostics each run so the set
 * always reflects current state. Returns the count flagged.
 */
export declare function flagStaleMemories(db: Database.Database, threshold: number): number;
//# sourceMappingURL=decay.d.ts.map