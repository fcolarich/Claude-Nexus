---
id: FEAT-20260730150659-74
title: Validate cited ADR/DDR id before Fix-1 reference-upgrade supersede
status: planned
date: 2026-07-30
links: ["ADR-20260730134500-2c"]
tags: ["capture", "reflector", "data-integrity"]
---

Before performing the supersede-insert upgrade in reflector.ts's isReferenceUpgrade path (ADR-20260730134500-2c), validate the cited ADR/DDR id in the reference candidate against readDecisionIndex(opts.cwd) -- already in scope at the reflect() call site -- to guard against a hallucinated id (e.g. extractor emits a non-existent "ADR-999") triggering an unwarranted supersede of a real decision memory. Explicitly flagged as an open TODO in the design doc for ADR-20260730134500-2c and deliberately left out of the shipped scope to keep that change to two files.
