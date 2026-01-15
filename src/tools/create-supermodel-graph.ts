// @ts-nocheck
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import {
  Metadata,
  Endpoint,
  HandlerFunction,
  asTextContentResult,
  asErrorResult,
  ClientContext
} from '../types';
import { maybeFilter, isJqError } from '../filtering';
import { executeQuery, getAvailableQueries, isQueryError, QueryType } from '../queries';
import { zipRepository } from '../utils/zip-repository';

export const metadata: Metadata = {
  resource: 'graphs',
  operation: 'write',
  tags: [],
  httpMethod: 'post',
  httpPath: '/v1/graphs/supermodel',
  operationId: 'generateSupermodelGraph',
};

export const tool: Tool = {
  name: 'explore_codebase',
  description: '',
  inputSchema: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'Path to the repository directory to analyze.',
      },
      'Idempotency-Key': {
        type: 'string',
        description: '',
      },
      query: {
        type: 'string',
        enum: [
          'graph_status', 'summary', 'get_node', 'search', 'list_nodes',
          'function_calls_in', 'function_calls_out', 'definitions_in_file',
          'file_imports', 'domain_map', 'domain_membership', 'neighborhood', 'jq'
        ],
        description: 'Query type to execute. Use graph_status first to check cache, then summary to load.',
      },
      targetId: {
        type: 'string',
        description: 'Node ID for queries that operate on a specific node (get_node, function_calls_*, etc.)',
      },
      searchText: {
        type: 'string',
        description: 'Search text for name substring matching (search, domain_membership)',
      },
      namePattern: {
        type: 'string',
        description: 'Regex pattern for name matching (list_nodes)',
      },
      filePathPrefix: {
        type: 'string',
        description: 'Filter by file path prefix (list_nodes, definitions_in_file, search)',
      },
      labels: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by node labels: Function, Class, Type, File, Domain, etc. (list_nodes, search)',
      },
      depth: {
        type: 'number',
        description: 'Traversal depth for neighborhood query (default 1, max 3)',
      },
      relationshipTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Relationship types to traverse (neighborhood). Options: calls, IMPORTS',
      },
      limit: {
        type: 'number',
        description: 'Max results to return (default 200)',
      },
      includeRaw: {
        type: 'boolean',
        description: 'Include full raw node data in get_node response (default false)',
      },
      jq_filter: {
        type: 'string',
        title: 'jq Filter',
        description: 'Raw jq filter for escape hatch queries or legacy mode (when query param not specified)',
      },
    },
    required: ['directory', 'Idempotency-Key'],
  },
};

export const handler: HandlerFunction = async (client: ClientContext, args: Record<string, unknown> | undefined) => {
  if (!args) {
    return asErrorResult('No arguments provided');
  }

  const {
    jq_filter,
    directory,
    'Idempotency-Key': idempotencyKey,
    query,
    targetId,
    searchText,
    namePattern,
    filePathPrefix,
    labels,
    depth,
    relationshipTypes,
    limit,
    includeRaw,
  } = args as any;

  // Validate idempotency key
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return asErrorResult('Idempotency-Key argument is required');
  }

  // Validate directory
  if (!directory || typeof directory !== 'string') {
    return asErrorResult('Directory argument is required and must be a string path');
  }

  console.error('[DEBUG] Auto-zipping directory:', directory);

  // Handle auto-zipping
  let zipPath: string;
  let cleanup: (() => Promise<void>) | null = null;

  try {
    const zipResult = await zipRepository(directory);
    zipPath = zipResult.path;
    cleanup = zipResult.cleanup;

    console.error('[DEBUG] Auto-zip complete:', zipResult.fileCount, 'files,', formatBytes(zipResult.sizeBytes));
  } catch (error: any) {
    console.error('[ERROR] Auto-zip failed:', error.message);

    // Provide helpful error messages
    if (error.message.includes('does not exist')) {
      return asErrorResult(`Directory does not exist: ${directory}`);
    }
    if (error.message.includes('Permission denied')) {
      return asErrorResult(`Permission denied accessing directory: ${directory}`);
    }
    if (error.message.includes('exceeds limit')) {
      return asErrorResult(error.message);
    }
    if (error.message.includes('ENOSPC')) {
      return asErrorResult('Insufficient disk space to create ZIP archive');
    }

    return asErrorResult(`Failed to create ZIP archive: ${error.message}`);
  }

  // Execute query with cleanup handling
  try {
    // If query param is specified, use the new query engine
    if (query) {
      return await handleQueryMode(client, {
        query: query as QueryType,
        file: zipPath,
        idempotencyKey,
        targetId,
        searchText,
        namePattern,
        filePathPrefix,
        labels,
        depth,
        relationshipTypes,
        limit,
        includeRaw,
        jq_filter,
      });
    }

    // Legacy mode: use jq_filter directly on API response
    return await handleLegacyMode(client, zipPath, idempotencyKey, jq_filter);
  } finally {
    // Always cleanup temp ZIP files
    if (cleanup) {
      await cleanup();
    }
  }
};

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Handle query-based requests using the query engine
 */
async function handleQueryMode(
  client: ClientContext,
  params: {
    query: QueryType;
    file: string;
    idempotencyKey: string;
    targetId?: string;
    searchText?: string;
    namePattern?: string;
    filePathPrefix?: string;
    labels?: string[];
    depth?: number;
    relationshipTypes?: string[];
    limit?: number;
    includeRaw?: boolean;
    jq_filter?: string;
  }
): Promise<ReturnType<typeof asTextContentResult>> {
  const queryParams = {
    query: params.query,
    file: params.file,
    idempotencyKey: params.idempotencyKey,
    targetId: params.targetId,
    searchText: params.searchText,
    namePattern: params.namePattern,
    filePathPrefix: params.filePathPrefix,
    labels: params.labels,
    depth: params.depth,
    relationshipTypes: params.relationshipTypes,
    limit: params.limit,
    includeRaw: params.includeRaw,
    jq_filter: params.jq_filter,
  };

  // First, try to execute query from cache
  let result = await executeQuery(queryParams);

  // If cache miss, fetch from API and retry
  if (isQueryError(result) && result.error.code === 'CACHE_MISS') {
    console.error('[DEBUG] Cache miss, fetching from API...');

    try {
      const apiResponse = await fetchFromApi(client, params.file, params.idempotencyKey);
      result = await executeQuery(queryParams, apiResponse);
    } catch (error: any) {
      return asErrorResult(`API call failed: ${error.message || String(error)}`);
    }
  }

  // Handle query errors
  if (isQueryError(result)) {
    // Include hints for common errors
    const errorWithHints = {
      ...result,
      hints: getErrorHints(result.error.code, params.query),
    };
    return asTextContentResult(errorWithHints);
  }

  // Add breadcrumb hints to successful results
  const resultWithHints = addBreadcrumbHints(result, params.query);

  return asTextContentResult(resultWithHints);
}

/**
 * Add breadcrumb hints to query results for agent navigation
 */
function addBreadcrumbHints(result: any, queryType: QueryType): any {
  const hints: string[] = [];

  switch (queryType) {
    case 'summary':
      hints.push(
        'NEXT: Use search with searchText to find specific functions/classes',
        'NEXT: Use list_nodes with labels=["Function"] to browse all functions',
        'NEXT: Use domain_map to see architectural domains'
      );
      break;

    case 'search':
    case 'list_nodes':
      if (result.result?.nodes?.length > 0) {
        hints.push(
          'NEXT: Use get_node with targetId to get full details for any node',
          'NEXT: Use function_calls_in with targetId to see who calls a function',
          'NEXT: Use function_calls_out with targetId to see what a function calls'
        );
      }
      break;

    case 'get_node':
      if (result.result?.node) {
        const label = result.result.node.labels?.[0];
        if (label === 'Function') {
          hints.push(
            'NEXT: Use function_calls_in to see callers of this function',
            'NEXT: Use function_calls_out to see functions this calls',
            'NEXT: Use neighborhood with depth=2 to see call graph around this function'
          );
        } else if (label === 'File') {
          hints.push(
            'NEXT: Use definitions_in_file to see all definitions in this file',
            'NEXT: Use file_imports to see import relationships'
          );
        } else if (label === 'Domain') {
          hints.push(
            'NEXT: Use domain_membership to see all members of this domain'
          );
        }
      }
      break;

    case 'function_calls_in':
    case 'function_calls_out':
      if (result.result?.nodes?.length > 0) {
        hints.push(
          'NEXT: Use get_node with any caller/callee ID for full details',
          'NEXT: Chain function_calls_in/out to trace deeper call paths',
          'NEXT: Use neighborhood for broader call graph exploration'
        );
      }
      break;

    case 'definitions_in_file':
      hints.push(
        'NEXT: Use function_calls_in/out on any function ID to trace calls',
        'NEXT: Use get_node for full details on any definition'
      );
      break;

    case 'domain_map':
      hints.push(
        'NEXT: Use domain_membership with domain name to see members',
        'NEXT: Use search to find specific functions within a domain'
      );
      break;
  }

  if (hints.length > 0) {
    return { ...result, hints };
  }

  return result;
}

/**
 * Get hints for specific error conditions
 */
function getErrorHints(errorCode: string, queryType: QueryType): string[] {
  switch (errorCode) {
    case 'NOT_FOUND':
      return [
        'Use search with searchText to find nodes by name',
        'Use list_nodes with labels filter to browse available nodes',
        'Check the targetId format - it should be the full node ID from a previous query'
      ];
    case 'INVALID_PARAMS':
      return [
        `Query '${queryType}' may require specific parameters`,
        'Use graph_status to see available query types and their requirements'
      ];
    default:
      return [];
  }
}

/**
 * Fetch graph from API
 */
async function fetchFromApi(client: ClientContext, file: string, idempotencyKey: string): Promise<any> {
  console.error('[DEBUG] Reading file:', file);
  const fileBuffer = await readFile(file);
  const fileBlob = new Blob([fileBuffer], { type: 'application/zip' });

  console.error('[DEBUG] File size:', fileBuffer.length, 'bytes');
  console.error('[DEBUG] Making API request with idempotency key:', idempotencyKey);

  const requestParams = {
    file: fileBlob as any,
    idempotencyKey: idempotencyKey,
  };

  const response = await client.graphs.generateSupermodelGraph(requestParams);
  console.error('[DEBUG] API request successful');

  return response;
}

/**
 * Legacy mode: direct jq filtering on API response
 */
async function handleLegacyMode(
  client: ClientContext,
  file: string,
  idempotencyKey: string,
  jq_filter?: string
): Promise<ReturnType<typeof asTextContentResult>> {
  try {
    const response = await fetchFromApi(client, file, idempotencyKey);
    return asTextContentResult(await maybeFilter(jq_filter, response));
  } catch (error: any) {
    if (isJqError(error)) {
      return asErrorResult(error.message);
    }

    // Enhanced error logging
    console.error('[ERROR] API call failed:', error);
    console.error('[ERROR] Error name:', error.name);
    console.error('[ERROR] Error message:', error.message);
    console.error('[ERROR] Error stack:', error.stack);

    if (error.response) {
      console.error('[ERROR] Response status:', error.response.status);
      console.error('[ERROR] Response statusText:', error.response.statusText);
      console.error('[ERROR] Response headers:', error.response.headers);
      try {
        const responseText = await error.response.text();
        console.error('[ERROR] Response body:', responseText);
      } catch (e) {
        console.error('[ERROR] Could not read response body');
      }
    }

    if (error.request) {
      console.error('[ERROR] Request was made but no response received');
    }

    return asErrorResult(`API call failed: ${error.message || String(error)}. Check server logs for details.`);
  }
}

export default { metadata, tool, handler };
