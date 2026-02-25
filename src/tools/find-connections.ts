/**
 * `find_connections` tool — find how two subsystems/domains connect via call relationships.
 *
 * Ported from codegraph-graphrag prototype. Iterates domainIndex to find members
 * of each domain, then scans callAdj for cross-domain call edges.
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

export const tool: Tool = {
  name: 'find_connections',
  description:
    'Find how two subsystems/domains connect. Returns the functions that bridge them via call relationships.',
  inputSchema: {
    type: 'object',
    properties: {
      domain_a: {
        type: 'string',
        description: 'First domain or subdomain name.',
      },
      domain_b: {
        type: 'string',
        description: 'Second domain or subdomain name.',
      },
      directory: {
        type: 'string',
        description: 'Repository path (optional, uses default if omitted).',
      },
    },
    required: ['domain_a', 'domain_b'],
  },
  annotations: {
    readOnlyHint: true,
  },
};

/**
 * Collect all Function node IDs that belong to a domain/subdomain (fuzzy name match).
 */
function collectDomainMembers(
  graph: IndexedGraph,
  query: string
): Set<string> {
  const lower = query.toLowerCase();
  const members = new Set<string>();

  for (const [name, data] of graph.domainIndex) {
    if (!name.toLowerCase().includes(lower)) continue;
    for (const id of data.memberIds) {
      const node = graph.nodeById.get(id);
      if (node?.labels?.[0] === 'Function') {
        members.add(id);
      }
    }
  }

  return members;
}

export const handler: HandlerFunction = async (client, args, defaultWorkdir) => {
  const domainA = typeof args?.domain_a === 'string' ? args.domain_a.trim() : '';
  const domainB = typeof args?.domain_b === 'string' ? args.domain_b.trim() : '';

  if (!domainA || !domainB) {
    return asErrorResult({
      type: 'validation_error',
      message: 'Missing required "domain_a" and/or "domain_b" parameters.',
      code: 'MISSING_DOMAIN',
      recoverable: false,
      suggestion: 'Provide two domain or subdomain names to find connections between.',
    });
  }

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

  let graph: IndexedGraph;
  try {
    graph = await resolveOrFetchGraph(client, directory);
  } catch (error: any) {
    return asErrorResult(classifyApiError(error));
  }

  const aNodes = collectDomainMembers(graph, domainA);
  const bNodes = collectDomainMembers(graph, domainB);

  if (aNodes.size === 0) {
    return asTextContentResult(`No functions found in domain/subdomain matching "${domainA}".`);
  }
  if (bNodes.size === 0) {
    return asTextContentResult(`No functions found in domain/subdomain matching "${domainB}".`);
  }

  // Find call edges between domain A and domain B in both directions
  const bridges: string[] = [];

  for (const aId of aNodes) {
    const adj = graph.callAdj.get(aId);
    if (!adj) continue;

    // A calls B (downstream)
    for (const targetId of adj.out) {
      if (!bNodes.has(targetId)) continue;
      const srcNode = graph.nodeById.get(aId);
      const tgtNode = graph.nodeById.get(targetId);
      const srcName = srcNode?.properties?.name as string || '(unknown)';
      const tgtName = tgtNode?.properties?.name as string || '(unknown)';
      const srcFile = normalizePath(srcNode?.properties?.filePath as string || '');
      const tgtFile = normalizePath(tgtNode?.properties?.filePath as string || '');
      bridges.push(
        `\`${srcName}\` (${domainA}) calls \`${tgtName}\` (${domainB}) — ${srcFile} → ${tgtFile}`
      );
    }
  }

  for (const bId of bNodes) {
    const adj = graph.callAdj.get(bId);
    if (!adj) continue;

    // B calls A (reverse direction)
    for (const targetId of adj.out) {
      if (!aNodes.has(targetId)) continue;
      const srcNode = graph.nodeById.get(bId);
      const tgtNode = graph.nodeById.get(targetId);
      const srcName = srcNode?.properties?.name as string || '(unknown)';
      const tgtName = tgtNode?.properties?.name as string || '(unknown)';
      const srcFile = normalizePath(srcNode?.properties?.filePath as string || '');
      const tgtFile = normalizePath(tgtNode?.properties?.filePath as string || '');
      bridges.push(
        `\`${srcName}\` (${domainB}) calls \`${tgtName}\` (${domainA}) — ${srcFile} → ${tgtFile}`
      );
    }
  }

  if (bridges.length === 0) {
    return asTextContentResult(
      `No direct call connections found between "${domainA}" and "${domainB}".`
    );
  }

  return asTextContentResult(
    `Connections between ${domainA} and ${domainB}:\n\n${bridges.join('\n')}`
  );
};

export default { tool, handler } as Endpoint;
