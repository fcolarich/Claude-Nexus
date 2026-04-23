import chokidar from 'chokidar';
import { basename } from 'path';
import { openDatabase, initializeSchema } from '../core/database.js';
import { getClaudeConfig } from '../core/config.js';
import { reindexFile } from './indexer.js';
import { getWatchPaths } from './scanner.js';
/**
 * Determine source type from file path.
 */
function getSourceType(filePath) {
    const config = getClaudeConfig();
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.includes('/agents/'))
        return 'agent_def';
    if (normalized.includes('/skills/') && basename(filePath) === 'SKILL.md')
        return 'skill_def';
    if (normalized.includes('/plans/'))
        return 'plan_file';
    if (normalized.includes('/memory/'))
        return 'memory_file';
    return null;
}
/**
 * Start watching Claude directories for changes.
 * Returns a cleanup function to stop watching.
 */
export function startWatcher(options) {
    const watchPaths = getWatchPaths();
    const db = openDatabase(options?.dbPath);
    initializeSchema(db);
    console.log(`Watching ${watchPaths.length} directories for changes...`);
    const watcher = chokidar.watch(watchPaths, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 500,
            pollInterval: 100,
        },
        // Only watch .md files
        ignored: (path) => {
            if (path.includes('node_modules'))
                return true;
            // Allow directories
            if (!path.includes('.'))
                return false;
            return !path.endsWith('.md');
        },
    });
    const handleChange = (filePath, event) => {
        const sourceType = getSourceType(filePath);
        if (!sourceType)
            return;
        try {
            reindexFile(db, filePath, sourceType);
            console.log(`[${event}] Reindexed: ${basename(filePath)}`);
            options?.onChange?.(filePath, event);
        }
        catch (err) {
            console.error(`[${event}] Failed to reindex ${filePath}:`, err.message);
        }
    };
    watcher
        .on('add', (path) => handleChange(path, 'add'))
        .on('change', (path) => handleChange(path, 'change'))
        .on('unlink', (path) => {
        const sourceType = getSourceType(path);
        if (!sourceType)
            return;
        // Remove atoms for deleted file
        db.prepare(`DELETE FROM atoms WHERE source_path = ?`).run(path);
        console.log(`[delete] Removed atoms for: ${basename(path)}`);
        options?.onChange?.(path, 'unlink');
    });
    return () => {
        watcher.close();
        db.close();
    };
}
//# sourceMappingURL=watcher.js.map