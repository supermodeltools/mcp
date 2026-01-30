/**
 * Task-specific tool: Find call sites for a function
 * Lightweight, focused query without full graph overhead
 */

import { z } from 'zod';
import { graphCache } from '../cache';
import { CodeGraphNode } from '../cache/graph-types';

const FindCallSitesArgsSchema = z.object({
  path: z.string().describe('Repository path'),
  function_name: z.string().describe('Name of function to find call sites for'),
  include_context: z.boolean().optional().describe('Include surrounding code context'),
  max_results: z.number().optional().describe('Maximum number of results to return'),
});

type FindCallSitesArgs = z.infer<typeof FindCallSitesArgsSchema>;

export interface CallSiteResult {
  caller: {
    name: string;
    file: string;
    line: number;
  };
  call_site: {
    line: number;
    column?: number;
    context?: string;
    code_snippet?: string;
  };
}

export interface FindCallSitesResponse {
  function_name: string;
  total_call_sites: number;
  call_sites: CallSiteResult[];
  summary: string;
}

/**
 * Find all places where a function is called
 */
export async function findCallSites(args: FindCallSitesArgs): Promise<FindCallSitesResponse> {
  const { path, function_name, include_context = true, max_results = 10 } = args;

  // Get cached graph
  const cacheKey = getCacheKey(path);
  const graph = graphCache.get(cacheKey);

  if (!graph) {
    throw new Error(
      'Graph not cached. Run explore_codebase first to analyze the repository.'
    );
  }

  // Find function node by name (case-insensitive)
  const functionNodes = findFunctionsByName(graph, function_name);

  if (functionNodes.length === 0) {
    return {
      function_name,
      total_call_sites: 0,
      call_sites: [],
      summary: `Function "${function_name}" not found in codebase.`,
    };
  }

  // Use first match if multiple functions with same name
  const targetNode = functionNodes[0];
  const targetId = targetNode.id;

  // Get incoming call edges
  const callAdj = graph.callAdj.get(targetId);
  if (!callAdj || callAdj.in.length === 0) {
    return {
      function_name,
      total_call_sites: 0,
      call_sites: [],
      summary: `Function "${function_name}" is not called by any other functions.`,
    };
  }

  // Build call site results
  const callSites: CallSiteResult[] = [];

  for (const callerId of callAdj.in) {
    const callerNode = graph.nodeById.get(callerId);
    if (!callerNode) continue;

    // Find edge details (if available)
    const edge = findCallEdge(graph, callerId, targetId);

    const result: CallSiteResult = {
      caller: {
        name: callerNode.properties?.name as string || 'unknown',
        file: callerNode.properties?.filePath as string || 'unknown',
        line: callerNode.properties?.startLine as number || 0,
      },
      call_site: {
        line: edge?.properties?.lineNumber as number || 0,
        column: edge?.properties?.columnNumber as number,
        context: edge?.properties?.context as string,
        code_snippet: include_context ? edge?.properties?.codeSnippet as string : undefined,
      },
    };

    callSites.push(result);

    if (callSites.length >= max_results) {
      break;
    }
  }

  // Generate summary
  const summary = generateSummary(function_name, callSites, callAdj.in.length);

  return {
    function_name,
    total_call_sites: callAdj.in.length,
    call_sites: callSites,
    summary,
  };
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
  // In original cache, edges aren't indexed by ID
  // This is a limitation we'd fix in edge-aware cache
  // For now, search through raw relationships
  const relationships = graph.raw?.graph?.relationships || [];
  return relationships.find(
    (rel: any) => rel.type === 'calls' && rel.startNode === fromId && rel.endNode === toId
  );
}

/**
 * Helper: Generate natural language summary
 */
function generateSummary(functionName: string, callSites: CallSiteResult[], total: number): string {
  if (callSites.length === 0) {
    return `Function "${functionName}" is not called by any functions.`;
  }

  const callerNames = callSites.map(cs => cs.caller.name);
  const uniqueFiles = new Set(callSites.map(cs => cs.caller.file));

  let summary = `Function "${functionName}" is called by ${total} function(s) in ${uniqueFiles.size} file(s).`;

  if (callSites.length > 0) {
    summary += ` Primary callers: ${callerNames.slice(0, 3).join(', ')}`;
    if (total > 3) {
      summary += ` and ${total - 3} more`;
    }
    summary += '.';
  }

  return summary;
}

/**
 * Helper: Generate cache key (simplified - should match main implementation)
 */
function getCacheKey(path: string): string {
  // In real implementation, this would include git hash, etc.
  return `cache_${path}`;
}

/**
 * Tool metadata for MCP registration
 */
export const findCallSitesTool = {
  name: 'find_call_sites',
  description: 'Find all places where a specific function is called, with line numbers and context',
  inputSchema: FindCallSitesArgsSchema,
  handler: findCallSites,
};
