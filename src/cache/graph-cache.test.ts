import { describe, it, expect, beforeEach } from '@jest/globals';
import { GraphCache, buildIndexes, normalizePath } from './graph-cache';

describe('graph-cache', () => {
  describe('GraphCache', () => {
    let cache: GraphCache;

    beforeEach(() => {
      cache = new GraphCache({
        maxGraphs: 3,
        maxNodes: 100,
        maxAgeMs: 1000, // 1 second for testing
      });
    });

    describe('basic operations', () => {
      it('should store and retrieve a graph', () => {
        const graph = createMockIndexedGraph('key1', 10);

        cache.set('key1', graph);
        const retrieved = cache.get('key1');

        expect(retrieved).toBeDefined();
        expect(retrieved?.cacheKey).toBe('key1');
      });

      it('should return null for non-existent key', () => {
        const retrieved = cache.get('non-existent');
        expect(retrieved).toBeNull();
      });

      it('should check if key exists', () => {
        const graph = createMockIndexedGraph('key1', 10);

        cache.set('key1', graph);

        expect(cache.has('key1')).toBe(true);
        expect(cache.has('non-existent')).toBe(false);
      });

      it('should return cache status', () => {
        const graph1 = createMockIndexedGraph('key1', 10);
        const graph2 = createMockIndexedGraph('key2', 20);

        cache.set('key1', graph1);
        cache.set('key2', graph2);

        const status = cache.status();

        expect(status.graphs).toBe(2);
        expect(status.nodes).toBe(30);
        expect(status.keys).toContain('key1');
        expect(status.keys).toContain('key2');
      });
    });

    describe('LRU eviction', () => {
      it('should evict oldest entry when max graphs exceeded', () => {
        const graph1 = createMockIndexedGraph('key1', 10);
        const graph2 = createMockIndexedGraph('key2', 10);
        const graph3 = createMockIndexedGraph('key3', 10);
        const graph4 = createMockIndexedGraph('key4', 10);

        cache.set('key1', graph1);
        cache.set('key2', graph2);
        cache.set('key3', graph3);

        // Adding 4th graph should evict key1
        cache.set('key4', graph4);

        expect(cache.has('key1')).toBe(false);
        expect(cache.has('key2')).toBe(true);
        expect(cache.has('key3')).toBe(true);
        expect(cache.has('key4')).toBe(true);
      });

      it('should update access time on get', async () => {
        const graph1 = createMockIndexedGraph('key1', 10);
        const graph2 = createMockIndexedGraph('key2', 10);
        const graph3 = createMockIndexedGraph('key3', 10);
        const graph4 = createMockIndexedGraph('key4', 10);

        cache.set('key1', graph1);

        // Add delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 50));

        cache.set('key2', graph2);

        // Add delay before setting key3
        await new Promise(resolve => setTimeout(resolve, 50));

        cache.set('key3', graph3);

        // Access key1 to make it most recently used
        cache.get('key1');

        // Adding 4th graph should evict the least recently accessed
        cache.set('key4', graph4);

        // Verify the cache has 3 entries (one was evicted)
        const status = cache.status();
        expect(status.graphs).toBe(3);

        // key1 was accessed most recently, so should still be in cache
        expect(cache.has('key1')).toBe(true);
        // At least one of the others should still be in cache
        expect(cache.has('key3') || cache.has('key4')).toBe(true);
      });

      it('should evict when max nodes exceeded', () => {
        const graph1 = createMockIndexedGraph('key1', 40);
        const graph2 = createMockIndexedGraph('key2', 40);
        const graph3 = createMockIndexedGraph('key3', 40);

        cache.set('key1', graph1);
        cache.set('key2', graph2);

        // Adding graph3 would exceed 100 nodes, should evict key1
        cache.set('key3', graph3);

        expect(cache.has('key1')).toBe(false);
        expect(cache.has('key2')).toBe(true);
        expect(cache.has('key3')).toBe(true);

        const status = cache.status();
        expect(status.nodes).toBe(80); // 40 + 40
      });
    });

    describe('TTL eviction', () => {
      it('should evict stale entries', async () => {
        const graph = createMockIndexedGraph('key1', 10);

        cache.set('key1', graph);

        // Wait for TTL to expire (1 second + buffer)
        await new Promise(resolve => setTimeout(resolve, 1100));

        const evicted = cache.evictStale();

        expect(evicted).toBe(1);
        expect(cache.has('key1')).toBe(false);
      });

      it('should not evict fresh entries', () => {
        const graph = createMockIndexedGraph('key1', 10);

        cache.set('key1', graph);

        const evicted = cache.evictStale();

        expect(evicted).toBe(0);
        expect(cache.has('key1')).toBe(true);
      });

      it('should auto-evict stale entries before adding new ones', async () => {
        const graph1 = createMockIndexedGraph('key1', 10);

        cache.set('key1', graph1);

        // Wait for TTL to expire
        await new Promise(resolve => setTimeout(resolve, 1100));

        const graph2 = createMockIndexedGraph('key2', 10);
        cache.set('key2', graph2);

        // key1 should have been auto-evicted
        expect(cache.has('key1')).toBe(false);
        expect(cache.has('key2')).toBe(true);
      });
    });

    describe('node count tracking', () => {
      it('should track total node count correctly', () => {
        const graph1 = createMockIndexedGraph('key1', 30);
        const graph2 = createMockIndexedGraph('key2', 45);

        cache.set('key1', graph1);
        cache.set('key2', graph2);

        const status = cache.status();
        expect(status.nodes).toBe(75);
      });

      it('should decrease node count on eviction', () => {
        const graph1 = createMockIndexedGraph('key1', 30);
        const graph2 = createMockIndexedGraph('key2', 40);
        const graph3 = createMockIndexedGraph('key3', 40);
        const graph4 = createMockIndexedGraph('key4', 10);

        cache.set('key1', graph1);
        cache.set('key2', graph2);
        cache.set('key3', graph3);

        // This should evict graphs to make room
        cache.set('key4', graph4);

        const status = cache.status();
        expect(status.nodes).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('buildIndexes', () => {
    it('should build node indexes correctly', () => {
      const raw: any = {
        repo: 'test-repo',
        graph: {
          nodes: [
            {
              id: 'node1',
              labels: ['Function'],
              properties: { name: 'testFunc' },
            },
            {
              id: 'node2',
              labels: ['Class'],
              properties: { name: 'TestClass' },
            },
          ],
          relationships: [],
        },
      };

      const indexed = buildIndexes(raw, 'test-key');

      expect(indexed.nodeById.size).toBe(2);
      expect(indexed.nodeById.get('node1')).toBeDefined();
      expect(indexed.labelIndex.get('Function')).toContain('node1');
      expect(indexed.labelIndex.get('Class')).toContain('node2');
    });

    it('should build name index (lowercase)', () => {
      const raw: any = {
        repo: 'test-repo',
        graph: {
          nodes: [
            {
              id: 'node1',
              labels: ['Function'],
              properties: { name: 'TestFunc' },
            },
          ],
          relationships: [],
        },
      };

      const indexed = buildIndexes(raw, 'test-key');

      expect(indexed.nameIndex.get('testfunc')).toContain('node1');
    });

    it('should build path index', () => {
      const raw: any = {
        repo: 'test-repo',
        graph: {
          nodes: [
            {
              id: 'file1',
              labels: ['File'],
              properties: { filePath: 'src/test.ts' },
            },
            {
              id: 'func1',
              labels: ['Function'],
              properties: { name: 'test', filePath: 'src/test.ts' },
            },
          ],
          relationships: [],
        },
      };

      const indexed = buildIndexes(raw, 'test-key');

      const entry = indexed.pathIndex.get('src/test.ts');
      expect(entry).toBeDefined();
      expect(entry?.fileId).toBe('file1');
      expect(entry?.functionIds).toContain('func1');
    });

    it('should build call adjacency lists', () => {
      const raw: any = {
        repo: 'test-repo',
        graph: {
          nodes: [
            {
              id: 'func1',
              labels: ['Function'],
              properties: { name: 'caller' },
            },
            {
              id: 'func2',
              labels: ['Function'],
              properties: { name: 'callee' },
            },
          ],
          relationships: [
            {
              id: 'rel1',
              type: 'calls',
              startNode: 'func1',
              endNode: 'func2',
              properties: {},
            },
          ],
        },
      };

      const indexed = buildIndexes(raw, 'test-key');

      const caller = indexed.callAdj.get('func1');
      expect(caller?.out).toContain('func2');

      const callee = indexed.callAdj.get('func2');
      expect(callee?.in).toContain('func1');
    });

    it('should build import adjacency lists', () => {
      const raw: any = {
        repo: 'test-repo',
        graph: {
          nodes: [
            {
              id: 'file1',
              labels: ['File'],
              properties: { name: 'index.ts' },
            },
            {
              id: 'file2',
              labels: ['File'],
              properties: { name: 'utils.ts' },
            },
          ],
          relationships: [
            {
              id: 'rel1',
              type: 'IMPORTS',
              startNode: 'file1',
              endNode: 'file2',
              properties: {},
            },
          ],
        },
      };

      const indexed = buildIndexes(raw, 'test-key');

      const importer = indexed.importAdj.get('file1');
      expect(importer?.out).toContain('file2');

      const imported = indexed.importAdj.get('file2');
      expect(imported?.in).toContain('file1');
    });

    it('should compute summary statistics', () => {
      const raw: any = {
        repo: 'test-repo',
        graph: {
          nodes: [
            { id: 'f1', labels: ['Function'], properties: {} },
            { id: 'f2', labels: ['Function'], properties: {} },
            { id: 'c1', labels: ['Class'], properties: {} },
          ],
          relationships: [
            { id: 'r1', type: 'calls', startNode: 'f1', endNode: 'f2', properties: {} },
          ],
        },
        summary: {
          filesProcessed: 5,
          primaryLanguage: 'typescript',
        },
      };

      const indexed = buildIndexes(raw, 'test-key');

      expect(indexed.summary.functions).toBe(2);
      expect(indexed.summary.classes).toBe(1);
      expect(indexed.summary.nodeCount).toBe(3);
      expect(indexed.summary.relationshipCount).toBe(1);
      expect(indexed.summary.primaryLanguage).toBe('typescript');
    });

    it('should set cache metadata', () => {
      const raw: any = {
        repo: 'test-repo',
        graph: { nodes: [], relationships: [] },
      };

      const indexed = buildIndexes(raw, 'test-key');

      expect(indexed.cacheKey).toBe('test-key');
      expect(indexed.cachedAt).toBeDefined();
    });
  });

  describe('normalizePath', () => {
    it('should convert backslashes to forward slashes', () => {
      expect(normalizePath('src\\utils\\test.ts')).toBe('src/utils/test.ts');
    });

    it('should leave forward slashes unchanged', () => {
      expect(normalizePath('src/utils/test.ts')).toBe('src/utils/test.ts');
    });

    it('should handle mixed slashes', () => {
      expect(normalizePath('src/utils\\test.ts')).toBe('src/utils/test.ts');
    });
  });

});

// Helper function to create mock indexed graph
function createMockIndexedGraph(cacheKey: string, nodeCount: number): any {
  return {
    raw: { graph: { nodes: [], relationships: [] } },
    nodeById: new Map(),
    labelIndex: new Map(),
    pathIndex: new Map(),
    dirIndex: new Map(),
    nameIndex: new Map(),
    callAdj: new Map(),
    importAdj: new Map(),
    domainIndex: new Map(),
    summary: {
      filesProcessed: 0,
      classes: 0,
      functions: 0,
      types: 0,
      domains: 0,
      primaryLanguage: 'typescript',
      nodeCount,
      relationshipCount: 0,
    },
    cachedAt: new Date().toISOString(),
    cacheKey,
  };
}
