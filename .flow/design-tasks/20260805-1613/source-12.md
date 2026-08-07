# Hash-based skip of unchanged memories on re-embedding/reindex passes

**Source**: _documents/features/feature-20260805151847-3d-hash-based-skip-of-unchanged-memories-on-re-embedd.md

## Summary

The feature proposes a SHA-256 content-hash-based caching mechanism to optimize bulk embedding operations. When running passes like nexus_reindex, instead of re-embedding the entire memory corpus, the system would only recompute embeddings for memories whose content has actually changed. Unchanged memories would be skipped based on matching their content hash, eliminating redundant computation and improving performance. The feature is tagged as a performance and embeddings optimization, with planned status.

## Key facts

- Uses SHA-256 hash of memory body content to detect changes
- Targets bulk reindexing passes (e.g., nexus_reindex) to skip unchanged memories
- Prevents re-embedding the entire corpus on every pass
- Tagged as performance and embeddings improvement
- References a related proposal in the LLM Workflow Optimization project

## Open questions

- Where and how is the content hash stored in the database (alongside memory records)?
- What happens to hashes when embedding model parameters or version changes occur—are all hashes invalidated?
- How does this interact with the distillation pipeline?
- Is there a conflict-resolution strategy if a hash mismatch is detected?
- Which reindex operations are in scope (just embeddings, or full reindex)?
