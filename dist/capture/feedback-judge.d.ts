/**
 * Feedback judge — retrospectively decides whether recalled memories actually
 * helped a session, so recordFeedback's use_count/help_count get real signal
 * instead of relying on a manual nexus_feedback call.
 *
 * Mirrors governance.ts's detectContradictions shape: injectable haikuFn
 * (default callModel), strict-JSON parse, swallow-and-skip on any failure —
 * this runs inside the same best-effort detached capture pipeline as reflect().
 */
export interface JudgeMemory {
    id: string;
    title: string;
    body: string;
}
export interface UsefulnessVerdict {
    id: string;
    helped: boolean;
}
export type HaikuFn = (systemPrompt: string, userPrompt: string) => Promise<string>;
export declare function judgeMemoryUsefulness(transcriptText: string, memories: JudgeMemory[], haikuFn?: HaikuFn): Promise<UsefulnessVerdict[]>;
//# sourceMappingURL=feedback-judge.d.ts.map