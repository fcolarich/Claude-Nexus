# Claude Nexus

Zettelkasten dashboard for Claude Code — cross-project search, session monitoring, knowledge graph.

## Quick Start

```bash
cd C:\Fran\claude-nexus
npm install

# Index all Claude data
npx tsx src/cli/index.ts index

# Search across all projects
npx tsx src/cli/index.ts search "WebGL bridge"

# Smart fetch: merge multiple topics into one response
npx tsx src/cli/index.ts context "ECS architecture" "coding preferences"

# Check health (broken refs, orphans, missing frontmatter)
npx tsx src/cli/index.ts health

# List all atoms
npx tsx src/cli/index.ts list

# Show statistics
npx tsx src/cli/index.ts stats

# List sessions
npx tsx src/cli/index.ts sessions

# Watch for changes (live re-indexing)
npx tsx src/cli/index.ts watch
```

## MCP Server Setup

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "claude-nexus": {
      "command": "npx",
      "args": ["tsx", "C:\\Fran\\claude-nexus\\src\\mcp\\server.ts"]
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `nexus_search` | Cross-project full-text search |
| `nexus_context` | Smart fetch: merge multiple topics into one response |
| `nexus_shared` | Get all global/shared knowledge |
| `nexus_project` | Get all atoms for a specific project |
| `nexus_sessions` | List sessions with status |
| `nexus_health` | Diagnostics report |
| `nexus_remember` | Store a new knowledge atom |
| `nexus_stats` | Database statistics |

## Architecture

- **Database:** SQLite + FTS5 at `~/.claude-nexus/nexus.db`
- **Indexer:** Scans `~/.claude/` for agents, skills, plans, and per-project memory files
- **Parser:** Extracts YAML frontmatter, splits multi-section files, detects links
- **Search:** BM25 ranking via FTS5, scoped by project/type/scope
- **MCP Server:** Stdio transport, returns merged markdown responses
