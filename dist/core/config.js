import { join } from 'path';
import { homedir } from 'os';
export function getClaudeConfig() {
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
//# sourceMappingURL=config.js.map