/**
 * Tests for trace-data-flow tool
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { traceDataFlow } from './trace-data-flow';
import { graphCache, buildIndexes } from '../cache/graph-cache';
import { SupermodelIR } from '../cache/graph-types';

describe('trace-data-flow', () => {
  const mockPath = '/test/repo';
  const cacheKey = `cache_${mockPath}`;

  // Create mock graph data with data flow
  const createMockGraph = (): SupermodelIR => ({
    graph: {
      nodes: [
        {
          id: 'var-1',
          labels: ['Parameter'],
          properties: {
            name: 'userId',
            filePath: 'src/user.ts',
            startLine: 10,
            scope: 'getUserData',
          },
        },
        {
          id: 'func-1',
          labels: ['Function'],
          properties: {
            name: 'getUserData',
            filePath: 'src/user.ts',
            startLine: 10,
          },
        },
        {
          id: 'func-2',
          labels: ['Function'],
          properties: {
            name: 'fetchUser',
            filePath: 'src/api.ts',
            startLine: 20,
          },
        },
        {
          id: 'var-2',
          labels: ['Variable'],
          properties: {
            name: 'data',
            filePath: 'src/user.ts',
            startLine: 15,
            scope: 'getUserData',
          },
        },
      ],
      relationships: [
        {
          id: 'rel-1',
          type: 'PASSED_TO',
          startNode: 'var-1',
          endNode: 'func-2',
          properties: { lineNumber: 12 },
        },
        {
          id: 'rel-2',
          type: 'ASSIGNS',
          startNode: 'var-2',
          endNode: 'var-1',
          properties: { lineNumber: 15 },
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

  it('should find variable and trace basic flow', async () => {
    const result = await traceDataFlow({
      path: mockPath,
      variable: 'userId',
    });

    expect(result.found).toBe(true);
    expect(result.flow_steps.length).toBeGreaterThan(0);
    expect(result.flow_steps[0].step_type).toBe('definition');
    expect(result.flow_steps[0].variable_name).toBe('userId');
  });

  it('should trace flow with function context', async () => {
    const result = await traceDataFlow({
      path: mockPath,
      variable: 'userId',
      function_name: 'getUserData',
    });

    expect(result.found).toBe(true);
    expect(result.function_context).toBe('getUserData');
    expect(result.flow_steps.length).toBeGreaterThan(0);
  });

  it('should return not found for non-existent variable', async () => {
    const result = await traceDataFlow({
      path: mockPath,
      variable: 'nonExistent',
    });

    expect(result.found).toBe(false);
    expect(result.flow_steps).toHaveLength(0);
    expect(result.summary).toContain('not found');
  });

  it('should return not found when variable not in function context', async () => {
    const result = await traceDataFlow({
      path: mockPath,
      variable: 'userId',
      function_name: 'nonExistentFunction',
    });

    expect(result.found).toBe(false);
    expect(result.summary).toContain('not found in function');
  });

  it('should respect max_depth parameter', async () => {
    const result = await traceDataFlow({
      path: mockPath,
      variable: 'userId',
      max_depth: 1,
    });

    expect(result.found).toBe(true);
    // Should have limited steps due to depth constraint
    expect(result.flow_steps.length).toBeLessThanOrEqual(2);
  });

  it('should generate meaningful summary', async () => {
    const result = await traceDataFlow({
      path: mockPath,
      variable: 'userId',
    });

    expect(result.summary).toContain('userId');
    expect(result.summary).toMatch(/\d+ (total )?steps?/);
  });

  it('should handle variable with no flow', async () => {
    const result = await traceDataFlow({
      path: mockPath,
      variable: 'data',
    });

    expect(result.found).toBe(true);
    // Should have at least the definition
    expect(result.flow_steps.length).toBeGreaterThanOrEqual(1);
  });

  it('should throw error when graph not cached', async () => {
    await expect(
      traceDataFlow({
        path: '/non/existent/path',
        variable: 'test',
      })
    ).rejects.toThrow('Graph not cached');
  });
});
