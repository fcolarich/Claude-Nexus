import { globSync } from 'glob';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { getClaudeConfig } from '../core/config.js';
/**
 * Discover all indexable source files in the Claude directory.
 */
export function discoverSources() {
    const config = getClaudeConfig();
    const sources = [];
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
export function discoverSessions() {
    const config = getClaudeConfig();
    const sessions = [];
    if (!existsSync(config.projectsDir))
        return sessions;
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
 * Get directories to watch for file changes.
 */
export function getWatchPaths() {
    const config = getClaudeConfig();
    const paths = [];
    if (existsSync(config.agentsDir))
        paths.push(config.agentsDir);
    if (existsSync(config.skillsDir))
        paths.push(config.skillsDir);
    if (existsSync(config.plansDir))
        paths.push(config.plansDir);
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
//# sourceMappingURL=scanner.js.map