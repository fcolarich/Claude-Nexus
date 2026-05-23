const BASE = "http://localhost:3210";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function put<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface SessionInfo {
  id: string;
  title: string;
  project: string;
  slug?: string;
  lastActivity: string;
  messageCount: number;
  status: "active" | "idle" | "waiting";
  lastMessage?: string;
  pendingPrompt?: string;
  summary?: string;
}

export type MessageBlock =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; toolId: string; toolName: string; toolInput: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; resultContent: string; isError?: boolean };

export interface ConversationMessage {
  uuid: string;
  role: "user" | "assistant";
  blocks: MessageBlock[];
  timestamp: string;
}

export interface SessionReference {
  id: string;
  title: string;
  path: string;
}

export interface AtomLink {
  id: number;
  title: string;
  type: string;
}

export interface MemoryAtom {
  id: string;
  path: string;
  project: string;
  title: string;
  type: string;
  body: string;
  links: AtomLink[];
  updatedAt: string;
}

export type MemoryType =
  | "preference"
  | "convention"
  | "failure"
  | "correction"
  | "decision"
  | "insight"
  | "tool_quirk"
  | "reference"
  | "handoff";

export type MemoryScope = "global" | "shared" | "project";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type DecayClass = "stable" | "architecture" | "api_contract" | "implementation";

export interface Memory {
  id: string;
  title: string;
  body: string;
  memory_type: MemoryType;
  scope: MemoryScope;
  project: string;
  confidence: number;
  effective_confidence: number;
  decay_class: DecayClass;
  last_verified_at: string;
  use_count: number;
  help_count: number;
  review_status: ReviewStatus;
  tags: string[];
  source_session_id: string;
  created_at: string;
  updated_at: string;
  load_at_init: boolean;
}

export interface MemoryListResponse {
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

export interface MemoryQuery {
  review_status?: ReviewStatus;
  memory_type?: MemoryType;
  project?: string;
  scope?: MemoryScope;
  limit?: number;
  offset?: number;
}

export interface TranscriptSearchResult {
  session_id: string;
  role: string;
  snippet: string;
}

export interface SessionListResponse {
  sessions: SessionInfo[];
  total: number;
  limit: number;
  offset: number;
}

export interface SearchResult {
  id: string;
  path: string;
  project: string;
  title: string;
  type: string;
  snippet: string;
  score: number;
}

export interface ProjectStats {
  project: string;
  sessions: number;
  memories: number;
  lastActive: string;
}

export interface DashboardData {
  projects: ProjectStats[];
  recentSessions: SessionInfo[];
  totalMemories: number;
  totalSessions: number;
}

export interface CreateMemoryParams {
  name: string;
  type: string;
  description: string;
  body: string;
  sourceSessionId?: string;
  sourceSessionSlug?: string;
}

export type TaskStatus = 'ready' | 'in_progress' | 'blocked' | 'done';

export interface TaskItem {
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

export interface CreateTaskParams {
  title: string;
  body: string;
  project?: string;
  priority?: number;
  tags?: string[];
  blocked_by?: string[];
  blocks?: string[];
}

export const api = {
  dashboard: () => get<DashboardData>("/api/dashboard"),
  sessions: async (project?: string): Promise<SessionInfo[]> => {
    const res = await get<SessionListResponse>(
      `/api/sessions${project ? `?project=${encodeURIComponent(project)}` : ""}`,
    );
    return res.sessions;
  },
  session: (id: string) => get<SessionInfo>(`/api/sessions/${id}`),
  renameSession: (id: string, title: string) => patch<SessionInfo>(`/api/sessions/${id}`, { title }),
  sessionMessages: (id: string) => get<{ messages: ConversationMessage[] }>(`/api/sessions/${encodeURIComponent(id)}/messages`),
  sessionReferences: (id: string) => get<{ references: SessionReference[] }>(`/api/sessions/${encodeURIComponent(id)}/references`),
  deleteSession: (id: string) => del<{ success: boolean }>(`/api/sessions/${encodeURIComponent(id)}`),
  searchTranscripts: (q: string) =>
    get<{ results: TranscriptSearchResult[] }>(`/api/sessions/search?q=${encodeURIComponent(q)}`),
  memories: (params?: MemoryQuery) => {
    const q = new URLSearchParams();
    if (params?.review_status) q.set("review_status", params.review_status);
    if (params?.memory_type) q.set("memory_type", params.memory_type);
    if (params?.project) q.set("project", params.project);
    if (params?.scope) q.set("scope", params.scope);
    if (params?.limit != null) q.set("limit", String(params.limit));
    if (params?.offset != null) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<MemoryListResponse>(`/api/memories${qs ? `?${qs}` : ""}`);
  },
  memory: (id: string) => get<Memory>(`/api/memories/${encodeURIComponent(id)}`),
  updateMemory: (id: string, body: { title?: string; body?: string; tags?: string[] }) =>
    put<Memory>(`/api/memories/${encodeURIComponent(id)}`, body),
  reviewMemory: (id: string, status: ReviewStatus) =>
    post<{ ok: boolean; status: string }>(`/api/memories/${encodeURIComponent(id)}/review`, { status }),
  verifyMemory: (id: string) =>
    post<{ ok: boolean }>(`/api/memories/${encodeURIComponent(id)}/verify`, {}),
  memoryFeedback: (id: string, helped: boolean) =>
    post<{ ok: boolean }>(`/api/memories/${encodeURIComponent(id)}/feedback`, { helped }),
  deleteMemory: (id: string) => del<{ ok: boolean }>(`/api/memories/${encodeURIComponent(id)}`),
  consolidate: () =>
    post<{ embedded: number; merged: number; pruned: number }>("/api/consolidate", {}),
  distill: () =>
    post<{ embedded: number; clusters: number; merged: number; created: number; sanitized: number }>("/api/distill", {}),
  search: (q: string, type?: string) => get<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ""}`),
  projects: () => get<string[]>("/api/projects"),
  plans: () => get<MemoryAtom[]>("/api/plans"),
  agents: () => get<MemoryAtom[]>("/api/agents"),
  skills: () => get<MemoryAtom[]>("/api/skills"),
  atomRaw: (id: string) => get<{ rawContent: string }>(`/api/atoms/${encodeURIComponent(id)}/raw`),
  updateAtom: (id: string, body: string) => put<MemoryAtom>(`/api/atoms/${encodeURIComponent(id)}`, { body }),
  deleteAtom: (id: string) => del<{ success: boolean }>(`/api/atoms/${encodeURIComponent(id)}`),
  deleteProject: (name: string) => del<{ success: boolean }>(`/api/projects/${encodeURIComponent(name)}`),
  createMemory: (data: CreateMemoryParams) => post<{ success: boolean; path: string }>("/api/atoms/create-memory", data as unknown as Record<string, unknown>),
  tasks: (params?: { project?: string; status?: string; priority?: number; include_done?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.project) q.set('project', params.project);
    if (params?.status) q.set('status', params.status);
    if (params?.priority != null) q.set('priority', String(params.priority));
    if (params?.include_done) q.set('include_done', 'true');
    const qs = q.toString();
    return get<TaskItem[]>(`/api/tasks${qs ? `?${qs}` : ''}`);
  },
  updateTask: (id: string, status: TaskStatus) =>
    patch<TaskItem>(`/api/tasks/${encodeURIComponent(id)}`, { status }),
  createTask: (data: CreateTaskParams) =>
    post<TaskItem>('/api/tasks', data as unknown as Record<string, unknown>),
};
