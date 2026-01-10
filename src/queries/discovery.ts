/**
 * Discovery queries: get_node, search, list_nodes
 */

import {
  IndexedGraph,
  NodeDescriptor,
  toNodeDescriptor,
  normalizePath,
} from '../cache/graph-cache';
import {
  QueryParams,
  QueryResponse,
  QueryError,
  NodesResult,
  createResponse,
  createError,
} from './types';

const DEFAULT_LIMIT = 200;

/**
 * get_node - Return full details for a specific node ID
 */
export function getNode(
  params: QueryParams,
  graph: IndexedGraph,
  source: 'cache' | 'api'
): QueryResponse<{ node: NodeDescriptor | null; raw?: unknown }> | QueryError {
  if (!params.targetId) {
    return createError('INVALID_PARAMS', 'targetId is required for get_node query');
  }

  const node = graph.nodeById.get(params.targetId);
  if (!node) {
    return createError('NOT_FOUND', `Node with id '${params.targetId}' not found`, {
      detail: 'Use search or list_nodes to discover valid node IDs',
    });
  }

  const result: { node: NodeDescriptor; raw?: unknown } = {
    node: toNodeDescriptor(node),
  };

  // Only include raw if explicitly requested (reduces response size)
  if (params.includeRaw) {
    result.raw = node;
  }

  return createResponse(
    'get_node',
    graph.cacheKey,
    source,
    graph.cachedAt,
    result
  );
}

/**
 * search - Simple substring search across node names
 */
export function search(
  params: QueryParams,
  graph: IndexedGraph,
  source: 'cache' | 'api'
): QueryResponse<NodesResult> | QueryError {
  if (!params.searchText) {
    return createError('INVALID_PARAMS', 'searchText is required for search query');
  }

  const searchLower = params.searchText.toLowerCase();
  const limit = params.limit || DEFAULT_LIMIT;
  const labels = params.labels;
  const filePrefix = params.filePathPrefix ? normalizePath(params.filePathPrefix) : null;

  const results: NodeDescriptor[] = [];
  let scanned = 0;

  // Scan through nameIndex for matches
  for (const [name, ids] of graph.nameIndex) {
    if (!name.includes(searchLower)) continue;

    for (const id of ids) {
      if (results.length >= limit) break;

      const node = graph.nodeById.get(id);
      if (!node) continue;

      // Filter by labels if specified
      if (labels && labels.length > 0) {
        const nodeLabel = node.labels?.[0];
        if (!nodeLabel || !labels.includes(nodeLabel)) continue;
      }

      // Filter by file path prefix if specified
      if (filePrefix) {
        const filePath = node.properties?.filePath as string | undefined;
        if (!filePath || !normalizePath(filePath).startsWith(filePrefix)) continue;
      }

      results.push(toNodeDescriptor(node));
      scanned++;
    }

    if (results.length >= limit) break;
  }

  const hasMore = results.length >= limit;

  return createResponse<NodesResult>(
    'search',
    graph.cacheKey,
    source,
    graph.cachedAt,
    { nodes: results },
    {
      page: { limit, hasMore },
      warnings: hasMore ? [`Results limited to ${limit}. Use more specific searchText or add filters.`] : undefined,
    }
  );
}

/**
 * list_nodes - Filtered list of nodes by labels, namePattern, filePathPrefix
 */
export function listNodes(
  params: QueryParams,
  graph: IndexedGraph,
  source: 'cache' | 'api'
): QueryResponse<NodesResult> | QueryError {
  const limit = params.limit || DEFAULT_LIMIT;
  const labels = params.labels;
  const filePrefix = params.filePathPrefix ? normalizePath(params.filePathPrefix) : null;
  const searchText = params.searchText?.toLowerCase();
  const namePattern = params.namePattern;

  // Compile regex if namePattern provided
  let regex: RegExp | null = null;
  if (namePattern) {
    try {
      regex = new RegExp(namePattern, 'i');
    } catch (e) {
      return createError('INVALID_PARAMS', `Invalid namePattern regex: ${namePattern}`);
    }
  }

  const results: NodeDescriptor[] = [];

  // Determine which nodes to scan
  let candidateIds: Set<string>;

  if (labels && labels.length > 0) {
    // Start with nodes matching specified labels (use Set to dedupe)
    candidateIds = new Set<string>();
    for (const label of labels) {
      const ids = graph.labelIndex.get(label) || [];
      for (const id of ids) {
        candidateIds.add(id);
      }
    }
  } else {
    // Scan all nodes
    candidateIds = new Set(graph.nodeById.keys());
  }

  for (const id of candidateIds) {
    if (results.length >= limit) break;

    const node = graph.nodeById.get(id);
    if (!node) continue;

    const props = node.properties || {};
    const name = props.name as string | undefined;
    const filePath = props.filePath as string | undefined;

    // Filter by file path prefix
    if (filePrefix) {
      if (!filePath || !normalizePath(filePath).startsWith(filePrefix)) continue;
    }

    // Filter by search text (simple substring)
    if (searchText) {
      if (!name || !name.toLowerCase().includes(searchText)) continue;
    }

    // Filter by name pattern (regex)
    if (regex) {
      if (!name || !regex.test(name)) continue;
    }

    results.push(toNodeDescriptor(node));
  }

  const hasMore = results.length >= limit;

  return createResponse<NodesResult>(
    'list_nodes',
    graph.cacheKey,
    source,
    graph.cachedAt,
    { nodes: results },
    {
      page: { limit, hasMore },
      warnings: hasMore ? [`Results limited to ${limit}. Add filters to narrow results.`] : undefined,
    }
  );
}
