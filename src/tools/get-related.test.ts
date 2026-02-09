import { describe, it, expect } from '@jest/globals';
import { buildIndexes } from '../cache/graph-cache';
import { findShortestPath } from './get-related';

// ── Helpers ──

function buildGraph(
  nodes: Array<{ id: string; labels: string[]; properties: Record<string, unknown> }>,
  relationships: Array<{ id: string; type: string; startNode: string; endNode: string; properties?: Record<string, unknown> }> = [],
) {
  const raw: any = {
    repo: 'test-repo',
    graph: { nodes, relationships: relationships.map(r => ({ ...r, properties: r.properties ?? {} })) },
  };
  return buildIndexes(raw, 'test-key');
}

// ── findShortestPath tests ──

describe('findShortestPath', () => {
  it('finds direct call between two functions', () => {
    const graph = buildGraph(
      [
        { id: 'a', labels: ['Function'], properties: { name: 'funcA', filePath: 'a.py', startLine: 1 } },
        { id: 'b', labels: ['Function'], properties: { name: 'funcB', filePath: 'b.py', startLine: 1 } },
      ],
      [
        { id: 'r1', type: 'calls', startNode: 'a', endNode: 'b' },
      ],
    );

    const sourceNodes = [graph.nodeById.get('a')!];
    const targetNodes = [graph.nodeById.get('b')!];
    const path = findShortestPath(graph, sourceNodes, targetNodes, 3);

    expect(path).not.toBeNull();
    expect(path!.length).toBe(2);
    expect(path![0].id).toBe('a');
    expect(path![1].id).toBe('b');
  });

  it('finds 2-hop path through intermediate function', () => {
    const graph = buildGraph(
      [
        { id: 'a', labels: ['Function'], properties: { name: 'funcA', filePath: 'a.py', startLine: 1 } },
        { id: 'bridge', labels: ['Function'], properties: { name: 'bridge', filePath: 'b.py', startLine: 1 } },
        { id: 'c', labels: ['Function'], properties: { name: 'funcC', filePath: 'c.py', startLine: 1 } },
      ],
      [
        { id: 'r1', type: 'calls', startNode: 'a', endNode: 'bridge' },
        { id: 'r2', type: 'calls', startNode: 'bridge', endNode: 'c' },
      ],
    );

    const path = findShortestPath(
      graph,
      [graph.nodeById.get('a')!],
      [graph.nodeById.get('c')!],
      3,
    );

    expect(path).not.toBeNull();
    expect(path!.length).toBe(3);
    expect(path![0].id).toBe('a');
    expect(path![1].id).toBe('bridge');
    expect(path![2].id).toBe('c');
  });

  it('returns null when no path exists within max_depth', () => {
    const graph = buildGraph(
      [
        { id: 'a', labels: ['Function'], properties: { name: 'funcA', filePath: 'a.py', startLine: 1 } },
        { id: 'b', labels: ['Function'], properties: { name: 'funcB', filePath: 'b.py', startLine: 1 } },
        { id: 'c', labels: ['Function'], properties: { name: 'funcC', filePath: 'c.py', startLine: 1 } },
        { id: 'd', labels: ['Function'], properties: { name: 'funcD', filePath: 'd.py', startLine: 1 } },
      ],
      [
        { id: 'r1', type: 'calls', startNode: 'a', endNode: 'b' },
        { id: 'r2', type: 'calls', startNode: 'b', endNode: 'c' },
        { id: 'r3', type: 'calls', startNode: 'c', endNode: 'd' },
      ],
    );

    // depth 2 can't reach 3-hop path
    const path = findShortestPath(
      graph,
      [graph.nodeById.get('a')!],
      [graph.nodeById.get('d')!],
      2,
    );

    expect(path).toBeNull();
  });

  it('returns null when targets are completely disconnected', () => {
    const graph = buildGraph([
      { id: 'a', labels: ['Function'], properties: { name: 'funcA', filePath: 'a.py', startLine: 1 } },
      { id: 'b', labels: ['Function'], properties: { name: 'funcB', filePath: 'b.py', startLine: 1 } },
    ]);

    const path = findShortestPath(
      graph,
      [graph.nodeById.get('a')!],
      [graph.nodeById.get('b')!],
      3,
    );

    expect(path).toBeNull();
  });

  it('finds path through reverse call edges (callee → caller)', () => {
    const graph = buildGraph(
      [
        { id: 'a', labels: ['Function'], properties: { name: 'funcA', filePath: 'a.py', startLine: 1 } },
        { id: 'b', labels: ['Function'], properties: { name: 'funcB', filePath: 'b.py', startLine: 1 } },
      ],
      [
        // b calls a — but we search from a to b, which should follow the in-edge
        { id: 'r1', type: 'calls', startNode: 'b', endNode: 'a' },
      ],
    );

    const path = findShortestPath(
      graph,
      [graph.nodeById.get('a')!],
      [graph.nodeById.get('b')!],
      3,
    );

    expect(path).not.toBeNull();
    expect(path!.length).toBe(2);
  });

  it('finds path through import edges', () => {
    const graph = buildGraph(
      [
        { id: 'f1', labels: ['File'], properties: { name: 'module_a', filePath: 'a.py' } },
        { id: 'f2', labels: ['File'], properties: { name: 'module_b', filePath: 'b.py' } },
      ],
      [
        { id: 'r1', type: 'IMPORTS', startNode: 'f1', endNode: 'f2' },
      ],
    );

    const path = findShortestPath(
      graph,
      [graph.nodeById.get('f1')!],
      [graph.nodeById.get('f2')!],
      3,
    );

    expect(path).not.toBeNull();
    expect(path!.length).toBe(2);
  });

  it('returns single node when source and target overlap', () => {
    const graph = buildGraph([
      { id: 'a', labels: ['Function'], properties: { name: 'funcA', filePath: 'a.py', startLine: 1 } },
    ]);

    const node = graph.nodeById.get('a')!;
    const path = findShortestPath(graph, [node], [node], 3);

    expect(path).not.toBeNull();
    expect(path!.length).toBe(1);
    expect(path![0].id).toBe('a');
  });

  it('picks shortest of multiple possible paths', () => {
    // a → bridge1 → c (2 hops)
    // a → x → y → c (3 hops)
    const graph = buildGraph(
      [
        { id: 'a', labels: ['Function'], properties: { name: 'a', filePath: 'a.py', startLine: 1 } },
        { id: 'bridge1', labels: ['Function'], properties: { name: 'bridge1', filePath: 'b.py', startLine: 1 } },
        { id: 'x', labels: ['Function'], properties: { name: 'x', filePath: 'x.py', startLine: 1 } },
        { id: 'y', labels: ['Function'], properties: { name: 'y', filePath: 'y.py', startLine: 1 } },
        { id: 'c', labels: ['Function'], properties: { name: 'c', filePath: 'c.py', startLine: 1 } },
      ],
      [
        { id: 'r1', type: 'calls', startNode: 'a', endNode: 'bridge1' },
        { id: 'r2', type: 'calls', startNode: 'bridge1', endNode: 'c' },
        { id: 'r3', type: 'calls', startNode: 'a', endNode: 'x' },
        { id: 'r4', type: 'calls', startNode: 'x', endNode: 'y' },
        { id: 'r5', type: 'calls', startNode: 'y', endNode: 'c' },
      ],
    );

    const path = findShortestPath(
      graph,
      [graph.nodeById.get('a')!],
      [graph.nodeById.get('c')!],
      3,
    );

    expect(path).not.toBeNull();
    // BFS guarantees shortest path
    expect(path!.length).toBe(3); // a → bridge1 → c
  });
});
