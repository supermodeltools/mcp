import { describe, it, expect } from '@jest/globals';
import { getNode, search, listNodes } from './discovery';
import { IndexedGraph } from '../cache/graph-cache';
import { CodeGraphNode } from '../cache/graph-types';
import { QueryParams } from './types';

// Helper to create a mock indexed graph
function createMockGraph(nodes: CodeGraphNode[]): IndexedGraph {
  const nodeById = new Map<string, CodeGraphNode>();
  const labelIndex = new Map<string, string[]>();
  const nameIndex = new Map<string, string[]>();
  const pathIndex = new Map();
  const dirIndex = new Map();
  const callAdj = new Map();
  const importAdj = new Map();
  const domainIndex = new Map();

  for (const node of nodes) {
    nodeById.set(node.id, node);

    // Build label index
    for (const label of node.labels || []) {
      if (!labelIndex.has(label)) {
        labelIndex.set(label, []);
      }
      labelIndex.get(label)!.push(node.id);
    }

    // Build name index
    const name = node.properties?.name as string | undefined;
    if (name) {
      const lowerName = name.toLowerCase();
      if (!nameIndex.has(lowerName)) {
        nameIndex.set(lowerName, []);
      }
      nameIndex.get(lowerName)!.push(node.id);
    }
  }

  return {
    raw: { graph: { nodes: [], relationships: [] } } as any,
    nodeById,
    labelIndex,
    pathIndex,
    dirIndex,
    nameIndex,
    callAdj,
    importAdj,
    domainIndex,
    summary: {
      filesProcessed: 0,
      classes: 0,
      functions: nodes.filter(n => n.labels?.[0] === 'Function').length,
      types: 0,
      domains: 0,
      primaryLanguage: 'typescript',
      nodeCount: nodes.length,
      relationshipCount: 0,
    },
    cachedAt: new Date().toISOString(),
    cacheKey: 'test-key',
  };
}

describe('discovery queries', () => {
  describe('getNode', () => {
    it('should return node when found', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: {
            name: 'testFunction',
            filePath: 'src/test.ts',
            startLine: 10,
            endLine: 20,
          },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = { targetId: 'node-1' } as QueryParams;

      const result = getNode(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.node).toBeDefined();
        expect(result.result.node?.id).toBe('node-1');
        expect(result.result.node?.name).toBe('testFunction');
      }
    });

    it('should return NOT_FOUND error when node does not exist', () => {
      const graph = createMockGraph([]);
      const params = { targetId: 'non-existent' };

      const result = getNode(params as QueryParams, graph, 'cache');

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should return INVALID_PARAMS error when targetId is missing', () => {
      const graph = createMockGraph([]);
      const params = {} as QueryParams;

      const result = getNode(params as QueryParams, graph, 'cache');

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error.code).toBe('INVALID_PARAMS');
      }
    });

    it('should include raw data when includeRaw is true', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'test' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = { targetId: 'node-1', includeRaw: true };

      const result = getNode(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.raw).toBeDefined();
      }
    });

    it('should not include raw data when includeRaw is false', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'test' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = { targetId: 'node-1', includeRaw: false };

      const result = getNode(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.raw).toBeUndefined();
      }
    });
  });

  describe('search', () => {
    it('should find nodes by name substring', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'getUserById' },
        },
        {
          id: 'node-2',
          labels: ['Function'],
          properties: { name: 'getPostById' },
        },
        {
          id: 'node-3',
          labels: ['Function'],
          properties: { name: 'deleteUser' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = { searchText: 'user' } as QueryParams;

      const result = search(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(2);
        expect(result.result.nodes?.map(n => n.name)).toContain('getUserById');
        expect(result.result.nodes?.map(n => n.name)).toContain('deleteUser');
      }
    });

    it('should be case-insensitive', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'GetUserById' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = { searchText: 'user' } as QueryParams;

      const result = search(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(1);
      }
    });

    it('should filter by labels', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'test' },
        },
        {
          id: 'node-2',
          labels: ['Class'],
          properties: { name: 'Test' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = { searchText: 'test', labels: ['Function'] };

      const result = search(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(1);
        expect(result.result.nodes?.[0].labels).toContain('Function');
      }
    });

    it('should filter by file path prefix', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'test', filePath: 'src/utils/test.ts' },
        },
        {
          id: 'node-2',
          labels: ['Function'],
          properties: { name: 'test', filePath: 'src/api/test.ts' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = { searchText: 'test', filePathPrefix: 'src/utils' };

      const result = search(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(1);
        expect(result.result.nodes?.[0].filePath).toBe('src/utils/test.ts');
      }
    });

    it('should respect limit parameter', () => {
      const nodes: CodeGraphNode[] = Array.from({ length: 10 }, (_, i) => ({
        id: `node-${i}`,
        labels: ['Function'],
        properties: { name: `test${i}` },
      }));

      const graph = createMockGraph(nodes);
      const params = { searchText: 'test', limit: 5 };

      const result = search(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(5);
        expect((result as any).page?.hasMore).toBe(true);
      }
    });

    it('should return INVALID_PARAMS error when searchText is missing', () => {
      const graph = createMockGraph([]);
      const params = {} as QueryParams;

      const result = search(params as QueryParams, graph, 'cache');

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error.code).toBe('INVALID_PARAMS');
      }
    });

    it('should return empty results when no matches', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'test' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = { searchText: 'nonexistent' };

      const result = search(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(0);
      }
    });
  });

  describe('listNodes', () => {
    it('should list all nodes when no filters', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'func1' },
        },
        {
          id: 'node-2',
          labels: ['Class'],
          properties: { name: 'Class1' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = {} as QueryParams;

      const result = listNodes(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(2);
      }
    });

    it('should filter by labels', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'func1' },
        },
        {
          id: 'node-2',
          labels: ['Class'],
          properties: { name: 'Class1' },
        },
        {
          id: 'node-3',
          labels: ['Function'],
          properties: { name: 'func2' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = { labels: ['Function'] };

      const result = listNodes(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(2);
        expect(result.result.nodes?.every(n => n.labels.includes('Function'))).toBe(true);
      }
    });

    it('should filter by file path prefix', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'func1', filePath: 'src/utils/helper.ts' },
        },
        {
          id: 'node-2',
          labels: ['Function'],
          properties: { name: 'func2', filePath: 'src/api/handler.ts' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = { filePathPrefix: 'src/utils' };

      const result = listNodes(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(1);
        expect(result.result.nodes?.[0].name).toBe('func1');
      }
    });

    it('should filter by searchText (substring)', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'getUserById' },
        },
        {
          id: 'node-2',
          labels: ['Function'],
          properties: { name: 'getPostById' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = { searchText: 'user' } as QueryParams;

      const result = listNodes(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(1);
        expect(result.result.nodes?.[0].name).toBe('getUserById');
      }
    });

    it('should filter by namePattern (regex)', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'getUser' },
        },
        {
          id: 'node-2',
          labels: ['Function'],
          properties: { name: 'setUser' },
        },
        {
          id: 'node-3',
          labels: ['Function'],
          properties: { name: 'deleteUser' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = { namePattern: '^get.*' };

      const result = listNodes(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(1);
        expect(result.result.nodes?.[0].name).toBe('getUser');
      }
    });

    it('should return error for invalid regex pattern', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'test' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = { namePattern: '[invalid(' };

      const result = listNodes(params as QueryParams, graph, 'cache');

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error.code).toBe('INVALID_PARAMS');
      }
    });

    it('should respect limit parameter', () => {
      const nodes: CodeGraphNode[] = Array.from({ length: 10 }, (_, i) => ({
        id: `node-${i}`,
        labels: ['Function'],
        properties: { name: `func${i}` },
      }));

      const graph = createMockGraph(nodes);
      const params = { limit: 5 };

      const result = listNodes(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(5);
        expect((result as any).page?.hasMore).toBe(true);
      }
    });

    it('should combine multiple filters', () => {
      const nodes: CodeGraphNode[] = [
        {
          id: 'node-1',
          labels: ['Function'],
          properties: { name: 'getUserById', filePath: 'src/utils/user.ts' },
        },
        {
          id: 'node-2',
          labels: ['Function'],
          properties: { name: 'getPostById', filePath: 'src/utils/post.ts' },
        },
        {
          id: 'node-3',
          labels: ['Class'],
          properties: { name: 'getUserById', filePath: 'src/utils/user.ts' },
        },
      ];

      const graph = createMockGraph(nodes);
      const params = {
        labels: ['Function'],
        searchText: 'user',
        filePathPrefix: 'src/utils',
      };

      const result = listNodes(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(1);
        expect(result.result.nodes?.[0].id).toBe('node-1');
      }
    });

    it('should handle empty graph', () => {
      const graph = createMockGraph([]);
      const params = {} as QueryParams;

      const result = listNodes(params as QueryParams, graph, 'cache');

      expect('result' in result).toBe(true);
      if ('result' in result) {
        expect(result.result.nodes).toHaveLength(0);
      }
    });
  });
});
