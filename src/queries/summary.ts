/**
 * Summary queries: graph_status, summary
 */

import { IndexedGraph, graphCache } from '../cache/graph-cache';
import {
  QueryParams,
  QueryResponse,
  QueryError,
  GraphStatusResult,
  SummaryResult,
  createResponse,
  createError,
} from './types';

/**
 * graph_status - Return cache status and summary if available
 */
export function graphStatus(
  params: QueryParams,
  graph: IndexedGraph | null
): QueryResponse<GraphStatusResult> | QueryError {
  const cacheKey = params.idempotencyKey;
  const cacheStats = graphCache.status();

  if (!graph) {
    return createResponse<GraphStatusResult>(
      'graph_status',
      cacheKey,
      'cache',
      new Date().toISOString(),
      {
        cached: false,
        cacheKey,
        cacheStats,
      }
    );
  }

  return createResponse<GraphStatusResult>(
    'graph_status',
    cacheKey,
    'cache',
    graph.cachedAt,
    {
      cached: true,
      cacheKey: graph.cacheKey,
      cachedAt: graph.cachedAt,
      summary: graph.summary,
      cacheStats,
    }
  );
}

/**
 * summary - Return high-level stats about the graph
 */
export function summary(
  params: QueryParams,
  graph: IndexedGraph,
  source: 'cache' | 'api'
): QueryResponse<SummaryResult> {
  return createResponse<SummaryResult>(
    'summary',
    graph.cacheKey,
    source,
    graph.cachedAt,
    graph.summary
  );
}
