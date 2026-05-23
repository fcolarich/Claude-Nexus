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
export type MessageBlock = {
    type: "text";
    text: string;
} | {
    type: "image";
    mediaType: string;
    data: string;
} | {
    type: "thinking";
    text: string;
} | {
    type: "tool_use";
    toolId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
} | {
    type: "tool_result";
    toolUseId: string;
    resultContent: string;
    isError?: boolean;
};
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
export type MemoryType = "preference" | "convention" | "failure" | "correction" | "decision" | "insight" | "tool_quirk" | "reference" | "handoff";
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
export declare const api: {
    dashboard: () => Promise<DashboardData>;
    sessions: (project?: string) => Promise<SessionInfo[]>;
    session: (id: string) => Promise<SessionInfo>;
    renameSession: (id: string, title: string) => Promise<SessionInfo>;
    sessionMessages: (id: string) => Promise<{
        messages: ConversationMessage[];
    }>;
    sessionReferences: (id: string) => Promise<{
        references: SessionReference[];
    }>;
    deleteSession: (id: string) => Promise<{
        success: boolean;
    }>;
    searchTranscripts: (q: string) => Promise<{
        results: TranscriptSearchResult[];
    }>;
    memories: (params?: MemoryQuery) => Promise<MemoryListResponse>;
    memory: (id: string) => Promise<Memory>;
    updateMemory: (id: string, body: {
        title?: string;
        body?: string;
        tags?: string[];
    }) => Promise<Memory>;
    reviewMemory: (id: string, status: ReviewStatus) => Promise<{
        ok: boolean;
        status: string;
    }>;
    verifyMemory: (id: string) => Promise<{
        ok: boolean;
    }>;
    memoryFeedback: (id: string, helped: boolean) => Promise<{
        ok: boolean;
    }>;
    deleteMemory: (id: string) => Promise<{
        ok: boolean;
    }>;
    consolidate: () => Promise<{
        embedded: number;
        merged: number;
        pruned: number;
    }>;
    distill: () => Promise<{
        embedded: number;
        clusters: number;
        merged: number;
        created: number;
        sanitized: number;
    }>;
    search: (q: string, type?: string) => Promise<SearchResult[]>;
    projects: () => Promise<string[]>;
    plans: () => Promise<MemoryAtom[]>;
    agents: () => Promise<MemoryAtom[]>;
    skills: () => Promise<MemoryAtom[]>;
    atomRaw: (id: string) => Promise<{
        rawContent: string;
    }>;
    updateAtom: (id: string, body: string) => Promise<MemoryAtom>;
    deleteAtom: (id: string) => Promise<{
        success: boolean;
    }>;
    deleteProject: (name: string) => Promise<{
        success: boolean;
    }>;
    createMemory: (data: CreateMemoryParams) => Promise<{
        success: boolean;
        path: string;
    }>;
    tasks: (params?: {
        project?: string;
        status?: string;
        priority?: number;
        include_done?: boolean;
    }) => Promise<TaskItem[]>;
    updateTask: (id: string, status: TaskStatus) => Promise<TaskItem>;
    createTask: (data: CreateTaskParams) => Promise<TaskItem>;
};
//# sourceMappingURL=api.d.ts.map