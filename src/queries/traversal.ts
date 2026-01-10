/**
 * Traversal queries: function_calls_in, function_calls_out, definitions_in_file
 */

import {
  IndexedGraph,
  NodeDescriptor,
  EdgeDescriptor,
  toNodeDescriptor,
  normalizePath,
} from '../cache/graph-cache';
import {
  QueryParams,
  QueryResponse,
  QueryError,
  NodesResult,
  NodesAndEdgesResult,
  createResponse,
  createError,
} from './types';

const DEFAULT_LIMIT = 200;

/**
 * function_calls_in - Find all callers of a function
 */
export function functionCallsIn(
  params: QueryParams,
  graph: IndexedGraph,
  source: 'cache' | 'api'
): QueryResponse<NodesAndEdgesResult> | QueryError {
  if (!params.targetId) {
    return createError('INVALID_PARAMS', 'targetId is required for function_calls_in query');
  }

  // Verify target exists and is a function
  const targetNode = graph.nodeById.get(params.targetId);
  if (!targetNode) {
    return createError('NOT_FOUND', `Node with id '${params.targetId}' not found`, {
      detail: 'Use search or list_nodes with labels=["Function"] to discover function IDs',
    });
  }

  if (targetNode.labels?.[0] !== 'Function') {
    return createError('INVALID_PARAMS', `Node '${params.targetId}' is not a Function (got ${targetNode.labels?.[0]})`);
  }

  const adj = graph.callAdj.get(params.targetId);
  if (!adj) {
    return createResponse<NodesAndEdgesResult>(
      'function_calls_in',
      graph.cacheKey,
      source,
      graph.cachedAt,
      { nodes: [], edges: [] }
    );
  }

  const limit = params.limit || DEFAULT_LIMIT;
  const callerIds = adj.in.slice(0, limit);

  const nodes: NodeDescriptor[] = [];
  const edges: EdgeDescriptor[] = [];

  for (const callerId of callerIds) {
    const callerNode = graph.nodeById.get(callerId);
    if (callerNode) {
      nodes.push(toNodeDescriptor(callerNode));
      edges.push({
        type: 'calls',
        from: callerId,
        to: params.targetId,
      });
    }
  }

  const hasMore = adj.in.length > limit;

  return createResponse<NodesAndEdgesResult>(
    'function_calls_in',
    graph.cacheKey,
    source,
    graph.cachedAt,
    { nodes, edges },
    {
      page: { limit, hasMore },
      warnings: hasMore ? [`${adj.in.length - limit} more callers not shown. Increase limit to see more.`] : undefined,
    }
  );
}

/**
 * function_calls_out - Find all functions called by a function
 */
export function functionCallsOut(
  params: QueryParams,
  graph: IndexedGraph,
  source: 'cache' | 'api'
): QueryResponse<NodesAndEdgesResult> | QueryError {
  if (!params.targetId) {
    return createError('INVALID_PARAMS', 'targetId is required for function_calls_out query');
  }

  // Verify target exists and is a function
  const targetNode = graph.nodeById.get(params.targetId);
  if (!targetNode) {
    return createError('NOT_FOUND', `Node with id '${params.targetId}' not found`, {
      detail: 'Use search or list_nodes with labels=["Function"] to discover function IDs',
    });
  }

  if (targetNode.labels?.[0] !== 'Function') {
    return createError('INVALID_PARAMS', `Node '${params.targetId}' is not a Function (got ${targetNode.labels?.[0]})`);
  }

  const adj = graph.callAdj.get(params.targetId);
  if (!adj) {
    return createResponse<NodesAndEdgesResult>(
      'function_calls_out',
      graph.cacheKey,
      source,
      graph.cachedAt,
      { nodes: [], edges: [] }
    );
  }

  const limit = params.limit || DEFAULT_LIMIT;
  const calleeIds = adj.out.slice(0, limit);

  const nodes: NodeDescriptor[] = [];
  const edges: EdgeDescriptor[] = [];

  for (const calleeId of calleeIds) {
    const calleeNode = graph.nodeById.get(calleeId);
    if (calleeNode) {
      nodes.push(toNodeDescriptor(calleeNode));
      edges.push({
        type: 'calls',
        from: params.targetId,
        to: calleeId,
      });
    }
  }

  const hasMore = adj.out.length > limit;

  return createResponse<NodesAndEdgesResult>(
    'function_calls_out',
    graph.cacheKey,
    source,
    graph.cachedAt,
    { nodes, edges },
    {
      page: { limit, hasMore },
      warnings: hasMore ? [`${adj.out.length - limit} more callees not shown. Increase limit to see more.`] : undefined,
    }
  );
}

/**
 * definitions_in_file - Get all classes, functions, types defined in a file
 */
export function definitionsInFile(
  params: QueryParams,
  graph: IndexedGraph,
  source: 'cache' | 'api'
): QueryResponse<{ file: NodeDescriptor | null; definitions: NodesResult }> | QueryError {
  // Accept either targetId (file node ID) or filePathPrefix (file path)
  let filePath: string | null = null;

  if (params.targetId) {
    const targetNode = graph.nodeById.get(params.targetId);
    if (!targetNode) {
      return createError('NOT_FOUND', `Node with id '${params.targetId}' not found`);
    }
    if (targetNode.labels?.[0] !== 'File') {
      return createError('INVALID_PARAMS', `Node '${params.targetId}' is not a File (got ${targetNode.labels?.[0]})`);
    }
    filePath = targetNode.properties?.filePath as string || targetNode.properties?.path as string;
  } else if (params.filePathPrefix) {
    filePath = params.filePathPrefix;
  } else {
    return createError('INVALID_PARAMS', 'Either targetId (file node ID) or filePathPrefix is required');
  }

  if (!filePath) {
    return createError('INVALID_PARAMS', 'Could not determine file path');
  }

  const normalizedPath = normalizePath(filePath);
  const pathEntry = graph.pathIndex.get(normalizedPath);

  let resolvedPath = normalizedPath;
  if (!pathEntry) {
    // Try to find by partial match
    for (const [path] of graph.pathIndex) {
      if (path.endsWith(normalizedPath) || normalizedPath.endsWith(path)) {
        resolvedPath = path;
        break;
      }
    }

    if (resolvedPath === normalizedPath) {
      return createError('NOT_FOUND', `No definitions found for file '${filePath}'`, {
        detail: 'File may not exist in the analyzed codebase or has no class/function/type definitions',
      });
    }
  }

  const entry = pathEntry || graph.pathIndex.get(resolvedPath);
  if (!entry) {
    return createResponse(
      'definitions_in_file',
      graph.cacheKey,
      source,
      graph.cachedAt,
      { file: null, definitions: { nodes: [] } }
    );
  }

  const limit = params.limit || DEFAULT_LIMIT;
  const nodes: NodeDescriptor[] = [];

  // Get file node
  let fileNode: NodeDescriptor | null = null;
  if (entry.fileId) {
    const file = graph.nodeById.get(entry.fileId);
    if (file) {
      fileNode = toNodeDescriptor(file);
    }
  }

  // Collect all definitions
  const allIds = [...entry.classIds, ...entry.functionIds, ...entry.typeIds];

  for (const id of allIds.slice(0, limit)) {
    const node = graph.nodeById.get(id);
    if (node) {
      nodes.push(toNodeDescriptor(node));
    }
  }

  const hasMore = allIds.length > limit;

  return createResponse(
    'definitions_in_file',
    graph.cacheKey,
    source,
    graph.cachedAt,
    { file: fileNode, definitions: { nodes } },
    {
      page: { limit, hasMore },
      warnings: hasMore ? [`${allIds.length - limit} more definitions not shown.`] : undefined,
    }
  );
}

/**
 * file_imports - Get imports for a file (both outgoing and incoming)
 * v1.1 query
 */
export function fileImports(
  params: QueryParams,
  graph: IndexedGraph,
  source: 'cache' | 'api'
): QueryResponse<{ imports: NodesResult; importedBy: NodesResult }> | QueryError {
  if (!params.targetId) {
    return createError('INVALID_PARAMS', 'targetId is required for file_imports query');
  }

  const targetNode = graph.nodeById.get(params.targetId);
  if (!targetNode) {
    return createError('NOT_FOUND', `Node with id '${params.targetId}' not found`);
  }

  const label = targetNode.labels?.[0];
  if (label !== 'File' && label !== 'LocalModule' && label !== 'ExternalModule') {
    return createError('INVALID_PARAMS', `Node '${params.targetId}' is not a File/Module (got ${label})`);
  }

  const adj = graph.importAdj.get(params.targetId);
  if (!adj) {
    return createResponse(
      'file_imports',
      graph.cacheKey,
      source,
      graph.cachedAt,
      { imports: { nodes: [] }, importedBy: { nodes: [] } }
    );
  }

  const limit = params.limit || DEFAULT_LIMIT;

  const imports: NodeDescriptor[] = [];
  for (const id of adj.out.slice(0, limit)) {
    const node = graph.nodeById.get(id);
    if (node) imports.push(toNodeDescriptor(node));
  }

  const importedBy: NodeDescriptor[] = [];
  for (const id of adj.in.slice(0, limit)) {
    const node = graph.nodeById.get(id);
    if (node) importedBy.push(toNodeDescriptor(node));
  }

  return createResponse(
    'file_imports',
    graph.cacheKey,
    source,
    graph.cachedAt,
    { imports: { nodes: imports }, importedBy: { nodes: importedBy } }
  );
}

/**
 * domain_map - List all domains with their relationships
 * v1.1 query
 */
export function domainMap(
  params: QueryParams,
  graph: IndexedGraph,
  source: 'cache' | 'api'
): QueryResponse<{
  domains: Array<{ name: string; description?: string; memberCount: number }>;
  relationships: Array<{ from: string; to: string; type: string }>;
}> | QueryError {
  const domains: Array<{ name: string; description?: string; memberCount: number }> = [];
  const relationships: Array<{ from: string; to: string; type: string }> = [];

  // Get domain nodes
  const domainIds = graph.labelIndex.get('Domain') || [];
  for (const id of domainIds) {
    const node = graph.nodeById.get(id);
    if (node) {
      const name = node.properties?.name as string;
      const description = node.properties?.description as string | undefined;
      const domainEntry = graph.domainIndex.get(name);

      domains.push({
        name,
        description,
        memberCount: domainEntry?.memberIds.length || 0,
      });

      // Collect relationships
      if (domainEntry) {
        for (const rel of domainEntry.relationships) {
          const targetNode = graph.nodeById.get(rel.endNode);
          if (targetNode) {
            relationships.push({
              from: name,
              to: targetNode.properties?.name as string,
              type: rel.type,
            });
          }
        }
      }
    }
  }

  return createResponse(
    'domain_map',
    graph.cacheKey,
    source,
    graph.cachedAt,
    { domains, relationships }
  );
}

/**
 * domain_membership - Get members of a domain
 * v1.1 query
 */
export function domainMembership(
  params: QueryParams,
  graph: IndexedGraph,
  source: 'cache' | 'api'
): QueryResponse<{ domain: string; members: NodesResult }> | QueryError {
  if (!params.searchText && !params.targetId) {
    return createError('INVALID_PARAMS', 'searchText (domain name) or targetId (domain node ID) is required');
  }

  let domainName: string;

  if (params.targetId) {
    const node = graph.nodeById.get(params.targetId);
    if (!node) {
      return createError('NOT_FOUND', `Node with id '${params.targetId}' not found`);
    }
    domainName = node.properties?.name as string;
  } else {
    domainName = params.searchText!;
  }

  const domainEntry = graph.domainIndex.get(domainName);
  if (!domainEntry) {
    return createError('NOT_FOUND', `Domain '${domainName}' not found`, {
      detail: 'Use domain_map to list available domains',
    });
  }

  const limit = params.limit || DEFAULT_LIMIT;
  const members: NodeDescriptor[] = [];

  for (const id of domainEntry.memberIds.slice(0, limit)) {
    const node = graph.nodeById.get(id);
    if (node) members.push(toNodeDescriptor(node));
  }

  const hasMore = domainEntry.memberIds.length > limit;

  return createResponse(
    'domain_membership',
    graph.cacheKey,
    source,
    graph.cachedAt,
    { domain: domainName, members: { nodes: members } },
    {
      page: { limit, hasMore },
    }
  );
}

/**
 * neighborhood - Get ego graph around a node
 * v1.1 query
 */
export function neighborhood(
  params: QueryParams,
  graph: IndexedGraph,
  source: 'cache' | 'api'
): QueryResponse<NodesAndEdgesResult> | QueryError {
  if (!params.targetId) {
    return createError('INVALID_PARAMS', 'targetId is required for neighborhood query');
  }

  const targetNode = graph.nodeById.get(params.targetId);
  if (!targetNode) {
    return createError('NOT_FOUND', `Node with id '${params.targetId}' not found`);
  }

  const depth = Math.min(params.depth || 1, 3); // Cap at 3 to prevent explosion
  const limit = params.limit || 100;
  // Only include relationship types we actually implement
  const relationshipTypes = params.relationshipTypes || ['calls', 'IMPORTS'];

  const visited = new Set<string>();
  const nodes: NodeDescriptor[] = [];
  const edges: EdgeDescriptor[] = [];

  // BFS
  let frontier = [params.targetId];
  visited.add(params.targetId);
  nodes.push(toNodeDescriptor(targetNode));

  for (let d = 0; d < depth && nodes.length < limit; d++) {
    const nextFrontier: string[] = [];

    for (const nodeId of frontier) {
      if (nodes.length >= limit) break;

      // Get adjacent nodes via call graph
      if (relationshipTypes.includes('calls')) {
        const callAdj = graph.callAdj.get(nodeId);
        if (callAdj) {
          for (const adjId of [...callAdj.out, ...callAdj.in]) {
            if (!visited.has(adjId) && nodes.length < limit) {
              visited.add(adjId);
              const adjNode = graph.nodeById.get(adjId);
              if (adjNode) {
                nodes.push(toNodeDescriptor(adjNode));
                nextFrontier.push(adjId);

                // Add edge
                if (callAdj.out.includes(adjId)) {
                  edges.push({ type: 'calls', from: nodeId, to: adjId });
                } else {
                  edges.push({ type: 'calls', from: adjId, to: nodeId });
                }
              }
            }
          }
        }
      }

      // Get adjacent nodes via import graph
      if (relationshipTypes.includes('IMPORTS')) {
        const importAdj = graph.importAdj.get(nodeId);
        if (importAdj) {
          for (const adjId of [...importAdj.out, ...importAdj.in]) {
            if (!visited.has(adjId) && nodes.length < limit) {
              visited.add(adjId);
              const adjNode = graph.nodeById.get(adjId);
              if (adjNode) {
                nodes.push(toNodeDescriptor(adjNode));
                nextFrontier.push(adjId);

                if (importAdj.out.includes(adjId)) {
                  edges.push({ type: 'IMPORTS', from: nodeId, to: adjId });
                } else {
                  edges.push({ type: 'IMPORTS', from: adjId, to: nodeId });
                }
              }
            }
          }
        }
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  const hasMore = nodes.length >= limit;

  return createResponse<NodesAndEdgesResult>(
    'neighborhood',
    graph.cacheKey,
    source,
    graph.cachedAt,
    { nodes, edges },
    {
      page: { limit, hasMore },
      warnings: hasMore ? [`Neighborhood truncated at ${limit} nodes. Decrease depth or increase limit.`] : undefined,
    }
  );
}
