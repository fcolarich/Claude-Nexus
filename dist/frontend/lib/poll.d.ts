/**
 * Creates a polling interval that auto-cleans on component destroy.
 * Returns a stop function.
 */
export declare function poll(fn: () => void | Promise<void>, intervalMs: number): () => void;
/** Default polling intervals */
export declare const POLL: {
    readonly FAST: 5000;
    readonly NORMAL: 15000;
    readonly SLOW: 60000;
};
//# sourceMappingURL=poll.d.ts.map