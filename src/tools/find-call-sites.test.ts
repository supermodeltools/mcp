/**
 * Tests for find-call-sites tool
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { findCallSites } from './find-call-sites';
import { graphCache, buildIndexes } from '../cache/graph-cache';
import { SupermodelIR } from '../cache/graph-types';

describe('find-call-sites', () => {
  const mockPath = '/test/repo';
  const cacheKey = `cache_${mockPath}`;

  // Create mock graph data
  const createMockGraph = (): SupermodelIR => ({
    graph: {
      nodes: [
        {
          id: 'func-target',
          labels: ['Function'],
          properties: {
            name: 'targetFunction',
            filePath: 'src/target.ts',
            startLine: 10,
          },
        },
        {
          id: 'func-caller1',
          labels: ['Function'],
          properties: {
            name: 'callerOne',
            filePath: 'src/caller1.ts',
            startLine: 20,
          },
        },
        {
          id: 'func-caller2',
          labels: ['Function'],
          properties: {
            name: 'callerTwo',
            filePath: 'src/caller2.ts',
            startLine: 30,
          },
        },
        {
          id: 'func-nocalls',
          labels: ['Function'],
          properties: {
            name: 'noCalls',
            filePath: 'src/nocalls.ts',
            startLine: 40,
          },
        },
      ],
      relationships: [
        {
          id: 'call-1',
          type: 'calls',
          startNode: 'func-caller1',
          endNode: 'func-target',
          properties: {
            lineNumber: 25,
            columnNumber: 10,
            codeSnippet: 'result = targetFunction(arg)',
          },
        },
        {
          id: 'call-2',
          type: 'calls',
          startNode: 'func-caller2',
          endNode: 'func-target',
          properties: {
            lineNumber: 35,
            columnNumber: 5,
          },
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

  it('should find all call sites for a function', async () => {
    const result = await findCallSites({
      path: mockPath,
      function_name: 'targetFunction',
    });

    expect(result.total_call_sites).toBe(2);
    expect(result.call_sites).toHaveLength(2);
    expect(result.call_sites[0].caller.name).toBe('callerOne');
    expect(result.call_sites[1].caller.name).toBe('callerTwo');
  });

  it('should include call site details', async () => {
    const result = await findCallSites({
      path: mockPath,
      function_name: 'targetFunction',
    });

    const firstCallSite = result.call_sites[0];
    expect(firstCallSite.caller.file).toBe('src/caller1.ts');
    expect(firstCallSite.caller.line).toBe(20);
    expect(firstCallSite.call_site.line).toBe(25);
    expect(firstCallSite.call_site.column).toBe(10);
  });

  it('should include code context when requested', async () => {
    const result = await findCallSites({
      path: mockPath,
      function_name: 'targetFunction',
      include_context: true,
    });

    const firstCallSite = result.call_sites[0];
    expect(firstCallSite.call_site.code_snippet).toBeDefined();
    expect(firstCallSite.call_site.code_snippet).toContain('targetFunction');
  });

  it('should exclude code context when not requested', async () => {
    const result = await findCallSites({
      path: mockPath,
      function_name: 'targetFunction',
      include_context: false,
    });

    const firstCallSite = result.call_sites[0];
    expect(firstCallSite.call_site.code_snippet).toBeUndefined();
  });

  it('should return empty array for function with no callers', async () => {
    const result = await findCallSites({
      path: mockPath,
      function_name: 'noCalls',
    });

    expect(result.total_call_sites).toBe(0);
    expect(result.call_sites).toHaveLength(0);
    expect(result.summary).toContain('not called');
  });

  it('should return not found for non-existent function', async () => {
    const result = await findCallSites({
      path: mockPath,
      function_name: 'nonExistent',
    });

    expect(result.total_call_sites).toBe(0);
    expect(result.call_sites).toHaveLength(0);
    expect(result.summary).toContain('not found');
  });

  it('should respect max_results limit', async () => {
    const result = await findCallSites({
      path: mockPath,
      function_name: 'targetFunction',
      max_results: 1,
    });

    expect(result.total_call_sites).toBe(2); // Total count should still be accurate
    expect(result.call_sites).toHaveLength(1); // But only return 1 result
  });

  it('should be case-insensitive', async () => {
    const result = await findCallSites({
      path: mockPath,
      function_name: 'TARGETFUNCTION',
    });

    expect(result.total_call_sites).toBe(2);
    expect(result.call_sites).toHaveLength(2);
  });

  it('should generate meaningful summary', async () => {
    const result = await findCallSites({
      path: mockPath,
      function_name: 'targetFunction',
    });

    expect(result.summary).toContain('targetFunction');
    expect(result.summary).toContain('2 function(s)');
    expect(result.summary).toContain('callerOne, callerTwo');
  });

  it('should throw error when graph not cached', async () => {
    await expect(
      findCallSites({
        path: '/non/existent/path',
        function_name: 'test',
      })
    ).rejects.toThrow('Graph not cached');
  });
});
