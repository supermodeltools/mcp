/**
 * `overview` tool -- instant architectural map of a codebase.
 *
 * Returns a concise (<3KB) markdown summary with:
 *  - Top domains and their key files
 *  - Hub functions (highest in-degree in call graph)
 *  - File/function/class counts
 *
 * Backed by pre-computed graphs (sub-second) with on-demand API fallback.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  Endpoint,
  HandlerFunction,
  asTextContentResult,
  asErrorResult,
} from '../types';
import {
  IndexedGraph,
  resolveOrFetchGraph,
  normalizePath,
} from '../cache/graph-cache';
import { classifyApiError } from '../utils/api-helpers';
import {
  MAX_OVERVIEW_DOMAINS,
  MAX_OVERVIEW_HUB_FUNCTIONS,
} from '../constants';

export const tool: Tool = {
  name: 'overview',
  description:
    `CALL THIS FIRST before grep or find. Returns a pre-computed architectural map of the entire codebase in sub-second time at zero cost. Gives you what grep/find cannot: which domains own which files, the most-called hub functions (call graph centrality), and how the codebase is structured across domains. Output is a concise summary with top architectural domains and their key files, highest-traffic functions, and file/function/class counts. Use this to know exactly where to look instead of guessing with grep.`,
  inputSchema: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description:
          'Path to the repository directory. Omit if the MCP server was started with a default workdir.',
      },
    },
    required: [],
  },
};

export const handler: HandlerFunction = async (client, args, defaultWorkdir) => {
  const rawDir = args?.directory as string | undefined;
  const directory = (rawDir && rawDir.trim()) || defaultWorkdir || process.cwd();

  if (!directory || typeof directory !== 'string') {
    return asErrorResult({
      type: 'validation_error',
      message: 'No directory provided and no default workdir configured.',
      code: 'MISSING_DIRECTORY',
      recoverable: false,
      suggestion: 'Provide a directory parameter or start the MCP server with a workdir argument.',
    });
  }

  try {
    const graph = await resolveOrFetchGraph(client, directory);
    return asTextContentResult(renderOverview(graph));
  } catch (error: any) {
    return asErrorResult(classifyApiError(error));
  }
};

// ── Rendering ──

function renderOverview(graph: IndexedGraph): string {
  const s = graph.summary;
  const lines: string[] = [];

  // Header
  const repoName = graph.raw.repo ? `Repository ${graph.raw.repo.substring(0, 8)}` : 'Codebase';
  lines.push(
    `# ${repoName} (${s.filesProcessed} files, ${s.functions} functions, ${s.classes} classes)`
  );
  lines.push(`**Language:** ${s.primaryLanguage} | **Nodes:** ${s.nodeCount} | **Relationships:** ${s.relationshipCount}`);
  lines.push('');

  // Domains
  if (graph.domainIndex.size > 0) {
    lines.push('## Architecture Domains');
    lines.push('');

    // Sort domains by member count (descending)
    const domains = [...graph.domainIndex.entries()]
      .map(([name, data]) => ({ name, memberCount: data.memberIds.length, memberIds: data.memberIds }))
      .sort((a, b) => b.memberCount - a.memberCount)
      .slice(0, MAX_OVERVIEW_DOMAINS);

    for (const domain of domains) {
      // Get key files for this domain
      const keyFiles = getKeyFilesForDomain(graph, domain.memberIds);
      const filesStr = keyFiles.length > 0
        ? `\n  Key files: ${keyFiles.join(', ')}`
        : '';

      // Get the domain node description
      const domainNodes = graph.nameIndex.get(domain.name.toLowerCase()) || [];
      let desc = '';
      for (const nid of domainNodes) {
        const node = graph.nodeById.get(nid);
        if (node?.labels?.[0] === 'Domain') {
          desc = (node.properties?.description as string) || '';
          break;
        }
      }
      const descStr = desc ? `: ${truncate(desc, 80)}` : '';

      lines.push(`- **${domain.name}** (${domain.memberCount} members)${descStr}${filesStr}`);
    }
    lines.push('');
  }

  // Hub functions (most called)
  const hubs = getHubFunctions(graph, MAX_OVERVIEW_HUB_FUNCTIONS);
  if (hubs.length > 0) {
    lines.push('## Most-Called Functions');
    lines.push('');
    for (const hub of hubs) {
      lines.push(`- \`${hub.name}\` (${hub.callerCount} callers) — ${hub.filePath}:${hub.line}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function getKeyFilesForDomain(graph: IndexedGraph, memberIds: string[]): string[] {
  // Return top 3 most common file paths
  const pathCounts = new Map<string, number>();
  for (const id of memberIds) {
    const node = graph.nodeById.get(id);
    if (!node) continue;
    const fp = node.properties?.filePath as string;
    if (fp) {
      const normalized = normalizePath(fp);
      pathCounts.set(normalized, (pathCounts.get(normalized) || 0) + 1);
    }
  }

  return [...pathCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([p]) => p);
}

function getHubFunctions(graph: IndexedGraph, limit: number): { name: string; filePath: string; line: number; callerCount: number }[] {
  const hubs: { name: string; filePath: string; line: number; callerCount: number }[] = [];

  for (const [nodeId, adj] of graph.callAdj) {
    if (adj.in.length < 3) continue;

    const node = graph.nodeById.get(nodeId);
    if (!node) continue;

    const name = node.properties?.name as string;
    const filePath = node.properties?.filePath as string;
    const line = node.properties?.startLine as number;
    if (!name || !filePath) continue;

    hubs.push({ name, filePath: normalizePath(filePath), line: line || 0, callerCount: adj.in.length });
  }

  hubs.sort((a, b) => b.callerCount - a.callerCount);
  return hubs.slice(0, limit);
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen - 3) + '...';
}

export default { tool, handler } as Endpoint;
