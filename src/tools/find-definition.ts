/**
 * Task-specific tool: Find definition of a symbol
 * Fast lookup in cache indexes to locate where something is defined
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { graphCache } from '../cache';
import { CodeGraphNode } from '../cache/graph-types';
import { generateIdempotencyKey } from '../utils/api-helpers';

const FindDefinitionArgsSchema = z.object({
  path: z.string().describe('Repository path'),
  name: z.string().describe('Name of the symbol to find'),
  type: z.enum(['function', 'class', 'variable', 'type', 'any']).optional().describe('Type of symbol'),
  max_results: z.number().optional().describe('Maximum number of results if multiple matches'),
});

type FindDefinitionArgs = z.infer<typeof FindDefinitionArgsSchema>;

export interface DefinitionResult {
  name: string;
  type: string;
  file: string;
  line: number;
  end_line?: number;
  kind?: string;
  context?: string;
}

export interface FindDefinitionResponse {
  query_name: string;
  query_type: string;
  found: boolean;
  results: DefinitionResult[];
  summary: string;
}

/**
 * Find where a symbol is defined
 */
export async function findDefinition(args: FindDefinitionArgs): Promise<FindDefinitionResponse> {
  const { path, name, type = 'any', max_results = 5 } = args;

  // Get cached graph
  const cacheKey = getCacheKey(path);
  const graph = graphCache.get(cacheKey);

  if (!graph) {
    throw new Error(
      'Graph not cached. Run explore_codebase first to analyze the repository.'
    );
  }

  // Find nodes by name (case-insensitive)
  const lowerName = name.toLowerCase();
  const nodeIds = graph.nameIndex.get(lowerName) || [];

  if (nodeIds.length === 0) {
    return {
      query_name: name,
      query_type: type,
      found: false,
      results: [],
      summary: `No definition found for "${name}".`,
    };
  }

  // Filter by type if specified
  const nodes = nodeIds
    .map(id => graph.nodeById.get(id))
    .filter((node): node is CodeGraphNode => node !== undefined && matchesType(node, type))
    .slice(0, max_results);

  if (nodes.length === 0) {
    return {
      query_name: name,
      query_type: type,
      found: false,
      results: [],
      summary: `No ${type} definition found for "${name}".`,
    };
  }

  // Build results
  const results: DefinitionResult[] = nodes.map(node => {
    const props = node.properties || {};
    return {
      name: props.name as string || name,
      type: node.labels?.[0] || 'unknown',
      file: props.filePath as string || 'unknown',
      line: props.startLine as number || 0,
      end_line: props.endLine as number,
      kind: props.kind as string,
      context: buildContext(node),
    };
  });

  // Generate summary
  const summary = generateSummary(name, type, results);

  return {
    query_name: name,
    query_type: type,
    found: true,
    results,
    summary,
  };
}

/**
 * Check if node matches the requested type
 */
function matchesType(node: CodeGraphNode, requestedType: string): boolean {
  if (requestedType === 'any') {
    return true;
  }

  const primaryLabel = node.labels?.[0]?.toLowerCase() || '';

  // Map requested type to node labels
  const typeMap: Record<string, string[]> = {
    function: ['function', 'method'],
    class: ['class', 'interface', 'struct'],
    variable: ['variable', 'constant', 'parameter', 'field'],
    type: ['type', 'typedef', 'enum', 'interface'],
  };

  const acceptedLabels = typeMap[requestedType] || [requestedType];
  return acceptedLabels.some(label => primaryLabel.includes(label));
}

/**
 * Build context string for a definition
 */
function buildContext(node: CodeGraphNode): string | undefined {
  const props = node.properties || {};
  const label = node.labels?.[0] || 'symbol';

  const parts: string[] = [];

  // Add scope if available
  if (props.scope) {
    parts.push(`in ${props.scope}`);
  }

  // Add signature for functions
  if (label === 'Function' && props.signature) {
    parts.push(`signature: ${props.signature}`);
  }

  // Add modifiers
  const modifiers: string[] = [];
  if (props.isStatic) modifiers.push('static');
  if (props.isAsync) modifiers.push('async');
  if (props.isPublic) modifiers.push('public');
  if (props.isPrivate) modifiers.push('private');
  if (modifiers.length > 0) {
    parts.push(modifiers.join(' '));
  }

  return parts.join(', ') || undefined;
}

/**
 * Generate natural language summary
 */
function generateSummary(name: string, type: string, results: DefinitionResult[]): string {
  if (results.length === 0) {
    return `No definition found for "${name}".`;
  }

  if (results.length === 1) {
    const result = results[0];
    return `${result.type} "${name}" defined in ${result.file}:${result.line}`;
  }

  // Multiple results
  const typeCount = new Map<string, number>();
  for (const result of results) {
    typeCount.set(result.type, (typeCount.get(result.type) || 0) + 1);
  }

  const typeSummary = Array.from(typeCount.entries())
    .map(([t, count]) => `${count} ${t}${count > 1 ? 's' : ''}`)
    .join(', ');

  return `Found ${results.length} definitions for "${name}": ${typeSummary}`;
}

/**
 * Helper: Generate cache key matching explore_codebase's format
 */
function getCacheKey(path: string): string {
  return generateIdempotencyKey(path);
}

/**
 * Tool metadata for MCP registration
 */
export const findDefinitionTool = {
  name: 'find_definition',
  description: 'Find where a symbol (function, class, variable, type) is defined in the codebase',
  inputSchema: zodToJsonSchema(FindDefinitionArgsSchema),
  handler: findDefinition,
};
