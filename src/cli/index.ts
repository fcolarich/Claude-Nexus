import { Command } from 'commander';
import chalk from 'chalk';
import { openDatabase, initializeSchema } from '../core/database.js';
import { runFullIndex } from '../indexer/indexer.js';
import { search, listAtoms, getDiagnostics, getStats, fetchContext, getSharedKnowledge, listSessions } from '../core/search.js';
import { startWatcher } from '../indexer/watcher.js';

const program = new Command();

program
  .name('nexus')
  .description('Claude Nexus — Zettelkasten dashboard for Claude Code')
  .version('0.1.0');

// ── nexus index ──────────────────────────────────────────────────────

program
  .command('index')
  .description('Index all Claude data (agents, skills, plans, memories, sessions)')
  .action(() => {
    const db = openDatabase();
    initializeSchema(db);

    console.log(chalk.blue('Indexing Claude data...'));
    const startTime = Date.now();
    const stats = runFullIndex(db);
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
  .description('Full-text search across all atoms')
  .option('-p, --project <project>', 'Filter by project slug')
  .option('-t, --type <type>', 'Filter by atom type')
  .option('-s, --scope <scope>', 'Filter by scope (global/shared/project)')
  .option('-l, --limit <limit>', 'Max results', '10')
  .action((query, opts) => {
    const db = openDatabase();
    const results = search(db, query, {
      project: opts.project,
      type: opts.type,
      scope: opts.scope,
      limit: parseInt(opts.limit),
    });

    if (results.length === 0) {
      console.log(chalk.yellow('No results found.'));
      db.close();
      return;
    }

    console.log(chalk.blue(`Found ${results.length} result(s) for "${query}":\n`));

    for (const r of results) {
      const scopeColor = r.atom.scope === 'global' ? chalk.cyan : r.atom.scope === 'shared' ? chalk.magenta : chalk.dim;
      const scope = scopeColor(`[${r.atom.scope}]`);
      const project = r.atom.project ? chalk.gray(r.atom.project) : chalk.gray('global');
      const type = chalk.gray(`(${r.atom.atom_type})`);

      console.log(`${chalk.bold(r.atom.title)} ${scope} ${type}`);
      console.log(`  ${project} | ${chalk.dim(r.atom.source_path)}`);
      console.log(`  ${r.snippet.replace(/<mark>/g, chalk.yellow.bold('')).replace(/<\/mark>/g, '')}`);
      console.log();
    }

    db.close();
  });

// ── nexus context ────────────────────────────────────────────────────

program
  .command('context <topics...>')
  .description('Smart fetch: merge multiple topics into one output')
  .option('-p, --project <project>', 'Filter by project')
  .action((topics, opts) => {
    const db = openDatabase();
    const merged = fetchContext(db, topics, { project: opts.project });

    if (!merged) {
      console.log(chalk.yellow('No atoms found for the given topics.'));
    } else {
      console.log(merged);
    }

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
    const grouped = new Map<string, typeof atoms>();
    for (const a of atoms) {
      const key = a.project || 'global';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(a);
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

    if (diags.length === 0) {
      console.log(chalk.green('No issues found!'));
      db.close();
      return;
    }

    const typeColors: Record<string, (s: string) => string> = {
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
      const statusColors: Record<string, (s: string) => string> = {
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

program.parse();
