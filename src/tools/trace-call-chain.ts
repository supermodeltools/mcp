/**
 * Task-specific tool: Trace call chain between two functions
 * Find shortest path showing how control flows from one function to another
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { graphCache } from '../cache';
import { CodeGraphNode } from '../cache/graph-types';

const TraceCallChainArgsSchema = z.object({
  path: z.string().describe('Repository path'),
  from_function: z.string().describe('Starting function name'),
  to_function: z.string().describe('Target function name'),
  max_depth: z.number().optional().describe('Maximum call chain depth to search'),
});

type TraceCallChainArgs = z.infer<typeof TraceCallChainArgsSchema>;

export interface CallChainStep {
  function_name: string;
  file: string;
  line: number;
  call_to_next?: {
    line: number;
    column?: number;
  };
}

export interface TraceCallChainResponse {
  from_function: string;
  to_function: string;
  path_exists: boolean;
  call_chain: CallChainStep[];
  summary: string;
  chain_length?: number;
}

/**
 * Trace call chain from one function to another using BFS
 */
export async function traceCallChain(args: TraceCallChainArgs): Promise<TraceCallChainResponse> {
  const { path, from_function, to_function, max_depth = 10 } = args;

  // Get cached graph
  const cacheKey = getCacheKey(path);
  const graph = graphCache.get(cacheKey);

  if (!graph) {
    throw new Error(
      'Graph not cached. Run explore_codebase first to analyze the repository.'
    );
  }

  // Find source function
  const fromNodes = findFunctionsByName(graph, from_function);
  if (fromNodes.length === 0) {
    return {
      from_function,
      to_function,
      path_exists: false,
      call_chain: [],
      summary: `Source function "${from_function}" not found in codebase.`,
    };
  }

  // Find target function
  const toNodes = findFunctionsByName(graph, to_function);
  if (toNodes.length === 0) {
    return {
      from_function,
      to_function,
      path_exists: false,
      call_chain: [],
      summary: `Target function "${to_function}" not found in codebase.`,
    };
  }

  // Use first match if multiple functions with same name
  const fromNode = fromNodes[0];
  const toNode = toNodes[0];

  // BFS to find shortest path
  const path_result = findShortestCallPath(graph, fromNode.id, toNode.id, max_depth);

  if (!path_result) {
    return {
      from_function,
      to_function,
      path_exists: false,
      call_chain: [],
      summary: `No call chain found from "${from_function}" to "${to_function}" within depth ${max_depth}.`,
    };
  }

  // Build call chain steps
  const callChain: CallChainStep[] = [];
  for (let i = 0; i < path_result.length; i++) {
    const nodeId = path_result[i];
    const node = graph.nodeById.get(nodeId);
    if (!node) continue;

    const step: CallChainStep = {
      function_name: node.properties?.name as string || 'unknown',
      file: node.properties?.filePath as string || 'unknown',
      line: node.properties?.startLine as number || 0,
    };

    // Add call site info if there's a next function
    if (i < path_result.length - 1) {
      const nextNodeId = path_result[i + 1];
      const edge = findCallEdge(graph, nodeId, nextNodeId);
      if (edge) {
        step.call_to_next = {
          line: edge.properties?.lineNumber as number || 0,
          column: edge.properties?.columnNumber as number,
        };
      }
    }

    callChain.push(step);
  }

  // Generate summary
  const summary = generateSummary(from_function, to_function, callChain);

  return {
    from_function,
    to_function,
    path_exists: true,
    call_chain: callChain,
    summary,
    chain_length: callChain.length,
  };
}

/**
 * BFS to find shortest path between two functions
 */
function findShortestCallPath(
  graph: any,
  fromId: string,
  toId: string,
  maxDepth: number
): string[] | null {
  if (fromId === toId) {
    return [fromId];
  }

  const queue: { id: string; path: string[] }[] = [{ id: fromId, path: [fromId] }];
  const visited = new Set<string>([fromId]);

  while (queue.length > 0) {
    const { id, path } = queue.shift()!;

    // Check depth limit
    if (path.length > maxDepth) {
      continue;
    }

    // Get callees
    const adj = graph.callAdj.get(id);
    if (!adj) continue;

    for (const calleeId of adj.out) {
      if (calleeId === toId) {
        // Found target
        return [...path, calleeId];
      }

      if (!visited.has(calleeId)) {
        visited.add(calleeId);
        queue.push({ id: calleeId, path: [...path, calleeId] });
      }
    }
  }

  return null;
}

/**
 * Helper: Find function nodes by name
 */
function findFunctionsByName(graph: any, name: string): CodeGraphNode[] {
  const lowerName = name.toLowerCase();
  const nodeIds = graph.nameIndex.get(lowerName) || [];

  return nodeIds
    .map((id: string) => graph.nodeById.get(id))
    .filter((node: CodeGraphNode) => node && node.labels?.[0] === 'Function');
}

/**
 * Helper: Find specific call edge between two functions
 */
function findCallEdge(graph: any, fromId: string, toId: string): any {
  const relationships = graph.raw?.graph?.relationships || [];
  return relationships.find(
    (rel: any) => rel.type === 'calls' && rel.startNode === fromId && rel.endNode === toId
  );
}

/**
 * Helper: Generate natural language summary
 */
function generateSummary(fromName: string, toName: string, chain: CallChainStep[]): string {
  if (chain.length === 0) {
    return `No call chain found from "${fromName}" to "${toName}".`;
  }

  if (chain.length === 2) {
    return `"${fromName}" directly calls "${toName}".`;
  }

  const pathNames = chain.map(step => step.function_name);
  const arrow = ' → ';
  const pathStr = pathNames.join(arrow);

  return `Call chain (${chain.length} steps): ${pathStr}`;
}

/**
 * Helper: Generate cache key
 */
function getCacheKey(path: string): string {
  return `cache_${path}`;
}

/**
 * Tool metadata for MCP registration
 */
export const traceCallChainTool = {
  name: 'trace_call_chain',
  description: 'Trace the call chain from one function to another, showing the shortest path of function calls',
  inputSchema: zodToJsonSchema(TraceCallChainArgsSchema),
  handler: traceCallChain,
};
