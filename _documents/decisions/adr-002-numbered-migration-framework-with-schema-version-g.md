---
id: ADR-002
title: Numbered migration framework with schema_version guard
type: adr
date: 2025-01-01
status: accepted
supersedes: null
tags: []
---

**Decision:** All schema changes are numbered migrations stored in a `MIGRATIONS` array in `src/core/database.ts`. A `schema_version` table records which have run; on init, migrations with `version > current` apply in order. Each migration is idempotent (`IF NOT EXISTS` / guarded `ALTER`). The version row is only recorded on success — a partial failure followed by a retry is safe.

**Alternatives:** ORMs with auto-migration (TypeORM, Prisma) — rejected to keep the stack flat and avoid ORM overhead on a performance-sensitive hot path (session start recall).

**Reason:** The guarded migration pattern (used in migrations 1–6) handles pre-versioning DBs, partial failures, and the SQLite constraint that CHECK constraints cannot be modified via ALTER TABLE (migration 6 uses a full table recreate inside `foreign_keys = OFF` for this reason).
