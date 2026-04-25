import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { basename, dirname, relative, resolve } from 'path';
import matter from 'gray-matter';
import type { AtomType, AtomScope, SourceType, LinkType, ParsedFile, DiagnosticType } from '../core/types.js';
import { getClaudeConfig } from '../core/config.js';
import { existsSync } from 'fs';

export function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function computeAtomId(sourcePath: string, sectionIndex: number): string {
  return createHash('sha256')
    .update(`${sourcePath}:${sectionIndex}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Determine the atom type from frontmatter, directory, or filename.
 */
function inferAtomType(
  frontmatterType?: string,
  sourceType?: SourceType,
  filename?: string
): AtomType {
  // Frontmatter type takes priority
  if (frontmatterType === 'task') return 'task';
  if (frontmatterType === 'feedback') return 'feedback';
  if (frontmatterType === 'reference') return 'reference';
  if (frontmatterType === 'project') return 'project_note';

  // Source type
  if (sourceType === 'agent_def') return 'agent';
  if (sourceType === 'skill_def') return 'skill';
  if (sourceType === 'plan_file') return 'plan';

  // Filename prefix conventions
  if (filename) {
    if (filename.startsWith('feedback_')) return 'feedback';
    if (filename.startsWith('reference_')) return 'reference';
    if (filename.startsWith('project_')) return 'project_note';
    if (filename === 'MEMORY.md') return 'memory';
  }

  return 'memory';
}

/**
 * Infer scope from content and location.
 * - Agents and skills are global
 * - feedback_* files often contain global preferences
 * - project_* files are project-scoped
 */
function inferScope(atomType: AtomType, sourceType: SourceType): AtomScope {
  if (sourceType === 'agent_def' || sourceType === 'skill_def') return 'global';
  if (atomType === 'feedback') return 'global'; // Preferences tend to be user-level
  if (atomType === 'plan') return 'project';
  return 'project';
}

/**
 * Extract tags from markdown content: headers, code references, frontmatter keywords.
 */
function extractTags(body: string, frontmatter?: Record<string, unknown>): string[] {
  const tags = new Set<string>();

  // Tags from frontmatter
  if (frontmatter?.tags && Array.isArray(frontmatter.tags)) {
    for (const t of frontmatter.tags) tags.add(String(t).toLowerCase());
  }
  if (frontmatter?.keywords && Array.isArray(frontmatter.keywords)) {
    for (const t of frontmatter.keywords) tags.add(String(t).toLowerCase());
  }

  // Tags from H2/H3 headers (short ones make good tags)
  const headerRegex = /^#{2,3}\s+(.+)$/gm;
  let match;
  while ((match = headerRegex.exec(body)) !== null) {
    const header = match[1].trim();
    if (header.length <= 40) {
      tags.add(header.toLowerCase());
    }
  }

  return [...tags];
}

/**
 * Extract markdown links from body text.
 * Returns relative paths of link targets.
 */
function extractLinks(body: string): string[] {
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  const links: string[] = [];
  let match;
  while ((match = linkRegex.exec(body)) !== null) {
    const target = match[2];
    // Only track local file links (not http, not anchors)
    if (!target.startsWith('http') && !target.startsWith('#') && !target.startsWith('mailto:')) {
      links.push(target);
    }
  }
  return links;
}

/**
 * Split a markdown file into sections based on H2 headers.
 * Returns sections where each section has its own title and body.
 * If the file has no H2 headers, returns the whole file as one section.
 */
function splitSections(content: string): { title: string; body: string }[] {
  const lines = content.split('\n');
  const sections: { title: string; body: string; startLine: number }[] = [];
  let currentTitle = '';
  let currentBody: string[] = [];
  let hasH2 = false;

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      hasH2 = true;
      // Save previous section if it has content
      if (currentBody.length > 0 || currentTitle) {
        sections.push({
          title: currentTitle,
          body: currentBody.join('\n').trim(),
          startLine: 0,
        });
      }
      currentTitle = h2Match[1].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  // Save last section
  if (currentBody.length > 0 || currentTitle) {
    sections.push({
      title: currentTitle,
      body: currentBody.join('\n').trim(),
      startLine: 0,
    });
  }

  // If no H2 headers found, return whole content as one section
  if (!hasH2) {
    return [{ title: '', body: content.trim() }];
  }

  // Filter out empty sections
  return sections.filter(s => s.body.length > 0);
}

/**
 * Extract project slug from a path inside the projects directory.
 * e.g., "C:\Users\Fran\.claude\projects\C--Fran-RRDestructible\memory\file.md"
 *     → "C--Fran-RRDestructible"
 */
function extractProjectSlug(filePath: string): string | null {
  const config = getClaudeConfig();
  const rel = relative(config.projectsDir, filePath);
  if (rel.startsWith('..')) return null;
  const parts = rel.split(/[/\\]/);
  return parts[0] || null;
}

/**
 * Parse a single markdown file into atoms.
 */
export function parseFile(filePath: string, sourceType: SourceType): ParsedFile {
  const raw = readFileSync(filePath, 'utf-8');
  const { data: frontmatterData, content } = matter(raw);
  const filename = basename(filePath);
  const project = sourceType === 'memory_file' ? extractProjectSlug(filePath) : null;

  const hasFrontmatter = Object.keys(frontmatterData).length > 0;

  // Plans, agents, and skills are self-contained — never split into sections.
  // Only memory files are split by H2 headers into individual atoms.
  const sections = sourceType === 'memory_file'
    ? splitSections(content)
    : [{ title: '', body: content.trim() }];

  const atoms: ParsedFile['atoms'] = [];
  const links: ParsedFile['links'] = [];
  const diagnostics: ParsedFile['diagnostics'] = [];

  // Check for missing frontmatter on memory files
  if (sourceType === 'memory_file' && !hasFrontmatter && filename !== 'MEMORY.md') {
    diagnostics.push({
      type: 'missing_frontmatter',
      message: `Memory file lacks YAML frontmatter: ${filename}`,
      details: filePath,
    });
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    // Determine title
    let title = section.title;
    if (!title && frontmatterData.name) title = String(frontmatterData.name);
    if (!title && frontmatterData.title) title = String(frontmatterData.title);
    if (!title) {
      // Try to extract from first H1
      const h1Match = section.body.match(/^#\s+(.+)$/m);
      if (h1Match) title = h1Match[1].trim();
    }
    if (!title) title = filename.replace(/\.md$/, '');

    // For multi-section files, prefix with filename context
    if (sections.length > 1 && i > 0) {
      title = `${filename.replace(/\.md$/, '')}: ${title}`;
    }

    const atomType = inferAtomType(
      (frontmatterData.atom_type as string) ?? (frontmatterData.type as string),
      sourceType,
      filename
    );
    const scope = inferScope(atomType, sourceType);
    const tags = extractTags(section.body, i === 0 ? frontmatterData : undefined);

    // Extract task-specific fields from frontmatter (only for first section)
    let taskStatus: string | null = null;
    let taskPriority: number | null = null;
    let taskBlocks: string | null = null;
    let taskBlockedBy: string | null = null;
    let taskDiscoveredFrom: string | null = null;

    if (atomType === 'task' && i === 0 && hasFrontmatter) {
      taskStatus = typeof frontmatterData.status === 'string' ? frontmatterData.status : 'ready';
      taskPriority = typeof frontmatterData.priority === 'number' ? frontmatterData.priority : 2;
      taskBlocks = JSON.stringify(Array.isArray(frontmatterData.blocks) ? frontmatterData.blocks : []);
      taskBlockedBy = JSON.stringify(Array.isArray(frontmatterData.blocked_by) ? frontmatterData.blocked_by : []);
      taskDiscoveredFrom = typeof frontmatterData.discovered_from === 'string' ? frontmatterData.discovered_from : '';
    }

    atoms.push({
      title,
      body: section.body,
      atom_type: atomType,
      scope,
      source_path: filePath,
      source_type: sourceType,
      project,
      tags,
      // First section hash covers the full raw file so frontmatter changes
      // (status, priority, blocked_by, etc.) are detected by the unchanged check.
      // Subsequent sections in multi-section files hash their own body.
      content_hash: i === 0 ? computeHash(raw) : computeHash(section.body),
      frontmatter: i === 0 && hasFrontmatter ? frontmatterData : null,
      status: taskStatus as any,
      priority: taskPriority,
      blocks: taskBlocks,
      blocked_by: taskBlockedBy,
      discovered_from: taskDiscoveredFrom,
    });

    // Extract links from this section
    const sectionLinks = extractLinks(section.body);
    const sourceDir = dirname(filePath);
    for (const linkTarget of sectionLinks) {
      const resolvedTarget = resolve(sourceDir, linkTarget);
      links.push({
        source_section: i,
        target_path: resolvedTarget,
        link_type: 'references',
      });

      // Check for broken references
      if (!existsSync(resolvedTarget)) {
        diagnostics.push({
          type: 'broken_reference',
          message: `Broken link to "${linkTarget}" in ${filename}`,
          details: `Source: ${filePath}\nTarget: ${resolvedTarget}`,
        });
      }
    }
  }

  return { atoms, links, diagnostics };
}
