import type { SearchResult } from "./api";
interface SearchState {
    query: string;
    typeFilter: string;
    results: SearchResult[];
    searched: boolean;
}
export declare const searchStore: import("svelte/store").Writable<SearchState>;
export {};
//# sourceMappingURL=searchStore.d.ts.map