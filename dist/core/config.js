import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
// Shared across every local project/session that talks to this machine's one
// llama-swap instance (uber-db reads the same var). Set once as a user env
// var instead of duplicating the port in each repo's defaults. Port 8091, not
// 8080: 8080 collides with wslrelay.exe on this machine (WSL2 port forwarding
// into a stray local-ai.service), which falsely answers 200 to liveness pings
// and masks llama-swap never actually starting.
const LLAMA_SWAP_BASE_URL = process.env['LLAMA_SWAP_BASE_URL'] ?? 'http://127.0.0.1:8091';
export function getClaudeConfig() {
    const claudeDir = join(homedir(), '.claude');
    return {
        claudeDir,
        projectsDir: join(claudeDir, 'projects'),
        agentsDir: join(claudeDir, 'agents'),
        skillsDir: join(claudeDir, 'skills'),
        plansDir: join(claudeDir, 'plans'),
        todosDir: join(claudeDir, 'todos'),
        hooksDir: join(claudeDir, 'hooks'),
    };
}
/** Expand a leading ~/ in a path to the user's home directory. */
function expandHome(p) {
    if (p === '~')
        return homedir();
    if (p.startsWith('~/') || p.startsWith('~\\'))
        return join(homedir(), p.slice(2));
    return p;
}
// Defaults — used when extraction_models.yaml is absent or a key is missing.
// These match the values Nexus v1 hardcoded, so behaviour is unchanged without the file.
const DEFAULTS = {
    embedding: {
        provider: 'llama-swap',
        endpoint: `${LLAMA_SWAP_BASE_URL}/v1/embeddings`,
        model: 'mxbai-embed-large',
        dimensions: 1024,
        timeout_ms: 15000,
    },
    extraction: {
        provider: 'claude-agent-sdk',
        endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
        model: 'claude-haiku-4-5-20251001',
        timeout_ms: 120000,
        temperature: 0.2,
    },
    recall: {
        max_tokens: 2000,
        min_confidence: 0.35,
        max_title_items: 25,
        min_words: 4,
        min_similarity: 0.55,
    },
    capture: {
        auto_approve_confidence: 0.85,
        dedup_cosine_threshold: 0.86,
        export_dir: join(homedir(), '.claude', 'memories', 'exports'),
        memory_md_max_items: 200,
    },
    exclude: {
        commands: [
            'harvest-knowledge',
            'extract-knowledge',
            'add-book-to-encyclopedia',
            'book-encyclopedia-batch',
        ],
        scheduled_tasks: [
            'nexus-memory-distill',
        ],
    },
    reranker: {
        enabled: true,
        endpoint: `${LLAMA_SWAP_BASE_URL}/upstream/jina-reranker-v2-base-multilingual/rerank`,
        model: 'jina-reranker-v2-base-multilingual',
        script_path: 'C:/Fran/Cloned Repos/local-reranker-mcp/server.py',
        threshold: 0.2,
        timeout_ms: 10000,
    },
    llamaSwap: {
        executablePath: 'C:/Fran/tools/llama-swap/llama-swap.exe',
        configPath: 'C:/Fran/tools/llama-swap/config.yaml',
    },
};
let cached = null;
/**
 * Load extraction_models.yaml from the repo root. Cached after first read.
 * Missing file or missing keys fall back to DEFAULTS — never throws.
 */
export function getNexusConfig() {
    if (cached)
        return cached;
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const path = join(repoRoot, 'extraction_models.yaml');
    let loaded = {};
    if (existsSync(path)) {
        try {
            loaded = parseYaml(readFileSync(path, 'utf-8')) ?? {};
        }
        catch (err) {
            console.warn('[config] Failed to parse extraction_models.yaml — using defaults:', err.message);
        }
    }
    cached = {
        embedding: { ...DEFAULTS.embedding, ...loaded.embedding },
        extraction: { ...DEFAULTS.extraction, ...loaded.extraction },
        recall: { ...DEFAULTS.recall, ...loaded.recall },
        capture: { ...DEFAULTS.capture, ...loaded.capture },
        exclude: { ...DEFAULTS.exclude, ...loaded.exclude },
        reranker: { ...DEFAULTS.reranker, ...loaded.reranker },
        llamaSwap: { ...DEFAULTS.llamaSwap, ...loaded.llamaSwap },
    };
    cached.capture.export_dir = expandHome(cached.capture.export_dir);
    return cached;
}
//# sourceMappingURL=config.js.map