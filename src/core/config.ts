import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import type { ClaudeConfig } from './types.js';

export function getClaudeConfig(): ClaudeConfig {
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
    min_words: number;        // prompts shorter than this skip prompt-driven recall
    min_similarity: number;   // cosine floor (0-1) a memory must clear to be injected
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
    threshold: number;      // cross-encoder score floor a candidate must clear to be injected
    timeout_ms: number;
  };
}

/** Expand a leading ~/ in a path to the user's home directory. */
function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

// Defaults — used when extraction_models.yaml is absent or a key is missing.
// These match the values Nexus v1 hardcoded, so behaviour is unchanged without the file.
const DEFAULTS: NexusConfig = {
  embedding: {
    provider: 'ollama',
    endpoint: 'http://127.0.0.1:11434/api/embed',
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
  reranker: {
    enabled: true,
    endpoint: 'http://127.0.0.1:8931/rerank',
    script_path: 'C:/Fran/Cloned Repos/local-reranker-mcp/server.py',
    threshold: 0.2,
    timeout_ms: 10000,
  },
};

let cached: NexusConfig | null = null;

/**
 * Load extraction_models.yaml from the repo root. Cached after first read.
 * Missing file or missing keys fall back to DEFAULTS — never throws.
 */
export function getNexusConfig(): NexusConfig {
  if (cached) return cached;

  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const path = join(repoRoot, 'extraction_models.yaml');

  let loaded: Partial<NexusConfig> = {};
  if (existsSync(path)) {
    try {
      loaded = (parseYaml(readFileSync(path, 'utf-8')) as Partial<NexusConfig>) ?? {};
    } catch (err) {
      console.warn('[config] Failed to parse extraction_models.yaml — using defaults:', (err as Error).message);
    }
  }

  cached = {
    embedding: { ...DEFAULTS.embedding, ...loaded.embedding },
    extraction: { ...DEFAULTS.extraction, ...loaded.extraction },
    recall: { ...DEFAULTS.recall, ...loaded.recall },
    capture: { ...DEFAULTS.capture, ...loaded.capture },
    reranker: { ...DEFAULTS.reranker, ...loaded.reranker },
  };
  cached.capture.export_dir = expandHome(cached.capture.export_dir);
  return cached;
}
