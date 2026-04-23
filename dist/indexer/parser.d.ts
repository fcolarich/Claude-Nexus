import type { SourceType, ParsedFile } from '../core/types.js';
export declare function computeHash(content: string): string;
export declare function computeAtomId(sourcePath: string, sectionIndex: number): string;
/**
 * Parse a single markdown file into atoms.
 */
export declare function parseFile(filePath: string, sourceType: SourceType): ParsedFile;
//# sourceMappingURL=parser.d.ts.map