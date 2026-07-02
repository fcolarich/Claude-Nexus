---
id: ADR-010
title: Remove the Nexus task subsystem
type: adr
date: 2026-07-02
status: accepted
supersedes: null
tags: ["nexus", "tasks", "removal", "schema-migration", "mcp"]
---

**Decision:** Delete the entire task subsystem from Claude Nexus: three MCP tools (nexus_tasks, nexus_task_update, nexus_tasks_create), the atom_type=task path in nexus_remember (now knowledge-only), the /api/tasks web routes, the Tasks dashboard view plus its route and nav item, the task types (TaskStatus, TaskAtom, and the five task fields on Atom), parser and indexer task support, and the five task columns on the atoms table. Column and CHECK removal plus task-row purge is done via append-only schema migration v7, which preserves the v6 corpus-expansion linked_at column and project_doc source_type and recreates FTS, triggers, and indexes.

**Alternatives:** Keep the task subsystem as-is. Build a new per-project task tracker to replace it. Overload nexus_remember with an optional batch array while retaining tasks. Remove only code, leaving task columns and rows in the DB.

**Reason:** Cross-project task atoms are low value, and cross-project scope is exactly what the subsystem implemented. Within-session work is covered by TodoWrite; the cross-session durable-work case was already rejected when handoff memories were pruned as low signal. session-kanban owns manual work tracking and ADRs/DDRs own decisions, so the task subsystem is redundant surface area. Removing it also simplifies the nexus_remember schema ahead of adding a separate nexus_remember_batch tool (kept separate to preserve zod schema strictness).
