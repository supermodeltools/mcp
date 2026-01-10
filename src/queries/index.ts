/**
 * Query dispatcher - routes queries to appropriate handlers
 * Central entry point for the query engine
 */

// @ts-ignore - jq-web doesn't have type declarations
import initJq from 'jq-web';

import { graphCache, buildIndexes, IndexedGraph } from '../cache/graph-cache';
import { SupermodelIR } from '../cache/graph-types';
import {
  QueryParams,
  QueryType,
  QueryResponse,
  QueryError,
  createError,
} from './types';
import { graphStatus, summary } from './summary';
import { getNode, search, listNodes } from './discovery';
import {
  functionCallsIn,
  functionCallsOut,
  definitionsInFile,
  fileImports,
  domainMap,
  domainMembership,
  neighborhood,
} from './traversal';

// jq import moved to top of file

/**
 * Execute a query against a graph
 * Handles caching, graph loading, and query dispatch
 */
export async function executeQuery(
  params: QueryParams,
  apiResponse?: SupermodelIR
): Promise<QueryResponse | QueryError> {
  // Cache by idempotencyKey only - file path shouldn't affect cache hits
  const cacheKey = params.idempotencyKey;

  // Try to get from cache first
  let graph = graphCache.get(cacheKey);
  let source: 'cache' | 'api' = 'cache';

  // If not cached and we have API response, build indexes and cache
  if (!graph && apiResponse) {
    graph = buildIndexes(apiResponse, cacheKey);
    graphCache.set(cacheKey, graph);
    source = 'api';
  }

  // Special case: graph_status works even without a cached graph
  if (params.query === 'graph_status') {
    return graphStatus(params, graph);
  }

  // All other queries require a graph
  if (!graph) {
    return createError('CACHE_MISS', `Graph not found in cache for key '${cacheKey}'`, {
      retryable: true,
      detail: 'Re-call with the same file and idempotencyKey to fetch from API',
    });
  }

  // Dispatch to appropriate handler
  return dispatchQuery(params, graph, source);
}

/**
 * Dispatch query to the appropriate handler function
 */
function dispatchQuery(
  params: QueryParams,
  graph: IndexedGraph,
  source: 'cache' | 'api'
): QueryResponse | QueryError | Promise<QueryResponse | QueryError> {
  switch (params.query) {
    // Summary queries
    case 'summary':
      return summary(params, graph, source);

    // Discovery queries
    case 'get_node':
      return getNode(params, graph, source);
    case 'search':
      return search(params, graph, source);
    case 'list_nodes':
      return listNodes(params, graph, source);

    // Traversal queries (v1 MVP)
    case 'function_calls_in':
      return functionCallsIn(params, graph, source);
    case 'function_calls_out':
      return functionCallsOut(params, graph, source);
    case 'definitions_in_file':
      return definitionsInFile(params, graph, source);

    // Traversal queries (v1.1)
    case 'file_imports':
      return fileImports(params, graph, source);
    case 'domain_map':
      return domainMap(params, graph, source);
    case 'domain_membership':
      return domainMembership(params, graph, source);
    case 'neighborhood':
      return neighborhood(params, graph, source);

    // Escape hatch
    case 'jq':
      return executeJqQuery(params, graph, source);

    // Not implemented yet
    case 'uses_in_file':
    case 'list_files_in_dir':
      return createError('INVALID_QUERY', `Query type '${params.query}' is not yet implemented`);

    default:
      return createError('INVALID_QUERY', `Unknown query type: ${params.query}`);
  }
}

/**
 * Execute a raw jq query against the graph
 * Escape hatch for queries not covered by canned types
 */
async function executeJqQuery(
  params: QueryParams,
  graph: IndexedGraph,
  source: 'cache' | 'api'
): Promise<QueryResponse | QueryError> {
  if (!params.jq_filter) {
    return createError('INVALID_PARAMS', 'jq_filter is required for jq query');
  }

  try {
    // Execute jq using jq-web (in-memory, no temp file needed)
    const jqInstance = await initJq;
    const result = jqInstance.json(graph.raw, params.jq_filter);

    return {
      query: 'jq',
      cacheKey: graph.cacheKey,
      source,
      cachedAt: graph.cachedAt,
      result,
      warnings: [
        'jq is an escape hatch. Consider using a canned query type for better performance.',
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createError('BAD_JQ', `jq filter error: ${message}`, {
      detail: params.jq_filter,
    });
  }
}

/**
 * Get list of available query types with descriptions
 * Useful for agent discovery
 */
export function getAvailableQueries(): Array<{
  query: QueryType;
  description: string;
  requiredParams: string[];
  optionalParams: string[];
  phase: 'v1' | 'v1.1' | 'v2';
}> {
  return [
    // v1 MVP
    {
      query: 'graph_status',
      description: 'Check if graph is cached and get summary stats',
      requiredParams: ['file', 'idempotencyKey'],
      optionalParams: [],
      phase: 'v1',
    },
    {
      query: 'summary',
      description: 'Get high-level stats about the codebase',
      requiredParams: ['file', 'idempotencyKey'],
      optionalParams: [],
      phase: 'v1',
    },
    {
      query: 'get_node',
      description: 'Get full details for a specific node by ID',
      requiredParams: ['file', 'idempotencyKey', 'targetId'],
      optionalParams: [],
      phase: 'v1',
    },
    {
      query: 'search',
      description: 'Search nodes by name substring',
      requiredParams: ['file', 'idempotencyKey', 'searchText'],
      optionalParams: ['labels', 'filePathPrefix', 'limit'],
      phase: 'v1',
    },
    {
      query: 'list_nodes',
      description: 'List nodes with filters (labels, namePattern, filePathPrefix)',
      requiredParams: ['file', 'idempotencyKey'],
      optionalParams: ['labels', 'namePattern', 'filePathPrefix', 'searchText', 'limit'],
      phase: 'v1',
    },
    {
      query: 'function_calls_in',
      description: 'Find all callers of a function',
      requiredParams: ['file', 'idempotencyKey', 'targetId'],
      optionalParams: ['limit'],
      phase: 'v1',
    },
    {
      query: 'function_calls_out',
      description: 'Find all functions called by a function',
      requiredParams: ['file', 'idempotencyKey', 'targetId'],
      optionalParams: ['limit'],
      phase: 'v1',
    },
    {
      query: 'definitions_in_file',
      description: 'Get all classes, functions, types defined in a file',
      requiredParams: ['file', 'idempotencyKey'],
      optionalParams: ['targetId', 'filePathPrefix', 'limit'],
      phase: 'v1',
    },
    {
      query: 'jq',
      description: 'Execute raw jq filter (escape hatch)',
      requiredParams: ['file', 'idempotencyKey', 'jq_filter'],
      optionalParams: [],
      phase: 'v1',
    },

    // v1.1
    {
      query: 'file_imports',
      description: 'Get imports for a file (outgoing and incoming)',
      requiredParams: ['file', 'idempotencyKey', 'targetId'],
      optionalParams: ['limit'],
      phase: 'v1.1',
    },
    {
      query: 'domain_map',
      description: 'List all domains with relationships',
      requiredParams: ['file', 'idempotencyKey'],
      optionalParams: [],
      phase: 'v1.1',
    },
    {
      query: 'domain_membership',
      description: 'Get members of a domain',
      requiredParams: ['file', 'idempotencyKey'],
      optionalParams: ['targetId', 'searchText', 'limit'],
      phase: 'v1.1',
    },
    {
      query: 'neighborhood',
      description: 'Get ego graph around a node',
      requiredParams: ['file', 'idempotencyKey', 'targetId'],
      optionalParams: ['depth', 'relationshipTypes', 'limit'],
      phase: 'v1.1',
    },
  ];
}

// Re-export types for convenience
export * from './types';
export { graphCache } from '../cache/graph-cache';
