#!/usr/bin/env python3
"""Cold-session backfill: shrink raw session JSONLs the inline reflect() shrink
never touched (sessions reflected before this feature shipped, or where the
inline shrink itself failed and left ``vcc_shrunk_at`` NULL).

Operator-invoked, not a hook — hard-fails loudly on misconfiguration (unlike
the fail-open hooks/reflector code).

Env vars:
    VCC_COMPACT_MODULES_PATH   required. Absolute path to the flow-shared
                                directory containing the ``vcc_compact``
                                package (same env var backs vcc-bridge.ts's
                                PYTHONPATH construction — one place an
                                operator configures the cross-repo path).
    PYTHON_BIN                  not used by this script (it imports vcc_compact
                                in-process, no subprocess hop) — documented here
                                only for cross-reference: it is read by
                                src/capture/vcc-bridge.ts's spawnSync calls to
                                override the default 'python' binary tried
                                before the 'py -3' fallback.

Usage:
    python scripts/backfill_vcc_shrink.py --db-path <path> [--inactive-days 30]
        [--dry-run] [--limit N]
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime, timezone


def _load_vcc_compact_modules_path() -> str:
    """Resolve and sys.path-insert VCC_COMPACT_MODULES_PATH. Fail loudly if
    unset or invalid — this is an operator-invoked script, hard-failing here
    is correct (see architecture.md's ColdSessionBackfill decision)."""
    modules_path = os.environ.get("VCC_COMPACT_MODULES_PATH")
    if not modules_path:
        print(
            "error: VCC_COMPACT_MODULES_PATH is not set. Point it at the flow-shared "
            "directory containing the vcc_compact package (e.g. "
            "'<repo>/Local Marketplace Subproject/plugins/flow-shared/modules').",
            file=sys.stderr,
        )
        raise SystemExit(1)
    if not os.path.isdir(modules_path):
        print(f"error: VCC_COMPACT_MODULES_PATH does not point to a directory: {modules_path}", file=sys.stderr)
        raise SystemExit(1)
    if modules_path not in sys.path:
        sys.path.insert(0, modules_path)
    return modules_path


def select_cold_sessions(conn: sqlite3.Connection, inactive_days: int) -> list[sqlite3.Row]:
    """SQL prefilter: cold (dead/idle), inactive past the threshold, reflected
    at least once, never shrunk. Cannot express the "caught up with current
    line count" check in SQL — see is_caught_up()."""
    conn.row_factory = sqlite3.Row
    cur = conn.execute(
        """
        SELECT session_id, jsonl_path, last_reflected_index
        FROM sessions
        WHERE status IN ('dead', 'idle')
          AND last_active IS NOT NULL
          AND last_active <= datetime('now', ?)
          AND last_reflected_index > 0
          AND vcc_shrunk_at IS NULL
        """,
        (f"-{inactive_days} days",),
    )
    return cur.fetchall()


def is_caught_up(jsonl_path: str, last_reflected_index: int) -> bool:
    """True iff the reflector's cursor has consumed the entire current file —
    the only safe signal that no live reflect() call could still be running
    against this (already-cold, already-inactive) session."""
    if not jsonl_path or not os.path.isfile(jsonl_path):
        print(f"warning: jsonl_path missing, skipping: {jsonl_path}", file=sys.stderr)
        return False
    try:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            actual_line_count = sum(1 for line in f if line.strip())
    except OSError as exc:
        print(f"warning: could not read {jsonl_path}: {exc}", file=sys.stderr)
        return False
    return last_reflected_index >= actual_line_count


def shrink_session(conn: sqlite3.Connection, session_id: str, jsonl_path: str) -> bool:
    """Compact jsonl_path in place (import vcc_compact directly, no subprocess)
    and mark the session shrunk. Returns True on success."""
    from vcc_compact.format import format_summary
    from vcc_compact.normalize import adapt_claude_transcript
    from vcc_compact.pipeline import compact_history

    records: list[dict] = []
    try:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            import json

            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError as exc:
        print(f"warning: could not read {jsonl_path} for shrink: {exc}", file=sys.stderr)
        return False

    messages = adapt_claude_transcript(records)
    result = compact_history(messages)
    summary_text = format_summary(result)

    tmp_path = f"{jsonl_path}.vcc-tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(summary_text)
        os.replace(tmp_path, jsonl_path)
    except OSError as exc:
        print(f"warning: could not write/rename shrink output for {jsonl_path}: {exc}", file=sys.stderr)
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        return False

    conn.execute(
        "UPDATE sessions SET vcc_shrunk_at = ? WHERE session_id = ?",
        (datetime.now(timezone.utc).isoformat(), session_id),
    )
    conn.commit()
    return True


def main(argv: list[str] | None = None) -> int:
    _load_vcc_compact_modules_path()

    parser = argparse.ArgumentParser(prog="backfill_vcc_shrink")
    parser.add_argument("--db-path", required=True, help="path to nexus.db")
    parser.add_argument("--inactive-days", type=int, default=30, help="inactivity threshold in days (default: 30)")
    parser.add_argument("--dry-run", action="store_true", help="select and print eligible rows; write nothing")
    parser.add_argument("--limit", type=int, default=None, help="cap the number of *eligible* (post-filter) rows processed")
    args = parser.parse_args(argv)

    conn = sqlite3.connect(args.db_path)
    try:
        candidates = select_cold_sessions(conn, args.inactive_days)
        eligible = [row for row in candidates if is_caught_up(row["jsonl_path"], row["last_reflected_index"])]

        if args.limit is not None:
            eligible = eligible[: args.limit]

        if args.dry_run:
            for row in eligible:
                print(f"[dry-run] would shrink session_id={row['session_id']} jsonl_path={row['jsonl_path']}")
            return 0

        shrunk = 0
        for row in eligible:
            if shrink_session(conn, row["session_id"], row["jsonl_path"]):
                shrunk += 1
        print(f"shrunk {shrunk}/{len(eligible)} eligible session(s)")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
