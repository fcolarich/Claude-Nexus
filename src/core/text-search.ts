// Pure, dependency-free plain-substring matcher. No fs, no db, no imports
// from other core modules -- see architecture.md's text-search component.

export interface GrepOptions {
  maxMatches?: number; // default 20
  contextLines?: number; // default 1 (one line before + one after)
  maxSnippetChars?: number; // default 400 (per snippet, after context assembly)
}

export interface GrepMatch {
  line: number; // 1-based line number of the matching line
  occurrences: number; // hits on that line (>=1)
  snippet: string; // context lines joined by "\n", window-trimmed
}

export interface GrepResult {
  matches: GrepMatch[];
  totalMatches: number; // total matching LINES found before the cap
  truncated: boolean; // totalMatches > matches.length
}

const DEFAULT_MAX_MATCHES = 20;
const DEFAULT_CONTEXT_LINES = 1;
const DEFAULT_MAX_SNIPPET_CHARS = 400;

/** Case-insensitive count of non-overlapping occurrences of needle in haystack. */
function countOccurrences(haystackLower: string, needleLower: string): number {
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystackLower.indexOf(needleLower, from);
    if (idx === -1) break;
    count++;
    from = idx + needleLower.length;
  }
  return count;
}

/** Trim a snippet to maxChars, centered on the first hit of query within it. */
function trimSnippet(snippet: string, queryLower: string, maxChars: number): string {
  if (snippet.length <= maxChars) return snippet;

  const snippetLower = snippet.toLowerCase();
  const hitIdx = snippetLower.indexOf(queryLower);
  const center = hitIdx === -1 ? 0 : hitIdx + Math.floor(queryLower.length / 2);

  let start = center - Math.floor(maxChars / 2);
  let end = start + maxChars;

  if (start < 0) {
    start = 0;
    end = maxChars;
  }
  if (end > snippet.length) {
    end = snippet.length;
    start = Math.max(0, end - maxChars);
  }

  return snippet.slice(start, end);
}

export function grepText(text: string, query: string, opts?: GrepOptions): GrepResult {
  const maxMatches = opts?.maxMatches ?? DEFAULT_MAX_MATCHES;
  const contextLines = opts?.contextLines ?? DEFAULT_CONTEXT_LINES;
  const maxSnippetChars = opts?.maxSnippetChars ?? DEFAULT_MAX_SNIPPET_CHARS;

  if (!text || !query) {
    return { matches: [], totalMatches: 0, truncated: false };
  }

  const queryLower = query.toLowerCase();
  const lines = text.split('\n');
  const matches: GrepMatch[] = [];
  let totalMatches = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].toLowerCase();
    const occurrences = countOccurrences(lineLower, queryLower);
    if (occurrences === 0) continue;

    totalMatches++;
    if (matches.length >= maxMatches) continue;

    const start = Math.max(0, i - contextLines);
    const end = Math.min(lines.length - 1, i + contextLines);
    const snippet = trimSnippet(lines.slice(start, end + 1).join('\n'), queryLower, maxSnippetChars);

    matches.push({ line: i + 1, occurrences, snippet });
  }

  return { matches, totalMatches, truncated: totalMatches > matches.length };
}
