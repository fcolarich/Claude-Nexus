/**
 * Start watching Claude directories for changes.
 * Returns a cleanup function to stop watching.
 */
export declare function startWatcher(options?: {
    onChange?: (filePath: string, event: string) => void;
    dbPath?: string;
}): () => void;
//# sourceMappingURL=watcher.d.ts.map