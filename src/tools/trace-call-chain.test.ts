/**
 * Tests for trace-call-chain tool
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { traceCallChain } from './trace-call-chain';
import { graphCache, buildIndexes } from '../cache/graph-cache';
import { SupermodelIR } from '../cache/graph-types';

// Mock generateIdempotencyKey to return a predictable key for test paths
jest.mock('../utils/api-helpers', () => ({
  ...jest.requireActual('../utils/api-helpers') as any,
  generateIdempotencyKey: (dir: string) => `test-key:${dir}`,
}));

describe('trace-call-chain', () => {
  const mockPath = '/test/repo';
  const cacheKey = `test-key:${mockPath}`;

  // Create mock graph data with call chain: funcA -> funcB -> funcC
  const createMockGraph = (): SupermodelIR => ({
    graph: {
      nodes: [
        {
          id: 'func-a',
          labels: ['Function'],
          properties: {
            name: 'funcA',
            filePath: 'src/a.ts',
            startLine: 10,
          },
        },
        {
          id: 'func-b',
          labels: ['Function'],
          properties: {
            name: 'funcB',
            filePath: 'src/b.ts',
            startLine: 20,
          },
        },
        {
          id: 'func-c',
          labels: ['Function'],
          properties: {
            name: 'funcC',
            filePath: 'src/c.ts',
            startLine: 30,
          },
        },
      ],
      relationships: [
        {
          id: 'call-1',
          type: 'calls',
          startNode: 'func-a',
          endNode: 'func-b',
          properties: { lineNumber: 15 },
        },
        {
          id: 'call-2',
          type: 'calls',
          startNode: 'func-b',
          endNode: 'func-c',
          properties: { lineNumber: 25 },
        },
      ],
    },
  });

  beforeEach(() => {
    // Set up cache with mock graph
    const mockIR = createMockGraph();
    const indexed = buildIndexes(mockIR, cacheKey);
    graphCache.set(cacheKey, indexed);
  });

  it('should find direct call chain', async () => {
    const result = await traceCallChain({
      path: mockPath,
      from_function: 'funcA',
      to_function: 'funcB',
    });

    expect(result.path_exists).toBe(true);
    expect(result.call_chain).toHaveLength(2);
    expect(result.call_chain[0].function_name).toBe('funcA');
    expect(result.call_chain[1].function_name).toBe('funcB');
    expect(result.summary).toContain('directly calls');
  });

  it('should find multi-step call chain', async () => {
    const result = await traceCallChain({
      path: mockPath,
      from_function: 'funcA',
      to_function: 'funcC',
    });

    expect(result.path_exists).toBe(true);
    expect(result.call_chain).toHaveLength(3);
    expect(result.call_chain[0].function_name).toBe('funcA');
    expect(result.call_chain[1].function_name).toBe('funcB');
    expect(result.call_chain[2].function_name).toBe('funcC');
    expect(result.summary).toContain('funcA → funcB → funcC');
  });

  it('should return false when no path exists', async () => {
    const result = await traceCallChain({
      path: mockPath,
      from_function: 'funcC',
      to_function: 'funcA',
    });

    expect(result.path_exists).toBe(false);
    expect(result.call_chain).toHaveLength(0);
    expect(result.summary).toContain('No call chain found');
  });

  it('should handle non-existent source function', async () => {
    const result = await traceCallChain({
      path: mockPath,
      from_function: 'nonExistent',
      to_function: 'funcA',
    });

    expect(result.path_exists).toBe(false);
    expect(result.summary).toContain('not found');
  });

  it('should handle non-existent target function', async () => {
    const result = await traceCallChain({
      path: mockPath,
      from_function: 'funcA',
      to_function: 'nonExistent',
    });

    expect(result.path_exists).toBe(false);
    expect(result.summary).toContain('not found');
  });

  it('should respect max_depth parameter', async () => {
    const result = await traceCallChain({
      path: mockPath,
      from_function: 'funcA',
      to_function: 'funcC',
      max_depth: 1,
    });

    // Should not find path because it requires depth of 3
    expect(result.path_exists).toBe(false);
    expect(result.summary).toContain('within depth 1');
  });

  it('should throw error when graph not cached', async () => {
    await expect(
      traceCallChain({
        path: '/non/existent/path',
        from_function: 'funcA',
        to_function: 'funcB',
      })
    ).rejects.toThrow('Graph not cached');
  });
});
