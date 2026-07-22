#!/usr/bin/env python3
"""Tests for backfill_vcc_shrink.py — stdlib unittest (no test framework
precedent exists yet under claude-nexus/scripts/).

Run: python scripts/backfill_vcc_shrink.test.py
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# VCC_COMPACT_MODULES_PATH must be set before importing the module under test
# (module-level functions import vcc_compact lazily inside shrink_session, but
# main()/is a cold-check helper — set it here so shrink_session tests can run
# if the module happens to be importable in this environment; is_caught_up
# and select_cold_sessions tests do not need it at all).
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT_GUESS = os.path.abspath(os.path.join(_THIS_DIR, "..", "..", "LLM_Workflow_Optimization",
                                                 "Local Marketplace Subproject", "plugins", "flow-shared", "modules"))
os.environ.setdefault("VCC_COMPACT_MODULES_PATH", _REPO_ROOT_GUESS)

import backfill_vcc_shrink as bvs  # noqa: E402


def make_db(rows: list[dict]) -> str:
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE sessions (
            session_id TEXT PRIMARY KEY,
            status TEXT,
            last_active TEXT,
            last_reflected_index INTEGER,
            vcc_shrunk_at TEXT,
            jsonl_path TEXT
        )
        """
    )
    for r in rows:
        conn.execute(
            "INSERT INTO sessions (session_id, status, last_active, last_reflected_index, vcc_shrunk_at, jsonl_path) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (r["session_id"], r["status"], r.get("last_active"), r["last_reflected_index"],
             r.get("vcc_shrunk_at"), r["jsonl_path"]),
        )
    conn.commit()
    conn.close()
    return path


def make_jsonl(line_count: int) -> str:
    fd, path = tempfile.mkstemp(suffix=".jsonl")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        for i in range(line_count):
            f.write(json.dumps({"type": "user", "message": {"role": "user", "content": f"line {i}"}}) + "\n")
    return path


def iso_days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")


class TestSelectColdSessions(unittest.TestCase):
    def test_selects_only_fully_cold_caught_up_unshrunk_rows(self):
        caught_up_file = make_jsonl(10)
        stale_cursor_file = make_jsonl(10)  # cursor will say 5 (not caught up)
        boundary_file = make_jsonl(3)

        rows = [
            {"session_id": "active1", "status": "active", "last_active": iso_days_ago(60),
             "last_reflected_index": 10, "jsonl_path": caught_up_file},
            {"session_id": "idle_caught_up", "status": "idle", "last_active": iso_days_ago(60),
             "last_reflected_index": 10, "jsonl_path": caught_up_file},
            {"session_id": "dead_stale_cursor", "status": "dead", "last_active": iso_days_ago(60),
             "last_reflected_index": 5, "jsonl_path": stale_cursor_file},
            {"session_id": "already_shrunk", "status": "dead", "last_active": iso_days_ago(60),
             "last_reflected_index": 3, "vcc_shrunk_at": "2026-01-01T00:00:00Z", "jsonl_path": boundary_file},
            {"session_id": "not_yet_inactive", "status": "idle", "last_active": iso_days_ago(5),
             "last_reflected_index": 3, "jsonl_path": boundary_file},
            {"session_id": "never_reflected", "status": "dead", "last_active": iso_days_ago(60),
             "last_reflected_index": 0, "jsonl_path": boundary_file},
            {"session_id": "boundary_ok", "status": "dead", "last_active": iso_days_ago(31),
             "last_reflected_index": 3, "jsonl_path": boundary_file},
        ]
        db_path = make_db(rows)
        conn = sqlite3.connect(db_path)
        try:
            sql_rows = bvs.select_cold_sessions(conn, inactive_days=30)
            sql_ids = {r["session_id"] for r in sql_rows}

            self.assertNotIn("active1", sql_ids)
            self.assertNotIn("already_shrunk", sql_ids)
            self.assertNotIn("not_yet_inactive", sql_ids)
            self.assertNotIn("never_reflected", sql_ids)
            self.assertIn("idle_caught_up", sql_ids)
            self.assertIn("dead_stale_cursor", sql_ids)
            self.assertIn("boundary_ok", sql_ids)

            eligible = [r for r in sql_rows if bvs.is_caught_up(r["jsonl_path"], r["last_reflected_index"])]
            eligible_ids = {r["session_id"] for r in eligible}
            self.assertIn("idle_caught_up", eligible_ids)
            self.assertIn("boundary_ok", eligible_ids)
            self.assertNotIn("dead_stale_cursor", eligible_ids)  # cursor 5 < 10 actual lines
        finally:
            conn.close()


class TestIsCaughtUp(unittest.TestCase):
    def test_caught_up_when_cursor_covers_all_lines(self):
        p = make_jsonl(5)
        self.assertTrue(bvs.is_caught_up(p, 5))
        self.assertTrue(bvs.is_caught_up(p, 6))  # cursor ahead is still "caught up"

    def test_not_caught_up_when_cursor_behind(self):
        p = make_jsonl(5)
        self.assertFalse(bvs.is_caught_up(p, 3))

    def test_missing_file_returns_false_without_raising(self):
        self.assertFalse(bvs.is_caught_up("/does/not/exist.jsonl", 10))


class TestDryRun(unittest.TestCase):
    def test_dry_run_selects_but_writes_nothing(self):
        jsonl = make_jsonl(3)
        rows = [{"session_id": "s1", "status": "dead", "last_active": iso_days_ago(60),
                  "last_reflected_index": 3, "jsonl_path": jsonl}]
        db_path = make_db(rows)

        before_content = open(jsonl, encoding="utf-8").read()
        rc = bvs.main(["--db-path", db_path, "--inactive-days", "30", "--dry-run"])
        self.assertEqual(rc, 0)

        after_content = open(jsonl, encoding="utf-8").read()
        self.assertEqual(before_content, after_content)
        self.assertFalse(os.path.exists(f"{jsonl}.vcc-tmp"))

        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT vcc_shrunk_at FROM sessions WHERE session_id='s1'").fetchone()
        conn.close()
        self.assertIsNone(row[0])


class TestLimit(unittest.TestCase):
    def test_limit_caps_post_filter_eligible_set_not_raw_sql_rows(self):
        # 3 rows pass the SQL prefilter; only 2 are actually caught_up (eligible).
        caught_up_a = make_jsonl(2)
        caught_up_b = make_jsonl(2)
        stale = make_jsonl(10)  # cursor 1 < 10, not caught up

        rows = [
            {"session_id": "a", "status": "dead", "last_active": iso_days_ago(60), "last_reflected_index": 2, "jsonl_path": caught_up_a},
            {"session_id": "b", "status": "dead", "last_active": iso_days_ago(60), "last_reflected_index": 2, "jsonl_path": caught_up_b},
            {"session_id": "c", "status": "dead", "last_active": iso_days_ago(60), "last_reflected_index": 1, "jsonl_path": stale},
        ]
        db_path = make_db(rows)
        conn = sqlite3.connect(db_path)
        try:
            sql_rows = bvs.select_cold_sessions(conn, inactive_days=30)
            self.assertEqual(len(sql_rows), 3)  # raw SQL count includes the stale-cursor row

            eligible = [r for r in sql_rows if bvs.is_caught_up(r["jsonl_path"], r["last_reflected_index"])]
            self.assertEqual(len(eligible), 2)  # only a, b are truly eligible

            limited = eligible[:1]
            self.assertEqual(len(limited), 1)  # --limit 1 caps the eligible set, not the raw 3
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
