/**
 * Tests for find-definition tool
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { findDefinition } from './find-definition';
import { graphCache, buildIndexes } from '../cache/graph-cache';
import { SupermodelIR } from '../cache/graph-types';

describe('find-definition', () => {
  const mockPath = '/test/repo';
  const cacheKey = `cache_${mockPath}`;

  // Create mock graph data
  const createMockGraph = (): SupermodelIR => ({
    graph: {
      nodes: [
        {
          id: 'func-1',
          labels: ['Function'],
          properties: {
            name: 'myFunction',
            filePath: 'src/utils.ts',
            startLine: 10,
            endLine: 20,
          },
        },
        {
          id: 'class-1',
          labels: ['Class'],
          properties: {
            name: 'MyClass',
            filePath: 'src/models.ts',
            startLine: 5,
            endLine: 50,
          },
        },
        {
          id: 'var-1',
          labels: ['Variable'],
          properties: {
            name: 'config',
            filePath: 'src/config.ts',
            startLine: 3,
          },
        },
        {
          id: 'type-1',
          labels: ['Type'],
          properties: {
            name: 'UserType',
            filePath: 'src/types.ts',
            startLine: 8,
          },
        },
        {
          id: 'func-2',
          labels: ['Function'],
          properties: {
            name: 'myFunction',
            filePath: 'src/helpers.ts',
            startLine: 15,
            endLine: 25,
          },
        },
      ],
      relationships: [],
    },
  });

  beforeEach(() => {
    // Set up cache with mock graph
    const mockIR = createMockGraph();
    const indexed = buildIndexes(mockIR, cacheKey);
    graphCache.set(cacheKey, indexed);
  });

  it('should find function definition', async () => {
    const result = await findDefinition({
      path: mockPath,
      name: 'myFunction',
      type: 'function',
    });

    expect(result.found).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].name).toBe('myFunction');
    expect(result.results[0].type).toBe('Function');
    expect(result.results[0].file).toContain('src/');
  });

  it('should find class definition', async () => {
    const result = await findDefinition({
      path: mockPath,
      name: 'MyClass',
      type: 'class',
    });

    expect(result.found).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe('MyClass');
    expect(result.results[0].type).toBe('Class');
    expect(result.results[0].file).toBe('src/models.ts');
    expect(result.results[0].line).toBe(5);
  });

  it('should find variable definition', async () => {
    const result = await findDefinition({
      path: mockPath,
      name: 'config',
      type: 'variable',
    });

    expect(result.found).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe('config');
    expect(result.results[0].type).toBe('Variable');
  });

  it('should find type definition', async () => {
    const result = await findDefinition({
      path: mockPath,
      name: 'UserType',
      type: 'type',
    });

    expect(result.found).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe('UserType');
    expect(result.results[0].type).toBe('Type');
  });

  it('should find any type when type is "any"', async () => {
    const result = await findDefinition({
      path: mockPath,
      name: 'MyClass',
      type: 'any',
    });

    expect(result.found).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].type).toBe('Class');
  });

  it('should handle multiple matches', async () => {
    const result = await findDefinition({
      path: mockPath,
      name: 'myFunction',
      type: 'any',
    });

    expect(result.found).toBe(true);
    expect(result.results.length).toBeGreaterThanOrEqual(2);
    expect(result.summary).toContain('Found 2 definitions');
  });

  it('should respect max_results limit', async () => {
    const result = await findDefinition({
      path: mockPath,
      name: 'myFunction',
      type: 'any',
      max_results: 1,
    });

    expect(result.found).toBe(true);
    expect(result.results).toHaveLength(1);
  });

  it('should return not found for non-existent symbol', async () => {
    const result = await findDefinition({
      path: mockPath,
      name: 'nonExistent',
      type: 'any',
    });

    expect(result.found).toBe(false);
    expect(result.results).toHaveLength(0);
    expect(result.summary).toContain('No definition found');
  });

  it('should be case-insensitive', async () => {
    const result = await findDefinition({
      path: mockPath,
      name: 'MYFUNCTION',
      type: 'function',
    });

    expect(result.found).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('should filter by type correctly', async () => {
    const result = await findDefinition({
      path: mockPath,
      name: 'myFunction',
      type: 'class',
    });

    expect(result.found).toBe(false);
    expect(result.summary).toContain('No class definition found');
  });

  it('should throw error when graph not cached', async () => {
    await expect(
      findDefinition({
        path: '/non/existent/path',
        name: 'test',
        type: 'any',
      })
    ).rejects.toThrow('Graph not cached');
  });
});
