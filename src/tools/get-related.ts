/**
 * `get_related` tool -- connecting subgraph between known symbols.
 *
 * Given 2-5 symbol names or file paths, BFS-traverses the call and import
 * graphs to find shortest connecting paths. Returns the subgraph as markdown
 * with source snippets for bridge nodes.
 *
 * Replaces the "symbol chasing" anti-pattern where agents make 5-7 sequential
 * symbol_context calls to manually trace a call chain.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
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
import { findSymbol, languageFromExtension } from './symbol-context';
import {
  MAX_RELATED_TARGETS,
  MAX_RELATED_DEPTH,
  DEFAULT_RELATED_DEPTH,
  MAX_BRIDGE_SOURCE_LINES,
} from '../constants';

export const tool: Tool = {
  name: 'get_related',
  description:
    `Given 2-5 symbol names or file paths, returns the connecting call-graph paths between them in a single response. Replaces sequential symbol_context chains — instead of tracing A→B→C→D one call at a time, call get_related({targets: ["A", "D"]}) to get the full path instantly. Sub-second, zero cost. Use this when you know the start and end points (from a stack trace, error message, or issue description) and need to understand how they connect.`,
  inputSchema: {
    type: 'object',
    properties: {
      targets: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: MAX_RELATED_TARGETS,
        description:
          'Symbol names (e.g. "QuerySet.filter") or file paths (e.g. "django/db/models/query.py") to connect. 2-5 targets.',
      },
      max_depth: {
        type: 'number',
        description:
          `Maximum BFS depth for path finding (default ${DEFAULT_RELATED_DEPTH}, max ${MAX_RELATED_DEPTH}). Increase if targets are far apart in the call graph.`,
      },
      directory: {
        type: 'string',
        description:
          'Path to the repository directory. Omit if the MCP server was started with a default workdir.',
      },
    },
    required: ['targets'],
  },
};

export const handler: HandlerFunction = async (client, args, defaultWorkdir) => {
  const targets = args?.targets as string[] | undefined;
  const rawDir = args?.directory as string | undefined;
  const directory = (rawDir && rawDir.trim()) || defaultWorkdir || process.cwd();
  const maxDepth = Math.min(
    Math.max(1, Number(args?.max_depth) || DEFAULT_RELATED_DEPTH),
    MAX_RELATED_DEPTH,
  );

  if (!targets || !Array.isArray(targets) || targets.length < 2) {
    return asErrorResult({
      type: 'validation_error',
      message: 'Provide at least 2 targets (symbol names or file paths).',
      code: 'INVALID_TARGETS',
      recoverable: false,
      suggestion: 'Example: get_related({targets: ["QuerySet.filter", "SQLCompiler.compile"]})',
    });
  }

  if (targets.length > MAX_RELATED_TARGETS) {
    return asErrorResult({
      type: 'validation_error',
      message: `Too many targets (max ${MAX_RELATED_TARGETS}).`,
      code: 'TOO_MANY_TARGETS',
      recoverable: false,
      suggestion: `Provide at most ${MAX_RELATED_TARGETS} targets.`,
    });
  }

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

  // Resolve each target to node IDs
  const resolvedTargets: Array<{ query: string; nodes: CodeGraphNode[] }> = [];
  const unresolvedTargets: string[] = [];

  for (const target of targets) {
    const trimmed = target.trim();
    if (!trimmed) continue;

    const nodes = resolveTarget(graph, trimmed);
    if (nodes.length > 0) {
      resolvedTargets.push({ query: trimmed, nodes });
    } else {
      unresolvedTargets.push(trimmed);
    }
  }

  if (resolvedTargets.length < 2) {
    const resolvedNames = resolvedTargets.map(t => t.query);
    return asTextContentResult(
      `Could not resolve enough targets to find connections.\n\n` +
      (resolvedNames.length > 0 ? `Resolved: ${resolvedNames.join(', ')}\n` : '') +
      `Unresolved: ${unresolvedTargets.join(', ')}\n\n` +
      `Try different symbol names or use \`symbol_context\` to verify they exist.`
    );
  }

  // Find paths between all pairs of resolved targets
  const allPaths: PathResult[] = [];
  for (let i = 0; i < resolvedTargets.length; i++) {
    for (let j = i + 1; j < resolvedTargets.length; j++) {
      const pathResult = findShortestPath(
        graph,
        resolvedTargets[i].nodes,
        resolvedTargets[j].nodes,
        maxDepth,
      );
      if (pathResult) {
        allPaths.push({
          from: resolvedTargets[i].query,
          to: resolvedTargets[j].query,
          path: pathResult,
        });
      }
    }
  }

  // Render output
  const rendered = await renderRelated(
    graph,
    resolvedTargets,
    allPaths,
    unresolvedTargets,
    directory,
  );

  return asTextContentResult(rendered);
};

// ── Target resolution ──

function resolveTarget(graph: IndexedGraph, target: string): CodeGraphNode[] {
  // Try as file path first
  const normalized = normalizePath(target);
  const pathEntry = graph.pathIndex.get(normalized);
  if (pathEntry) {
    const fileNodes: CodeGraphNode[] = [];
    for (const id of [...pathEntry.functionIds, ...pathEntry.classIds, ...pathEntry.typeIds]) {
      const node = graph.nodeById.get(id);
      if (node) fileNodes.push(node);
    }
    if (fileNodes.length > 0) return fileNodes;
  }

  // Try as symbol name
  return findSymbol(graph, target).slice(0, 3);
}

// ── BFS path finding ──

interface PathResult {
  from: string;
  to: string;
  path: CodeGraphNode[];
}

/**
 * BFS from all source nodes to find the shortest path to any target node.
 * Traverses both callAdj (out + in) and importAdj (out + in) edges.
 */
export function findShortestPath(
  graph: IndexedGraph,
  sourceNodes: CodeGraphNode[],
  targetNodes: CodeGraphNode[],
  maxDepth: number,
): CodeGraphNode[] | null {
  const targetIds = new Set(targetNodes.map(n => n.id));
  const sourceIds = new Set(sourceNodes.map(n => n.id));

  // Check for direct overlap
  for (const sid of sourceIds) {
    if (targetIds.has(sid)) {
      return [graph.nodeById.get(sid)!];
    }
  }

  // BFS from source nodes
  const visited = new Map<string, string | null>(); // nodeId -> parent nodeId
  const queue: Array<{ id: string; depth: number }> = [];

  for (const node of sourceNodes) {
    visited.set(node.id, null);
    queue.push({ id: node.id, depth: 0 });
  }

  let head = 0;
  while (head < queue.length) {
    const { id, depth } = queue[head++];
    if (depth >= maxDepth) continue;

    const neighbors = getNeighbors(graph, id);
    for (const neighborId of neighbors) {
      if (visited.has(neighborId)) continue;
      visited.set(neighborId, id);

      if (targetIds.has(neighborId)) {
        // Reconstruct path
        return reconstructPath(graph, visited, neighborId);
      }

      queue.push({ id: neighborId, depth: depth + 1 });
    }
  }

  return null;
}

function getNeighbors(graph: IndexedGraph, nodeId: string): string[] {
  const neighbors: string[] = [];

  const callAdj = graph.callAdj.get(nodeId);
  if (callAdj) {
    neighbors.push(...callAdj.out, ...callAdj.in);
  }

  const importAdj = graph.importAdj.get(nodeId);
  if (importAdj) {
    neighbors.push(...importAdj.out, ...importAdj.in);
  }

  return neighbors;
}

function reconstructPath(
  graph: IndexedGraph,
  visited: Map<string, string | null>,
  endId: string,
): CodeGraphNode[] {
  const path: CodeGraphNode[] = [];
  let current: string | null = endId;

  while (current !== null) {
    const node = graph.nodeById.get(current);
    if (node) path.unshift(node);
    current = visited.get(current) ?? null;
  }

  return path;
}

// ── Rendering ──

async function renderRelated(
  graph: IndexedGraph,
  resolvedTargets: Array<{ query: string; nodes: CodeGraphNode[] }>,
  paths: PathResult[],
  unresolvedTargets: string[],
  directory: string,
): Promise<string> {
  const lines: string[] = [];

  // Header
  const targetNames = resolvedTargets.map(t => t.query);
  lines.push(`## Connections: ${targetNames.join(' ↔ ')}`);
  lines.push('');

  if (unresolvedTargets.length > 0) {
    lines.push(`*Unresolved targets: ${unresolvedTargets.join(', ')}*`);
    lines.push('');
  }

  // Resolved targets summary
  lines.push('### Resolved targets');
  lines.push('');
  for (const t of resolvedTargets) {
    const primary = t.nodes[0];
    const name = primary.properties?.name as string || t.query;
    const filePath = normalizePath(primary.properties?.filePath as string || '');
    const startLine = primary.properties?.startLine as number || 0;
    const kind = primary.labels?.[0]?.toLowerCase() || 'symbol';
    lines.push(`- **${name}** (${kind}) — ${filePath}${startLine ? ':' + startLine : ''}`);
  }
  lines.push('');

  if (paths.length === 0) {
    lines.push(`*No connecting paths found within the search depth. The symbols may be in unrelated parts of the codebase. Try increasing max_depth or using \`symbol_context\` on each target individually.*`);
    return lines.join('\n');
  }

  // Render each path
  const bridgeNodeIds = new Set<string>();

  for (const p of paths) {
    lines.push(`### Path: ${p.from} → ${p.to} (${p.path.length - 1} hops)`);
    lines.push('');

    for (let i = 0; i < p.path.length; i++) {
      const node = p.path[i];
      const name = node.properties?.name as string || '(unknown)';
      const filePath = normalizePath(node.properties?.filePath as string || '');
      const startLine = node.properties?.startLine as number || 0;
      const indent = '  '.repeat(i);
      const arrow = i === 0 ? '' : '→ ';

      // Determine relationship type
      let relType = '';
      if (i > 0) {
        const prev = p.path[i - 1];
        relType = getRelationType(graph, prev.id, node.id);
      }

      const relStr = relType ? ` (${relType})` : '';
      lines.push(`${indent}${arrow}\`${name}\` — ${filePath}${startLine ? ':' + startLine : ''}${relStr}`);

      // Track bridge nodes (not first or last)
      if (i > 0 && i < p.path.length - 1) {
        bridgeNodeIds.add(node.id);
      }
    }
    lines.push('');
  }

  // Render bridge node source snippets
  if (bridgeNodeIds.size > 0) {
    lines.push('### Bridge nodes');
    lines.push('');

    for (const nodeId of bridgeNodeIds) {
      const node = graph.nodeById.get(nodeId);
      if (!node) continue;

      const name = node.properties?.name as string || '(unknown)';
      const filePath = node.properties?.filePath as string || '';
      const startLine = node.properties?.startLine as number || 0;
      const endLine = node.properties?.endLine as number || 0;

      lines.push(`#### ${name}`);
      lines.push('');

      // Try to read source
      if (filePath && startLine > 0) {
        try {
          const absPath = path.resolve(directory, filePath);
          const content = await fs.readFile(absPath, 'utf-8');
          const fileLines = content.split('\n');
          const end = endLine > 0
            ? Math.min(endLine, startLine + MAX_BRIDGE_SOURCE_LINES - 1)
            : startLine + MAX_BRIDGE_SOURCE_LINES - 1;
          const sourceSlice = fileLines.slice(startLine - 1, end);
          if (sourceSlice.length > 0) {
            const lang = languageFromExtension(filePath);
            lines.push(`\`\`\`${lang}`);
            lines.push(sourceSlice.join('\n'));
            lines.push('```');
            if (endLine > 0 && endLine > startLine + MAX_BRIDGE_SOURCE_LINES - 1) {
              lines.push(`*... truncated (showing ${MAX_BRIDGE_SOURCE_LINES} of ${endLine - startLine + 1} lines)*`);
            }
            lines.push('');
          }
        } catch {
          // File unreadable — skip source
        }
      }
    }
  }

  return lines.join('\n');
}

function getRelationType(graph: IndexedGraph, fromId: string, toId: string): string {
  // Check call adjacency
  const callAdj = graph.callAdj.get(fromId);
  if (callAdj) {
    if (callAdj.out.includes(toId)) return 'calls';
    if (callAdj.in.includes(toId)) return 'called by';
  }

  // Check import adjacency
  const importAdj = graph.importAdj.get(fromId);
  if (importAdj) {
    if (importAdj.out.includes(toId)) return 'imports';
    if (importAdj.in.includes(toId)) return 'imported by';
  }

  return '';
}

export default { tool, handler } as Endpoint;
