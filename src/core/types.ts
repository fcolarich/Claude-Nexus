export type AtomType = 'memory' | 'agent' | 'skill' | 'plan' | 'feedback' | 'reference' | 'project_note' | 'architecture';
export type AtomScope = 'global' | 'shared' | 'project';
export type SourceType = 'memory_file' | 'agent_def' | 'skill_def' | 'plan_file' | 'nexus_native' | 'project_doc';
export type LinkType = 'references' | 'extends' | 'refines' | 'contradicts' | 'supports' | 'duplicates' | 'related' | 'same_as' | 'supersedes';
export type SessionStatus = 'active' | 'waiting_input' | 'processing' | 'idle' | 'dead';
export type DiagnosticType = 'broken_reference' | 'missing_frontmatter' | 'duplicate' | 'orphan' | 'stale';

// v2 autonomous memory engine
export type MemoryType = 'preference' | 'convention' | 'failure' | 'correction' | 'decision' | 'insight' | 'tool_quirk' | 'reference' | 'handoff';
export type PromotionTarget = 'none' | 'adr' | 'ddr' | 'best_practice' | 'recipe' | 'note';
export type DecayClass = 'stable' | 'architecture' | 'api_contract' | 'implementation';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface Atom {
  id: string;
  title: string;
  body: string;
  atom_type: AtomType;
  scope: AtomScope;
  source_path: string;
  source_type: SourceType;
  project: string | null;
  tags: string[];
  content_hash: string;
  frontmatter: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  linked_at: string | null;
  load_at_init: number;  // 0 | 1, matches SQLite INTEGER
}

export interface AtomLink {
  id: number;
  source_id: string;
  target_id: string;
  link_type: LinkType;
  confidence: number;
  created_at: string;
}

/**
 * A distilled, typed memory — the unit of the v2 autonomous memory engine.
 * DB-owned (written by the Reflector), distinct from file-mirrored Atoms.
 */
export interface Memory {
  id: string;
  title: string;
  body: string;
  memory_type: MemoryType;
  scope: AtomScope;
  project: string | null;
  confidence: number;
  decay_class: DecayClass;
  last_verified_at: string;
  use_count: number;
  help_count: number;
  source_session_id: string | null;
  discovered_from: string | null;
  superseded_by: string | null;
  review_status: ReviewStatus;
  promotion_target: PromotionTarget;
  promoted_to: string | null;
  tags: string[];
  content_hash: string;
  created_at: string;
  updated_at: string;
  linked_at: string | null;
  load_at_init: number;  // 0 | 1
  distilled_at: string | null;  // last distill run that examined this memory; NULL = never
  identifiers: string[];  // code-like tokens, extracted deterministically (src/core/identifiers.ts)
}

/**
 * An atomic claim beneath a memory (Phase 2, design-structured-memory.md).
 * Immutable once written: consolidation may only ADD, LINK, or MARK INVALID
 * (`valid_until`/`expired_at`) — `fact` is never rewritten.
 */
export interface Claim {
  id: string;                    // sha256(claim_type + fact), 16-char, content-addressed
  memory_id: string;              // parent memory row
  source_memory_id: string;       // memory this claim was extracted from (== memory_id unless re-parented)
  fact: string;                   // immutable once written
  claim_type: MemoryType;         // derived from parent memory_type
  identifiers: string[];          // code-like tokens, extracted deterministically, never model-generated
  confidence: number;             // inherited from parent; adjusted by feedback
  valid_from: string;             // world time — when the fact became true
  valid_until: string | null;     // world time — NULL = still valid
  recorded_at: string;            // transaction time — when the system learned it
  expired_at: string | null;      // transaction time — set on supersession
  created_at: string;
}

export interface Session {
  session_id: string;
  project: string;
  git_branch: string | null;
  slug: string | null;
  jsonl_path: string;
  started_at: string | null;
  last_active: string | null;
  status: SessionStatus;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  subagent_count: number;
  summary: string | null;
  message_count: number;
  title: string | null;
  custom_title: string | null;
  is_cowork: boolean | null;
  workspace_id: string | null;
  participant_id: string | null;
  last_reflected_index: number;  // Reflector transcript cursor
  cwd: string | null;
}

export interface CrossRefResult {
  id: string;
  title: string;
  atom_type: string;
  link_type: LinkType | null;
  score: number;
  body_snippet: string;
}

export interface Diagnostic {
  id: number;
  type: DiagnosticType;
  atom_id: string | null;
  source_path: string | null;
  message: string;
  details: string | null;
  created_at: string;
}

export interface SearchResult {
  atom: Atom;
  rank: number;
  snippet: string;
}

export interface ParsedFile {
  atoms: Omit<Atom, 'id' | 'created_at' | 'updated_at'>[];
  links: { source_section: number; target_path: string; link_type: LinkType }[];
  diagnostics: { type: DiagnosticType; message: string; details?: string }[];
}

export interface ClaudeConfig {
  claudeDir: string;
  projectsDir: string;
  agentsDir: string;
  skillsDir: string;
  plansDir: string;
  todosDir: string;
  hooksDir: string;
}
