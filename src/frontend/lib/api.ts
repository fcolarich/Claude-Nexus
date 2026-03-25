const BASE = "http://localhost:3210";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface SessionInfo {
  id: string;
  project: string;
  lastActivity: string;
  messageCount: number;
  status: "active" | "idle" | "waiting";
  lastMessage?: string;
  pendingPrompt?: string;
}

export interface AtomLink {
  id: number;
  title: string;
  type: string;
}

export interface MemoryAtom {
  id: number;
  path: string;
  project: string;
  title: string;
  type: string;
  body: string;
  links: AtomLink[];
  updatedAt: string;
}

export interface SearchResult {
  id: number;
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

export const api = {
  dashboard: () => get<DashboardData>("/api/dashboard"),
  sessions: () => get<SessionInfo[]>("/api/sessions"),
  session: (id: string) => get<SessionInfo & { messages: any[] }>(`/api/sessions/${id}`),
  memories: (project?: string) => get<MemoryAtom[]>(`/api/memories${project ? `?project=${encodeURIComponent(project)}` : ""}`),
  memory: (id: number) => get<MemoryAtom>(`/api/memories/${id}`),
  search: (q: string, type?: string) => get<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ""}`),
  projects: () => get<string[]>("/api/projects"),
  plans: () => get<MemoryAtom[]>("/api/plans"),
  agents: () => get<MemoryAtom[]>("/api/agents"),
  skills: () => get<MemoryAtom[]>("/api/skills"),
};
