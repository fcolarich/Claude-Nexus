/**
 * Governance — automated confidence adjustment based on observed help-rate stats.
 *
 * governByHelpRate is pure SQL, phase 4 of consolidateMemories(). Contradiction
 * detection (phase 5) is gated behind DDR-005.
 */
import Database from 'better-sqlite3';
export declare const MIN_EVALUATIONS = 5;
export declare const LOW_THRESHOLD = 0.3;
export declare const HIGH_THRESHOLD = 0.8;
export declare const CONFIDENCE_FLOOR = 0.1;
export declare const DEMOTE_FACTOR = 0.85;
export declare const REINFORCE_BUMP = 0.05;
export declare const DIVERGENCE_CONF = 0.3;
export declare const MAX_PAIRS_PER_RUN = 20;
export interface GovernResult {
    demoted: number;
    reinforced: number;
}
export interface ContradictionResult {
    contradictionsFlagged: number;
    contradictionPairsChecked: number;
}
export type HaikuFn = (systemPrompt: string, userPrompt: string) => Promise<string>;
export declare function governByHelpRate(db: Database.Database): GovernResult;
export declare function detectContradictions(db: Database.Database, haikuFn?: HaikuFn): Promise<ContradictionResult>;
//# sourceMappingURL=governance.d.ts.map