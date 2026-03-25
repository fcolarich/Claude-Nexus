#!/usr/bin/env bash
# Install Claude Nexus skill and MCP server into Claude Code
# Usage: bash scripts/install-skill.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"
SKILL_DIR="$CLAUDE_DIR/skills/claude-nexus"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

echo "Installing Claude Nexus skill..."

# 1. Copy skill file
mkdir -p "$SKILL_DIR"
cp "$PROJECT_ROOT/skills/claude-nexus/SKILL.md" "$SKILL_DIR/SKILL.md"
echo "  Skill installed to $SKILL_DIR/SKILL.md"

# 2. Register MCP server in settings.json if not already present
if [ ! -f "$SETTINGS_FILE" ]; then
  echo '{}' > "$SETTINGS_FILE"
fi

if grep -q '"claude-nexus"' "$SETTINGS_FILE" 2>/dev/null; then
  echo "  MCP server already registered in settings.json"
else
  # Use node to safely merge into existing JSON
  node -e "
    const fs = require('fs');
    const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf-8'));
    if (!settings.mcpServers) settings.mcpServers = {};
    settings.mcpServers['claude-nexus'] = {
      command: 'npx',
      args: ['tsx', '$PROJECT_ROOT/src/mcp/server.ts'.replace(/\\\\/g, '/')]
    };
    fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2) + '\n');
  "
  echo "  MCP server registered in $SETTINGS_FILE"
fi

# 3. Add claude-nexus to use-skills table if it exists and doesn't already have it
USE_SKILLS="$CLAUDE_DIR/skills/use-skills/SKILL.md"
if [ -f "$USE_SKILLS" ] && ! grep -q 'claude-nexus' "$USE_SKILLS"; then
  # Append row to the skills table (before the Common Mistakes section)
  sed -i '/^## Common Mistakes/i | `claude-nexus` | Cross-project knowledge retrieval, session awareness, or saving insights via Nexus MCP |' "$USE_SKILLS"
  echo "  Added claude-nexus to use-skills table"
else
  echo "  use-skills table already has claude-nexus (or use-skills not found)"
fi

echo ""
echo "Done! Restart Claude Code to pick up the new MCP server."
echo "The claude-nexus skill will be available in all sessions."
