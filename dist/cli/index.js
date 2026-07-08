import { Command } from 'commander';
import chalk from 'chalk';
import { openDatabase, initializeSchema } from '../core/database.js';
import { runFullIndex } from '../indexer/indexer.js';
import { hybridSearch, hybridSearchMemories, listAtoms, getDiagnostics, getStats, fetchContext, fetchMemoryContext, listSessions } from '../core/search.js';
import { startWatcher } from '../indexer/watcher.js';
import { backfillSessions, selectBackfillSessions } from '../capture/backfill.js';
import { deleteMemory } from '../core/memories.js';
import { selectNarrationMemories } from '../capture/prune.js';
import { exportAll } from '../capture/export.js';
import { migrateProjects } from '../capture/project-migrate.js';
const program = new Command();
program
    .name('nexus')
    .description('Claude Nexus — autonomous memory engine for Claude Code')
    .version('0.1.0');
// ── nexus index ──────────────────────────────────────────────────────
program
    .command('index')
    .description('Index all Claude data (agents, skills, plans, memories, sessions)')
    .action(async () => {
    const db = openDatabase();
    initializeSchema(db);
    console.log(chalk.blue('Indexing Claude data...'));
    const startTime = Date.now();
    const stats = await runFullIndex(db);
    const elapsed = Date.now() - startTime;
    console.log(chalk.green(`\nIndexing complete in ${elapsed}ms:`));
    console.log(`  Atoms created:   ${chalk.bold(stats.atomsCreated)}`);
    console.log(`  Atoms updated:   ${chalk.bold(stats.atomsUpdated)}`);
    console.log(`  Atoms unchanged: ${chalk.dim(stats.atomsUnchanged)}`);
    console.log(`  Links created:   ${chalk.bold(stats.linksCreated)}`);
    console.log(`  Diagnostics:     ${stats.diagnosticsCreated > 0 ? chalk.yellow(stats.diagnosticsCreated) : chalk.dim('0')}`);
    console.log(`  Sessions:        ${chalk.bold(stats.sessionsIndexed)}`);
    db.close();
});
// ── nexus search ─────────────────────────────────────────────────────
program
    .command('search <query>')
    .description('Hybrid (FTS5+vector) search across captured memories and knowledge atoms')
    .option('-p, --project <project>', 'Filter by project slug')
    .option('-t, --type <type>', 'Filter atoms by type (memories are unaffected by this flag)')
    .option('-s, --scope <scope>', 'Filter by scope (global/shared/project)')
    .option('-l, --limit <limit>', 'Max results per store', '10')
    .action(async (query, opts) => {
    const db = openDatabase();
    const limit = parseInt(opts.limit);
    const [atomResults, memResults] = await Promise.all([
        hybridSearch(db, query, { project: opts.project, type: opts.type, scope: opts.scope, limit }),
        hybridSearchMemories(db, query, { project: opts.project, scope: opts.scope, limit }),
    ]);
    if (atomResults.length === 0 && memResults.length === 0) {
        console.log(chalk.yellow('No results found.'));
        db.close();
        return;
    }
    console.log(chalk.blue(`Found ${memResults.length} memory result(s) and ${atomResults.length} atom result(s) for "${query}":\n`));
    if (memResults.length > 0) {
        console.log(chalk.blue.bold('Captured Memories'));
        for (const r of memResults) {
            const scopeColor = r.memory.scope === 'global' ? chalk.cyan : r.memory.scope === 'shared' ? chalk.magenta : chalk.dim;
            const scope = scopeColor(`[${r.memory.scope}]`);
            const type = chalk.gray(`(${r.memory.memory_type})`);
            const conf = chalk.gray(`${(r.memory.confidence * 100).toFixed(0)}%`);
            console.log(`${chalk.bold(r.memory.title)} ${scope} ${type} ${conf}`);
            console.log(`  ${r.snippet.replace(/<mark>/g, chalk.yellow.bold('')).replace(/<\/mark>/g, '')}`);
            console.log();
        }
    }
    if (atomResults.length > 0) {
        console.log(chalk.blue.bold('Knowledge Atoms'));
        for (const r of atomResults) {
            const scopeColor = r.atom.scope === 'global' ? chalk.cyan : r.atom.scope === 'shared' ? chalk.magenta : chalk.dim;
            const scope = scopeColor(`[${r.atom.scope}]`);
            const project = r.atom.project ? chalk.gray(r.atom.project) : chalk.gray('global');
            const type = chalk.gray(`(${r.atom.atom_type})`);
            console.log(`${chalk.bold(r.atom.title)} ${scope} ${type}`);
            console.log(`  ${project} | ${chalk.dim(r.atom.source_path)}`);
            console.log(`  ${r.snippet.replace(/<mark>/g, chalk.yellow.bold('')).replace(/<\/mark>/g, '')}`);
            console.log();
        }
    }
    db.close();
});
// ── nexus context ────────────────────────────────────────────────────
program
    .command('context <topics...>')
    .description('Smart fetch: merge multiple topics into one output (captured memories + knowledge atoms)')
    .option('-p, --project <project>', 'Filter by project')
    .action((topics, opts) => {
    const db = openDatabase();
    const memMerged = fetchMemoryContext(db, topics, { project: opts.project });
    const atomMerged = fetchContext(db, topics, { project: opts.project });
    if (!memMerged && !atomMerged) {
        console.log(chalk.yellow('No knowledge found for the given topics.'));
        db.close();
        return;
    }
    const parts = [];
    if (memMerged)
        parts.push(memMerged);
    if (atomMerged)
        parts.push(atomMerged);
    console.log(parts.join('\n\n---\n\n'));
    db.close();
});
// ── nexus list ───────────────────────────────────────────────────────
program
    .command('list')
    .description('List all atoms')
    .option('-t, --type <type>', 'Filter by type')
    .option('-s, --scope <scope>', 'Filter by scope')
    .option('-p, --project <project>', 'Filter by project')
    .action((opts) => {
    const db = openDatabase();
    const atoms = listAtoms(db, opts);
    if (atoms.length === 0) {
        console.log(chalk.yellow('No atoms found.'));
        db.close();
        return;
    }
    // Group by project
    const grouped = new Map();
    for (const a of atoms) {
        const key = a.project || 'global';
        if (!grouped.has(key))
            grouped.set(key, []);
        grouped.get(key).push(a);
    }
    for (const [project, projectAtoms] of grouped) {
        console.log(chalk.blue.bold(`\n${project}`));
        for (const a of projectAtoms) {
            const scopeColor = a.scope === 'global' ? chalk.cyan : a.scope === 'shared' ? chalk.magenta : chalk.dim;
            const scope = scopeColor(`[${a.scope}]`);
            const type = chalk.gray(`(${a.atom_type})`);
            console.log(`  ${chalk.bold(a.title)} ${scope} ${type}`);
        }
    }
    console.log(chalk.dim(`\nTotal: ${atoms.length} atoms`));
    db.close();
});
// ── nexus health ─────────────────────────────────────────────────────
program
    .command('health')
    .description('Show diagnostics: broken refs, duplicates, orphans, missing frontmatter')
    .option('-t, --type <type>', 'Filter by diagnostic type')
    .action((opts) => {
    const db = openDatabase();
    const diags = getDiagnostics(db, opts.type);
    const stats = getStats(db);
    console.log(chalk.blue.bold('Nexus Health Report'));
    console.log(`${chalk.bold('Atoms:')} ${stats.totalAtoms} | ${chalk.bold('Memories:')} ${stats.totalMemories} | ${chalk.bold('Links:')} ${stats.totalLinks} | ${chalk.bold('Sessions:')} ${stats.totalSessions}`);
    console.log(`${chalk.bold('Issues:')} ${stats.totalDiagnostics}\n`);
    if (diags.length === 0) {
        console.log(chalk.green('No issues found!'));
        db.close();
        return;
    }
    const typeColors = {
        broken_reference: chalk.red,
        missing_frontmatter: chalk.yellow,
        duplicate: chalk.magenta,
        orphan: chalk.cyan,
        stale: chalk.gray,
    };
    for (const d of diags) {
        const color = typeColors[d.type] || chalk.white;
        console.log(`${color(`[${d.type}]`)} ${d.message}`);
        if (d.details) {
            console.log(chalk.dim(`  ${d.details.split('\n').join('\n  ')}`));
        }
    }
    console.log(chalk.dim(`\nTotal issues: ${diags.length}`));
    db.close();
});
// ── nexus stats ──────────────────────────────────────────────────────
program
    .command('stats')
    .description('Show database statistics')
    .action(() => {
    const db = openDatabase();
    const stats = getStats(db);
    console.log(chalk.blue.bold('\nClaude Nexus Statistics'));
    console.log(chalk.blue('═'.repeat(40)));
    console.log(`\n${chalk.bold('Atoms:')} ${stats.totalAtoms}`);
    for (const [type, count] of Object.entries(stats.atomsByType)) {
        console.log(`  ${type}: ${count}`);
    }
    console.log(`\n${chalk.bold('By Scope:')}`);
    for (const [scope, count] of Object.entries(stats.atomsByScope)) {
        console.log(`  ${scope}: ${count}`);
    }
    console.log(`\n${chalk.bold('By Project:')}`);
    for (const [project, count] of Object.entries(stats.atomsByProject)) {
        console.log(`  ${project}: ${count}`);
    }
    console.log(`${chalk.bold('Embedded:')} ${stats.embeddedAtoms}`);
    console.log(`\n${chalk.bold('Memories:')} ${stats.totalMemories}`);
    for (const [status, count] of Object.entries(stats.memoriesByReview)) {
        console.log(`  ${status}: ${count}`);
    }
    console.log(`${chalk.bold('Embedded:')} ${stats.embeddedMemories}`);
    console.log(`\n${chalk.bold('Links:')} ${stats.totalLinks}`);
    console.log(`${chalk.bold('Sessions:')} ${stats.totalSessions}`);
    console.log(`${chalk.bold('Diagnostics:')} ${stats.totalDiagnostics}`);
    if (stats.totalDiagnostics > 0) {
        for (const [type, count] of Object.entries(stats.diagnosticsByType)) {
            console.log(`  ${type}: ${count}`);
        }
    }
    db.close();
});
// ── nexus sessions ───────────────────────────────────────────────────
program
    .command('sessions')
    .description('List indexed sessions')
    .option('-p, --project <project>', 'Filter by project')
    .option('-l, --limit <limit>', 'Max results', '20')
    .action((opts) => {
    const db = openDatabase();
    const sessions = listSessions(db, { project: opts.project });
    const limit = parseInt(opts.limit);
    if (sessions.length === 0) {
        console.log(chalk.yellow('No sessions found.'));
        db.close();
        return;
    }
    console.log(chalk.blue(`Sessions (${Math.min(sessions.length, limit)} of ${sessions.length}):\n`));
    for (const s of sessions.slice(0, limit)) {
        const statusColors = {
            active: chalk.green,
            waiting_input: chalk.yellow,
            processing: chalk.blue,
            idle: chalk.gray,
            dead: chalk.dim,
        };
        const statusColor = statusColors[s.status] || chalk.white;
        const status = statusColor(`[${s.status}]`);
        const project = chalk.cyan(s.project);
        const branch = s.git_branch ? chalk.gray(`(${s.git_branch})`) : '';
        const date = s.last_active ? chalk.dim(new Date(s.last_active).toLocaleDateString()) : '';
        console.log(`${status} ${project} ${branch} ${date}`);
        if (s.summary) {
            console.log(`  ${chalk.dim(s.summary.slice(0, 100))}${s.summary.length > 100 ? '...' : ''}`);
        }
        console.log(`  ${chalk.dim(`${s.message_count} messages, ${s.subagent_count} subagents`)}`);
        console.log();
    }
    db.close();
});
// ── nexus watch ──────────────────────────────────────────────────────
program
    .command('watch')
    .description('Watch Claude directories for changes and re-index automatically')
    .action(() => {
    console.log(chalk.blue('Starting file watcher...'));
    console.log(chalk.dim('Press Ctrl+C to stop.\n'));
    const stop = startWatcher({
        onChange: (filePath, event) => {
            // Already logged by watcher
        },
    });
    process.on('SIGINT', () => {
        console.log(chalk.yellow('\nStopping watcher...'));
        stop();
        process.exit(0);
    });
});
// ── nexus backfill ───────────────────────────────────────────────────
program
    .command('backfill')
    .description('Retroactively extract memories from past sessions (those predating the capture hooks)')
    .option('-p, --project <project>', 'Limit to one project slug')
    .option('-m, --min-messages <n>', 'Skip sessions with fewer messages', '8')
    .option('-l, --limit <n>', 'Max sessions to process', '50')
    .option('--since <date>', 'Only sessions active on/after this ISO date')
    .option('--force', 'Re-analyze sessions already processed')
    .option('--dry-run', 'Report how many sessions would be processed, then exit')
    .action(async (opts) => {
    const db = openDatabase();
    initializeSchema(db);
    const backfillOpts = {
        project: opts.project,
        minMessages: parseInt(opts.minMessages, 10),
        limit: parseInt(opts.limit, 10),
        since: opts.since,
        force: !!opts.force,
        dryRun: !!opts.dryRun,
    };
    if (backfillOpts.dryRun) {
        const sel = selectBackfillSessions(db, backfillOpts);
        console.log(chalk.blue(`${sel.length} session(s) would be backfilled (~${sel.length} LLM calls).`));
        db.close();
        return;
    }
    console.log(chalk.blue('Backfilling memories from past sessions — one LLM call per session...'));
    const r = await backfillSessions(db, backfillOpts);
    console.log(chalk.green('\nBackfill complete:'));
    console.log(`  Sessions processed: ${chalk.bold(r.processed)} / ${r.selected}`);
    console.log(`  Memories created:   ${chalk.bold(r.inserted)}`);
    console.log(`  Merged (duplicate): ${chalk.dim(r.merged)}`);
    console.log(`  Nothing to capture: ${chalk.dim(r.skippedNoSignal)}`);
    db.close();
});
// ── nexus prune-narration ────────────────────────────────────────────
program
    .command('prune-narration')
    .description('Remove handoff memories (end-of-session state, no longer a captured type) across all projects')
    .option('--apply', 'Actually delete (default is a dry-run)')
    .action((opts) => {
    const db = openDatabase();
    initializeSchema(db);
    const victims = selectNarrationMemories(db);
    if (victims.length === 0) {
        console.log(chalk.green('No handoff memories found.'));
        db.close();
        return;
    }
    const reasonColors = {
        'handoff': chalk.magenta,
    };
    for (const v of victims) {
        const tag = (reasonColors[v.reason] ?? chalk.white)(`[${v.reason}]`);
        console.log(`${tag} ${chalk.gray(`(${v.memory_type})`)} ${v.title}`);
    }
    const counts = victims.reduce((acc, v) => { acc[v.reason] = (acc[v.reason] ?? 0) + 1; return acc; }, {});
    console.log(chalk.blue(`\n${victims.length} memories matched: ${Object.entries(counts).map(([r, n]) => `${n} ${r}`).join(', ')}`));
    if (!opts.apply) {
        console.log(chalk.yellow('Dry-run — re-run with --apply to hard-delete.'));
        db.close();
        return;
    }
    let deleted = 0;
    for (const v of victims)
        if (deleteMemory(db, v.id))
            deleted++;
    const exp = exportAll(db);
    console.log(chalk.green(`Deleted ${deleted} memories; re-exported ${exp.files} files across ${exp.buckets} project bucket(s).`));
    db.close();
});
// ── nexus migrate-projects ──────────────────────────────────────────
program
    .command('migrate-projects')
    .description('Merge project buckets fragmented by pre-fix slug bugs or subdirectory-per-project sessions, via git-root resolution')
    .option('--apply', 'Actually merge rows and clean up stale export directories (default is a dry-run)')
    .action(async (opts) => {
    const db = openDatabase();
    initializeSchema(db);
    const report = await migrateProjects(db, { dryRun: !opts.apply });
    if (report.aliases.length === 0) {
        console.log(chalk.green('No fragmented projects found — nothing to merge.'));
        db.close();
        return;
    }
    console.log(chalk.blue(`${report.aliases.length} project(s) would merge:\n`));
    for (const { alias, canonical } of report.aliases) {
        console.log(`  ${chalk.red(alias)} -> ${chalk.green(canonical)}`);
    }
    if (!opts.apply) {
        console.log(chalk.yellow('\nDry-run — re-run with --apply to merge and clean up stale export directories.'));
        db.close();
        return;
    }
    console.log(chalk.green(`\nMerged: ${report.memoriesUpdated} memories, ${report.atomsUpdated} atoms, ${report.sessionsUpdated} sessions.`));
    console.log(`Deduplicated ${report.merged} near-identical memory pair(s) created by the merge.`);
    db.close();
});
program.parse();
//# sourceMappingURL=index.js.map