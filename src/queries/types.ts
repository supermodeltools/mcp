/**
 * Query types and result shapes for the query engine
 */

import { NodeDescriptor, EdgeDescriptor } from '../cache/graph-cache';

// All supported query types
export type QueryType =
  // Status & Summary (v1 MVP)
  | 'graph_status'
  | 'summary'
  // Discovery (v1 MVP)
  | 'get_node'
  | 'search'
  | 'list_nodes'
  // Traversal (v1 MVP)
  | 'function_calls_in'
  | 'function_calls_out'
  | 'definitions_in_file'
  // Escape hatch (v1 MVP)
  | 'jq'
  // v1.1 queries
  | 'file_imports'
  | 'uses_in_file'
  | 'list_files_in_dir'
  | 'neighborhood'
  | 'domain_map'
  | 'domain_membership';

// Query parameters
export interface QueryParams {
  query: QueryType;
  file: string;
  idempotencyKey: string;

  // Discovery params
  targetId?: string;
  searchText?: string;
  namePattern?: string;
  filePathPrefix?: string;
  labels?: string[];

  // Traversal params
  depth?: number;
  maxDepth?: number;
  relationshipTypes?: string[];

  // Pagination
  limit?: number;
  // Note: cursor removed - not implemented in v1

  // Output options
  includeRaw?: boolean; // Include full raw node in get_node (default false)

  // Escape hatch
  jq_filter?: string;
}

// Pagination info
export interface PageInfo {
  limit: number;
  hasMore: boolean;
}

// Base response envelope
export interface QueryResponse<T = unknown> {
  query: QueryType;
  cacheKey: string;
  source: 'cache' | 'api';
  cachedAt: string;
  page?: PageInfo;
  result: T;
  warnings?: string[];
}

// Error response
export interface QueryError {
  error: {
    code: 'NOT_FOUND' | 'BAD_JQ' | 'CACHE_MISS' | 'API_UNAVAILABLE' | 'INVALID_QUERY' | 'INVALID_PARAMS';
    message: string;
    retryable?: boolean;
    detail?: string;
  };
}

// Result types for different queries

export interface GraphStatusResult {
  cached: boolean;
  cacheKey: string;
  cachedAt?: string;
  summary?: SummaryResult;
  cacheStats: {
    graphs: number;
    nodes: number;
    keys: string[];
  };
}

export interface SummaryResult {
  filesProcessed: number;
  classes: number;
  functions: number;
  types: number;
  domains: number;
  primaryLanguage: string;
  nodeCount: number;
  relationshipCount: number;
}

export interface NodesResult {
  nodes: NodeDescriptor[];
}

export interface NodesAndEdgesResult {
  nodes: NodeDescriptor[];
  edges: EdgeDescriptor[];
}

export interface DomainMapResult {
  domains: Array<{
    name: string;
    description?: string;
    memberCount: number;
    keyFiles: string[];
  }>;
  relationships: Array<{
    from: string;
    to: string;
    type: string;
  }>;
}

export interface DomainMembershipResult {
  domain: string;
  members: NodeDescriptor[];
}

// Type guard for error responses
export function isQueryError(result: unknown): result is QueryError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    typeof (result as QueryError).error === 'object'
  );
}

// Create error response
export function createError(
  code: QueryError['error']['code'],
  message: string,
  options?: { retryable?: boolean; detail?: string }
): QueryError {
  return {
    error: {
      code,
      message,
      retryable: options?.retryable,
      detail: options?.detail,
    },
  };
}

// Create success response
export function createResponse<T>(
  query: QueryType,
  cacheKey: string,
  source: 'cache' | 'api',
  cachedAt: string,
  result: T,
  options?: { page?: PageInfo; warnings?: string[] }
): QueryResponse<T> {
  return {
    query,
    cacheKey,
    source,
    cachedAt,
    result,
    page: options?.page,
    warnings: options?.warnings,
  };
}
