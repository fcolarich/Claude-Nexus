export interface GrepOptions {
    maxMatches?: number;
    contextLines?: number;
    maxSnippetChars?: number;
}
export interface GrepMatch {
    line: number;
    occurrences: number;
    snippet: string;
}
export interface GrepResult {
    matches: GrepMatch[];
    totalMatches: number;
    truncated: boolean;
}
export declare function grepText(text: string, query: string, opts?: GrepOptions): GrepResult;
//# sourceMappingURL=text-search.d.ts.map