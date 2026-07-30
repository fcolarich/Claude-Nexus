import type { ClaudeConfig } from './types.js';
export declare function getClaudeConfig(): ClaudeConfig;
export interface NexusConfig {
    embedding: {
        provider: string;
        endpoint: string;
        model: string;
        dimensions: number;
        timeout_ms: number;
    };
    extraction: {
        provider: string;
        endpoint: string;
        model: string;
        timeout_ms: number;
        temperature: number;
    };
    recall: {
        max_tokens: number;
        min_confidence: number;
        max_title_items: number;
        min_words: number;
        min_similarity: number;
    };
    capture: {
        auto_approve_confidence: number;
        dedup_cosine_threshold: number;
        export_dir: string;
        memory_md_max_items: number;
    };
    reranker: {
        enabled: boolean;
        endpoint: string;
        script_path: string;
        threshold: number;
        timeout_ms: number;
    };
}
/**
 * Load extraction_models.yaml from the repo root. Cached after first read.
 * Missing file or missing keys fall back to DEFAULTS — never throws.
 */
export declare function getNexusConfig(): NexusConfig;
//# sourceMappingURL=config.d.ts.map