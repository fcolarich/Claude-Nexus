export type AtomType = 'memory' | 'agent' | 'skill' | 'plan' | 'feedback' | 'reference' | 'project_note' | 'architecture' | 'task';
export type TaskStatus = 'ready' | 'in_progress' | 'blocked' | 'done';
export type AtomScope = 'global' | 'shared' | 'project';
export type SourceType = 'memory_file' | 'agent_def' | 'skill_def' | 'plan_file' | 'nexus_native';
export type LinkType = 'references' | 'extends' | 'refines' | 'contradicts' | 'supports' | 'duplicates' | 'related';
export type SessionStatus = 'active' | 'waiting_input' | 'processing' | 'idle' | 'dead';
export type DiagnosticType = 'broken_reference' | 'missing_frontmatter' | 'duplicate' | 'orphan' | 'stale';

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
  // Task-specific fields (null for non-task atoms)
  status: TaskStatus | null;
  priority: number | null;
  blocks: string | null;      // JSON array of atom IDs
  blocked_by: string | null;  // JSON array of atom IDs
  discovered_from: string | null;
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
