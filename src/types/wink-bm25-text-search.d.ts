declare module 'wink-bm25-text-search' {
  interface BM25Index {
    defineConfig(cfg: { fldWeights: Record<string, number> }): void;
    definePrepTasks(fns: Function[]): void;
    addDoc(doc: object, uid: string): void;
    consolidate(): void;
    search(query: string, limit: number): [string, number][];
    reset(): void;
  }
  function BM25(): BM25Index;
  export = BM25;
}
