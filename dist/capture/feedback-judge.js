/**
 * Feedback judge — retrospectively decides whether recalled memories actually
 * helped a session, so recordFeedback's use_count/help_count get real signal
 * instead of relying on a manual nexus_feedback call.
 *
 * Mirrors governance.ts's detectContradictions shape: injectable haikuFn
 * (default callModel), strict-JSON parse, swallow-and-skip on any failure —
 * this runs inside the same best-effort detached capture pipeline as reflect().
 */
import { callModel } from '../core/llm.js';
export async function judgeMemoryUsefulness(transcriptText, memories, haikuFn = callModel) {
    if (memories.length === 0)
        return [];
    const systemPrompt = 'You are judging whether specific recalled memories actually helped during a coding session. ' +
        'For each memory listed, decide if the session transcript shows it was used, referenced, or ' +
        'made a difference to what Claude did. Respond with strict JSON only: an array of ' +
        '{"id": string, "helped": boolean}, one entry per memory id given, no other text.';
    const memoryList = memories
        .map((m) => `id: ${m.id}\ntitle: ${m.title}\nbody: ${m.body}`)
        .join('\n---\n');
    const userPrompt = [
        'Session transcript:',
        transcriptText,
        '',
        'Memories to judge:',
        memoryList,
    ].join('\n');
    let response;
    try {
        response = await haikuFn(systemPrompt, userPrompt);
    }
    catch {
        return [];
    }
    let parsed;
    try {
        parsed = JSON.parse(response);
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed))
        return [];
    const validIds = new Set(memories.map((m) => m.id));
    const verdicts = [];
    for (const entry of parsed) {
        if (typeof entry !== 'object' || entry === null ||
            typeof entry.id !== 'string' ||
            typeof entry.helped !== 'boolean')
            continue;
        const { id, helped } = entry;
        if (!validIds.has(id))
            continue;
        verdicts.push({ id, helped });
    }
    return verdicts;
}
//# sourceMappingURL=feedback-judge.js.map