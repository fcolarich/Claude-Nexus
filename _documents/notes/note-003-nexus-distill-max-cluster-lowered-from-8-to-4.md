---
id: NOTE-003
title: nexus_distill MAX_CLUSTER lowered from 8 to 4
date: 2026-07-26
tags: ["distill", "tuning", "consolidate"]
---

src/core/distill.ts MAX_CLUSTER lowered from 8 to 4 (uncommitted as of 2026-07-26), tightening the max cluster size fed to the LLM cluster-and-rewrite pass in nexus_distill. Part of the same bounding work as the merged feature/nexus-distill-chunking branch (commits ecdd352, 197b913) that added chunking for large memory sets. No dedicated ADR/DDR exists for the distill-chunking feature itself - this is a follow-up tuning tweak, not a new design decision, so it is recorded here rather than as a new DDR.
