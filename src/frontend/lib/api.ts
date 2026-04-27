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
  sessions: (project?: string) => get<SessionInfo[]>(`/api/sessions${project ? `?project=${encodeURIComponent(project)}` : ""}`),
  session: (id: string) => get<SessionInfo>(`/api/sessions/${id}`),
  renameSession: (id: string, title: string) => patch<SessionInfo>(`/api/sessions/${id}`, { title }),
  sessionMessages: (id: string) => get<{ messages: ConversationMessage[] }>(`/api/sessions/${encodeURIComponent(id)}/messages`),
  sessionReferences: (id: string) => get<{ references: SessionReference[] }>(`/api/sessions/${encodeURIComponent(id)}/references`),
  deleteSession: (id: string) => del<{ success: boolean }>(`/api/sessions/${encodeURIComponent(id)}`),
  memories: (project?: string) => get<MemoryAtom[]>(`/api/memories${project ? `?project=${encodeURIComponent(project)}` : ""}`),
  memory: (id: string) => get<MemoryAtom>(`/api/memories/${encodeURIComponent(id)}`),
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
