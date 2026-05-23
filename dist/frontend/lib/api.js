const BASE = "http://localhost:3210";
async function get(path) {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok)
        throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}
async function patch(path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok)
        throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}
async function put(path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok)
        throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}
async function del(path) {
    const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
    if (!res.ok)
        throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}
async function post(path, body) {
    const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok)
        throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}
export const api = {
    dashboard: () => get("/api/dashboard"),
    sessions: async (project) => {
        const res = await get(`/api/sessions${project ? `?project=${encodeURIComponent(project)}` : ""}`);
        return res.sessions;
    },
    session: (id) => get(`/api/sessions/${id}`),
    renameSession: (id, title) => patch(`/api/sessions/${id}`, { title }),
    sessionMessages: (id) => get(`/api/sessions/${encodeURIComponent(id)}/messages`),
    sessionReferences: (id) => get(`/api/sessions/${encodeURIComponent(id)}/references`),
    deleteSession: (id) => del(`/api/sessions/${encodeURIComponent(id)}`),
    searchTranscripts: (q) => get(`/api/sessions/search?q=${encodeURIComponent(q)}`),
    memories: (params) => {
        const q = new URLSearchParams();
        if (params?.review_status)
            q.set("review_status", params.review_status);
        if (params?.memory_type)
            q.set("memory_type", params.memory_type);
        if (params?.project)
            q.set("project", params.project);
        if (params?.scope)
            q.set("scope", params.scope);
        if (params?.limit != null)
            q.set("limit", String(params.limit));
        if (params?.offset != null)
            q.set("offset", String(params.offset));
        const qs = q.toString();
        return get(`/api/memories${qs ? `?${qs}` : ""}`);
    },
    memory: (id) => get(`/api/memories/${encodeURIComponent(id)}`),
    updateMemory: (id, body) => put(`/api/memories/${encodeURIComponent(id)}`, body),
    reviewMemory: (id, status) => post(`/api/memories/${encodeURIComponent(id)}/review`, { status }),
    verifyMemory: (id) => post(`/api/memories/${encodeURIComponent(id)}/verify`, {}),
    memoryFeedback: (id, helped) => post(`/api/memories/${encodeURIComponent(id)}/feedback`, { helped }),
    deleteMemory: (id) => del(`/api/memories/${encodeURIComponent(id)}`),
    consolidate: () => post("/api/consolidate", {}),
    distill: () => post("/api/distill", {}),
    search: (q, type) => get(`/api/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ""}`),
    projects: () => get("/api/projects"),
    plans: () => get("/api/plans"),
    agents: () => get("/api/agents"),
    skills: () => get("/api/skills"),
    atomRaw: (id) => get(`/api/atoms/${encodeURIComponent(id)}/raw`),
    updateAtom: (id, body) => put(`/api/atoms/${encodeURIComponent(id)}`, { body }),
    deleteAtom: (id) => del(`/api/atoms/${encodeURIComponent(id)}`),
    deleteProject: (name) => del(`/api/projects/${encodeURIComponent(name)}`),
    createMemory: (data) => post("/api/atoms/create-memory", data),
    tasks: (params) => {
        const q = new URLSearchParams();
        if (params?.project)
            q.set('project', params.project);
        if (params?.status)
            q.set('status', params.status);
        if (params?.priority != null)
            q.set('priority', String(params.priority));
        if (params?.include_done)
            q.set('include_done', 'true');
        const qs = q.toString();
        return get(`/api/tasks${qs ? `?${qs}` : ''}`);
    },
    updateTask: (id, status) => patch(`/api/tasks/${encodeURIComponent(id)}`, { status }),
    createTask: (data) => post('/api/tasks', data),
};
//# sourceMappingURL=api.js.map