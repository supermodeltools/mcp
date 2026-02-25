/**
 * `explore_function` tool — BFS call-graph traversal with domain annotations.
 *
 * Ported from codegraph-graphrag prototype. Key differences from `symbol_context`:
 *  - Up to 3-hop BFS (vs 1-hop flat list)
 *  - Every neighbor shows subdomain + domain
 *  - ← DIFFERENT SUBSYSTEM marker for cross-boundary calls
 *  - Hierarchical output with "Via" sections for multi-hop paths
 *  - No source code (agent uses Read for that)
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
import { CodeGraphNode } from '../cache/graph-types';
import { classifyApiError } from '../utils/api-helpers';
import { findSymbol } from './symbol-context';
import { MAX_SOURCE_LINES } from '../constants';

export const tool: Tool = {
  name: 'explore_function',
  description:
    "Explore a function or class call-graph neighborhood. Returns source code, callers (upstream), callees (downstream), with subsystem/domain annotations and ← DIFFERENT SUBSYSTEM markers for cross-boundary calls. Accepts partial matching and ClassName.method syntax.",
  inputSchema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Function name to explore. Supports partial matching and "ClassName.method" syntax.',
      },
      direction: {
        type: 'string',
        enum: ['downstream', 'upstream', 'both'],
        description: 'Which direction to explore: downstream (callees), upstream (callers), or both. Default: both.',
      },
      depth: {
        type: 'number',
        minimum: 1,
        maximum: 3,
        description: 'How many hops to follow (1-3). Default: 2.',
      },
      directory: {
        type: 'string',
        description: 'Repository path (optional, uses default if omitted).',
      },
    },
    required: ['symbol'],
  },
  annotations: {
    readOnlyHint: true,
  },
};

// ── Domain resolution ──

interface DomainInfo {
  subdomain: string | null;
  domain: string | null;
}

/**
 * Build a map from Subdomain name → parent Domain name by scanning partOf relationships.
 * Computed once per call (fast — only scans Domain/Subdomain nodes).
 */
function buildSubdomainToParentMap(graph: IndexedGraph): Map<string, string> {
  const map = new Map<string, string>();
  const relationships = graph.raw.graph?.relationships || [];

  for (const rel of relationships) {
    if (rel.type !== 'partOf') continue;
    const startNode = graph.nodeById.get(rel.startNode);
    const endNode = graph.nodeById.get(rel.endNode);
    if (
      startNode?.labels?.[0] === 'Subdomain' &&
      endNode?.labels?.[0] === 'Domain'
    ) {
      const subName = startNode.properties?.name as string;
      const domName = endNode.properties?.name as string;
      if (subName && domName) {
        map.set(subName, domName);
      }
    }
  }

  return map;
}

/**
 * Resolve subdomain + domain for a node using domainIndex and the partOf map.
 */
function resolveDomain(
  graph: IndexedGraph,
  nodeId: string,
  subdomainToParent: Map<string, string>
): DomainInfo {
  let subdomain: string | null = null;
  let domain: string | null = null;

  for (const [name, data] of graph.domainIndex) {
    if (!data.memberIds.includes(nodeId)) continue;

    const domainNode = graph.nodeById.get(
      // Find the node for this domain entry to check its label
      [...graph.nameIndex.get(name.toLowerCase()) || []].find(id => {
        const n = graph.nodeById.get(id);
        return n?.labels?.[0] === 'Subdomain' || n?.labels?.[0] === 'Domain';
      }) || ''
    );

    if (domainNode?.labels?.[0] === 'Subdomain') {
      subdomain = name;
      // Look up parent domain via partOf map
      const parent = subdomainToParent.get(name);
      if (parent) domain = parent;
    } else if (domainNode?.labels?.[0] === 'Domain') {
      domain = name;
    }

    // If we found a subdomain, that's the most specific — prefer it
    if (subdomain) break;
  }

  // If we only found a domain directly (no subdomain), that's fine
  return { subdomain, domain };
}

// ── Node description ──

function describeNode(
  graph: IndexedGraph,
  nodeId: string,
  refSubdomain: string | null,
  subdomainToParent: Map<string, string>
): string {
  const node = graph.nodeById.get(nodeId);
  if (!node) return '(unknown)';

  const name = node.properties?.name as string || '(unknown)';
  const filePath = normalizePath(node.properties?.filePath as string || '');
  const { subdomain, domain } = resolveDomain(graph, nodeId, subdomainToParent);

  let loc = '';
  if (subdomain && domain) loc = `${subdomain} subsystem, ${domain} domain`;
  else if (subdomain) loc = `${subdomain} subsystem`;
  else if (domain) loc = `${domain} domain`;

  let line = `\`${name}\``;
  if (filePath) line += ` — ${filePath}`;
  if (loc) line += ` — ${loc}`;

  // Flag cross-subsystem edges
  if (refSubdomain && subdomain && subdomain !== refSubdomain) {
    line += '  ← DIFFERENT SUBSYSTEM';
  }

  return line;
}

// ── Handler ──

export const handler: HandlerFunction = async (client, args, defaultWorkdir) => {
  const symbolArg = typeof args?.symbol === 'string' ? args.symbol.trim() : '';
  if (!symbolArg) {
    return asErrorResult({
      type: 'validation_error',
      message: 'Missing required "symbol" parameter.',
      code: 'MISSING_SYMBOL',
      recoverable: false,
      suggestion: 'Provide the name of a function to explore.',
    });
  }

  const direction = (args?.direction as string) || 'both';
  const depth = Math.min(3, Math.max(1, Number(args?.depth) || 2));
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

  // Resolve symbol name to a Function or Class node
  const matches = findSymbol(graph, symbolArg);
  const funcMatch = matches.find(n => n.labels?.[0] === 'Function' || n.labels?.[0] === 'Class');
  if (!funcMatch) {
    return asErrorResult({
      type: 'not_found_error',
      message: `No function or class matching "${symbolArg}" found in the code graph.`,
      code: 'SYMBOL_NOT_FOUND',
      recoverable: false,
      suggestion: 'Try a different function name or use partial matching.',
    });
  }

  const rootId = funcMatch.id;
  const subdomainToParent = buildSubdomainToParentMap(graph);
  const rootDomain = resolveDomain(graph, rootId, subdomainToParent);
  const rootSubName = rootDomain.subdomain;

  const lines: string[] = [];
  lines.push(`## ${describeNode(graph, rootId, null, subdomainToParent)}`);
  lines.push('');

  // Include source code for the root symbol (saves agent a Read round-trip)
  const rootSource = funcMatch.properties?.sourceCode as string | undefined;
  if (rootSource) {
    const sourceLines = rootSource.split('\n');
    const truncated = sourceLines.length > MAX_SOURCE_LINES;
    const displayLines = truncated ? sourceLines.slice(0, MAX_SOURCE_LINES) : sourceLines;
    const startLine = funcMatch.properties?.startLine as number | undefined;
    const filePath = normalizePath(funcMatch.properties?.filePath as string || '');
    const ext = filePath.split('.').pop() || '';
    lines.push(`### Source`);
    lines.push('```' + ext);
    if (startLine) {
      displayLines.forEach((l, i) => lines.push(`${startLine + i}: ${l}`));
    } else {
      displayLines.forEach(l => lines.push(l));
    }
    if (truncated) lines.push(`... (${sourceLines.length - MAX_SOURCE_LINES} more lines)`);
    lines.push('```');
    lines.push('');
  }

  // Downstream BFS (callees)
  if (direction === 'downstream' || direction === 'both') {
    lines.push('### Functions it calls:');
    let frontier = [rootId];
    const visited = new Set([rootId]);

    for (let d = 1; d <= depth; d++) {
      const nextFrontier: string[] = [];

      if (d === 1) {
        const callees = (graph.callAdj.get(rootId)?.out || [])
          .filter(id => { const l = graph.nodeById.get(id)?.labels?.[0]; return l === 'Function' || l === 'Class'; });

        if (callees.length === 0) {
          lines.push('  (none)');
        }
        for (const cId of callees) {
          visited.add(cId);
          nextFrontier.push(cId);
          lines.push(`  ${d}. ${describeNode(graph, cId, rootSubName, subdomainToParent)}`);
        }
      } else {
        let anyFound = false;
        for (const parentId of frontier) {
          const parentNode = graph.nodeById.get(parentId);
          const parentName = parentNode?.properties?.name as string || '(unknown)';
          const callees = (graph.callAdj.get(parentId)?.out || [])
            .filter(id => { const l = graph.nodeById.get(id)?.labels?.[0]; return l === 'Function' || l === 'Class'; })
            .filter(id => !visited.has(id));

          if (callees.length === 0) continue;
          anyFound = true;
          lines.push(`  Via \`${parentName}\`:`);
          for (const cId of callees) {
            visited.add(cId);
            nextFrontier.push(cId);
            lines.push(`    → ${describeNode(graph, cId, rootSubName, subdomainToParent)}`);
          }
        }
        if (!anyFound && d === 2) {
          lines.push('  (no further calls at depth 2)');
        }
      }
      frontier = nextFrontier;
    }
    lines.push('');
  }

  // Upstream BFS (callers)
  if (direction === 'upstream' || direction === 'both') {
    lines.push('### Functions that call it:');
    let frontier = [rootId];
    const visited = new Set([rootId]);

    for (let d = 1; d <= depth; d++) {
      const nextFrontier: string[] = [];

      if (d === 1) {
        const callers = (graph.callAdj.get(rootId)?.in || [])
          .filter(id => { const l = graph.nodeById.get(id)?.labels?.[0]; return l === 'Function' || l === 'Class'; });

        if (callers.length === 0) {
          lines.push('  (none)');
        }
        for (const cId of callers) {
          visited.add(cId);
          nextFrontier.push(cId);
          lines.push(`  ${d}. ${describeNode(graph, cId, rootSubName, subdomainToParent)}`);
        }
      } else {
        for (const parentId of frontier) {
          const parentNode = graph.nodeById.get(parentId);
          const parentName = parentNode?.properties?.name as string || '(unknown)';
          const callers = (graph.callAdj.get(parentId)?.in || [])
            .filter(id => { const l = graph.nodeById.get(id)?.labels?.[0]; return l === 'Function' || l === 'Class'; })
            .filter(id => !visited.has(id));

          if (callers.length === 0) continue;
          lines.push(`  Via \`${parentName}\`:`);
          for (const cId of callers) {
            visited.add(cId);
            nextFrontier.push(cId);
            lines.push(`    → ${describeNode(graph, cId, rootSubName, subdomainToParent)}`);
          }
        }
      }
      frontier = nextFrontier;
    }
    lines.push('');
  }

  return asTextContentResult(lines.join('\n'));
};

export default { tool, handler } as Endpoint;
