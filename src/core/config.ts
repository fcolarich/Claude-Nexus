import { join } from 'path';
import { homedir } from 'os';
import type { ClaudeConfig } from './types.js';

export function getClaudeConfig(): ClaudeConfig {
  const claudeDir = join(homedir(), '.claude');
  return {
    claudeDir,
    projectsDir: join(claudeDir, 'projects'),
    agentsDir: join(claudeDir, 'agents'),
    skillsDir: join(claudeDir, 'skills'),
    plansDir: join(claudeDir, 'plans'),
    todosDir: join(claudeDir, 'todos'),
    hooksDir: join(claudeDir, 'hooks'),
  };
}
