export type AtomType = 'memory' | 'agent' | 'skill' | 'plan' | 'feedback' | 'reference' | 'project_note' | 'architecture' | 'task';
export type TaskStatus = 'ready' | 'in_progress' | 'blocked' | 'done';
export type AtomScope = 'global' | 'shared' | 'project';
export type SourceType = 'memory_file' | 'agent_def' | 'skill_def' | 'plan_file' | 'nexus_native' | 'project_doc';
export type LinkType = 'references' | 'extends' | 'refines' | 'contradicts' | 'supports' | 'duplicates' | 'related';
export type SessionStatus = 'active' | 'waiting_input' | 'processing' | 'idle' | 'dead';
export type DiagnosticType = 'broken_reference' | 'missing_frontmatter' | 'duplicate' | 'orphan' | 'stale';

// v2 autonomous memory engine
export type MemoryType = 'preference' | 'convention' | 'failure' | 'correction' | 'decision' | 'insight' | 'tool_quirk' | 'reference' | 'handoff';
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
  // Task-specific fields (null for non-task atoms)
  status: TaskStatus | null;
  priority: number | null;
  blocks: string | null;      // JSON array of atom IDs
  blocked_by: string | null;  // JSON array of atom IDs
  discovered_from: string | null;
  load_at_init: number;  // 0 | 1, matches SQLite INTEGER
}

export interface TaskAtom {
  id: string;
  title: string;
  status: TaskStatus;
  effective_status: TaskStatus;
  priority: number;
  project: string;
  tags: string[];
  blocks: string[];
  blocked_by: string[];
  discovered_from: string;
  created_at: string;
  summary: string;
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
  tags: string[];
  content_hash: string;
  created_at: string;
  updated_at: string;
  linked_at: string | null;
  load_at_init: number;  // 0 | 1
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
