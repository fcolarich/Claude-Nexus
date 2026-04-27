import { globSync } from 'glob';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getClaudeConfig } from '../core/config.js';
import type { SourceType } from '../core/types.js';

export interface CoworkSession {
  auditPath: string;
  metaPath: string | null;
  workspaceId: string;
  participantId: string;
  sessionDirName: string;
}

export interface SourceFile {
  path: string;
  sourceType: SourceType;
}

/**
 * Discover all indexable source files in the Claude directory.
 */
export function discoverSources(): SourceFile[] {
  const config = getClaudeConfig();
  const sources: SourceFile[] = [];

  // 1. Agent definitions: ~/.claude/agents/*.md
  if (existsSync(config.agentsDir)) {
    const agentFiles = globSync('*.md', { cwd: config.agentsDir, absolute: true });
    for (const f of agentFiles) {
      sources.push({ path: f, sourceType: 'agent_def' });
    }
  }

  // 2. Skill definitions: ~/.claude/skills/*/SKILL.md
  if (existsSync(config.skillsDir)) {
    const skillDirs = readdirSync(config.skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
    for (const dir of skillDirs) {
      const skillFile = join(config.skillsDir, dir.name, 'SKILL.md');
      if (existsSync(skillFile)) {
        sources.push({ path: skillFile, sourceType: 'skill_def' });
      }
    }
  }

  // 3. Plan files: ~/.claude/plans/*.md
  if (existsSync(config.plansDir)) {
    const planFiles = globSync('*.md', { cwd: config.plansDir, absolute: true });
    for (const f of planFiles) {
      sources.push({ path: f, sourceType: 'plan_file' });
    }
  }

  // 4. Project memory files: ~/.claude/projects/*/memory/*.md
  if (existsSync(config.projectsDir)) {
    const projectDirs = readdirSync(config.projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
    for (const projDir of projectDirs) {
      const memoryDir = join(config.projectsDir, projDir.name, 'memory');
      if (existsSync(memoryDir)) {
        const memoryFiles = globSync('*.md', { cwd: memoryDir, absolute: true });
        for (const f of memoryFiles) {
          sources.push({ path: f, sourceType: 'memory_file' });
        }
      }
    }
  }

  return sources;
}

/**
 * Discover all session JSONL files across projects.
 */
export function discoverSessions(): { path: string; project: string }[] {
  const config = getClaudeConfig();
  const sessions: { path: string; project: string }[] = [];

  if (!existsSync(config.projectsDir)) return sessions;

  const projectDirs = readdirSync(config.projectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const projDir of projectDirs) {
    const projPath = join(config.projectsDir, projDir.name);
    // JSONL files are directly in the project directory: {uuid}.jsonl
    const entries = readdirSync(projPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        sessions.push({ path: join(projPath, entry.name), project: projDir.name });
      }
    }
  }

  return sessions;
}

/**
 * Discover Cowork (desktop app) audit.jsonl sessions from the Windows Claude package directory.
 */
export function discoverCoworkSessions(): CoworkSession[] {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return [];

  const packagesDir = join(localAppData, 'Packages');
  if (!existsSync(packagesDir)) return [];

  const claudePackageDirs = readdirSync(packagesDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('Claude_'));
  if (claudePackageDirs.length === 0) return [];

  const claudeDataDir = join(packagesDir, claudePackageDirs[0].name, 'LocalCache', 'Roaming', 'Claude');
  const agentSessionsDir = join(claudeDataDir, 'local-agent-mode-sessions');
  const codeSessionsDir = join(claudeDataDir, 'claude-code-sessions');

  if (!existsSync(agentSessionsDir)) return [];

  const results: CoworkSession[] = [];

  const workspaceDirs = readdirSync(agentSessionsDir, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const ws of workspaceDirs) {
    const wsPath = join(agentSessionsDir, ws.name);
    const participantDirs = readdirSync(wsPath, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const pt of participantDirs) {
      const ptPath = join(wsPath, pt.name);
      const sessionDirs = readdirSync(ptPath, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const sd of sessionDirs) {
        const auditPath = join(ptPath, sd.name, 'audit.jsonl');
        if (!existsSync(auditPath)) continue;

        // Companion metadata JSON is a sibling of the session directory
        const candidateMetaPath = join(ptPath, `${sd.name}.json`);
        const metaPath = existsSync(candidateMetaPath) ? candidateMetaPath : null;

        results.push({
          auditPath,
          metaPath,
          workspaceId: ws.name,
          participantId: pt.name,
          sessionDirName: sd.name,
        });
      }
    }
  }

  return results;
}

/**
 * Get directories to watch for file changes.
 */
export function getWatchPaths(): string[] {
  const config = getClaudeConfig();
  const paths: string[] = [];

  if (existsSync(config.agentsDir)) paths.push(config.agentsDir);
  if (existsSync(config.skillsDir)) paths.push(config.skillsDir);
  if (existsSync(config.plansDir)) paths.push(config.plansDir);

  // Watch all project memory directories
  if (existsSync(config.projectsDir)) {
    const projectDirs = readdirSync(config.projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
    for (const projDir of projectDirs) {
      const memoryDir = join(config.projectsDir, projDir.name, 'memory');
      if (existsSync(memoryDir)) {
        paths.push(memoryDir);
      }
    }
  }

  return paths;
}
