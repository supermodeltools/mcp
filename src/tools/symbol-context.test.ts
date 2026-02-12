import { describe, it, expect, afterAll } from '@jest/globals';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildIndexes } from '../cache/graph-cache';
import { findSymbol, renderSymbolContext, renderBriefSymbolContext, languageFromExtension } from './symbol-context';
import { MAX_SOURCE_LINES } from '../constants';

// ── Helpers ──

/** Build a minimal IndexedGraph from inline nodes + relationships */
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

// ── findSymbol tests (Issue #107) ──

describe('findSymbol', () => {
  it('query "filter" does NOT match symbol "f" (bidirectional bug regression)', () => {
    const graph = buildGraph([
      { id: 'f1', labels: ['Function'], properties: { name: 'f', filePath: 'a.py', startLine: 1 } },
      { id: 'f2', labels: ['Function'], properties: { name: 'filter', filePath: 'b.py', startLine: 1 } },
    ]);

    const results = findSymbol(graph, 'filter');
    const names = results.map(n => n.properties?.name);
    expect(names).toContain('filter');
    expect(names).not.toContain('f');
  });

  it('single-char query "f" finds exact match via Strategy 1, substring returns empty', () => {
    const graph = buildGraph([
      { id: 'f1', labels: ['Function'], properties: { name: 'f', filePath: 'a.py', startLine: 1 } },
      { id: 'f2', labels: ['Function'], properties: { name: 'filter', filePath: 'b.py', startLine: 1 } },
    ]);

    // Exact match works
    const exactResults = findSymbol(graph, 'f');
    expect(exactResults.length).toBe(1);
    expect(exactResults[0].properties?.name).toBe('f');

    // A single-char query that has no exact match returns nothing (no substring for len < 2)
    const noMatchResults = findSymbol(graph, 'x');
    expect(noMatchResults.length).toBe(0);
  });

  it('two functions named "filter" — one with 3 callers sorts before one with 0', () => {
    const graph = buildGraph(
      [
        { id: 'popular', labels: ['Function'], properties: { name: 'filter', filePath: 'a.py', startLine: 1 } },
        { id: 'lonely', labels: ['Function'], properties: { name: 'filter', filePath: 'b.py', startLine: 1 } },
        { id: 'c1', labels: ['Function'], properties: { name: 'caller1', filePath: 'c.py', startLine: 1 } },
        { id: 'c2', labels: ['Function'], properties: { name: 'caller2', filePath: 'c.py', startLine: 10 } },
        { id: 'c3', labels: ['Function'], properties: { name: 'caller3', filePath: 'c.py', startLine: 20 } },
      ],
      [
        { id: 'r1', type: 'calls', startNode: 'c1', endNode: 'popular' },
        { id: 'r2', type: 'calls', startNode: 'c2', endNode: 'popular' },
        { id: 'r3', type: 'calls', startNode: 'c3', endNode: 'popular' },
      ],
    );

    const results = findSymbol(graph, 'filter');
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('popular');
    expect(results[1].id).toBe('lonely');
  });

  it('substring "filt" ranks filter (3 callers) before filter_queryset (0 callers)', () => {
    const graph = buildGraph(
      [
        { id: 'fq', labels: ['Function'], properties: { name: 'filter_queryset', filePath: 'a.py', startLine: 1 } },
        { id: 'f', labels: ['Function'], properties: { name: 'filter', filePath: 'b.py', startLine: 1 } },
        { id: 'c1', labels: ['Function'], properties: { name: 'caller1', filePath: 'c.py', startLine: 1 } },
        { id: 'c2', labels: ['Function'], properties: { name: 'caller2', filePath: 'c.py', startLine: 10 } },
        { id: 'c3', labels: ['Function'], properties: { name: 'caller3', filePath: 'c.py', startLine: 20 } },
      ],
      [
        { id: 'r1', type: 'calls', startNode: 'c1', endNode: 'f' },
        { id: 'r2', type: 'calls', startNode: 'c2', endNode: 'f' },
        { id: 'r3', type: 'calls', startNode: 'c3', endNode: 'f' },
      ],
    );

    const results = findSymbol(graph, 'filt');
    const names = results.map(n => n.properties?.name);
    // Both start with "filt", same priority (Function), so callers break the tie
    expect(names.indexOf('filter')).toBeLessThan(names.indexOf('filter_queryset'));
  });

  it('"QuerySet.filter" finds filter in the same file as QuerySet class', () => {
    const graph = buildGraph([
      { id: 'qs', labels: ['Class'], properties: { name: 'QuerySet', filePath: 'models.py', startLine: 1 } },
      { id: 'f1', labels: ['Function'], properties: { name: 'filter', filePath: 'models.py', startLine: 50 } },
      { id: 'f2', labels: ['Function'], properties: { name: 'filter', filePath: 'other.py', startLine: 10 } },
    ]);

    const results = findSymbol(graph, 'QuerySet.filter');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('f1');
    expect(results[0].properties?.filePath).toBe('models.py');
  });
});

// ── renderSymbolContext + source code tests (Issue #108) ──

describe('renderSymbolContext', () => {
  const tmpDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(
      tmpDirs.map(dir => fs.rm(dir, { recursive: true, force: true }).catch(() => {}))
    );
  });

  it('includes fenced code block with source code', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'symbol-ctx-test-'));
    tmpDirs.push(tmpDir);
    const filePath = 'hello.py';
    await fs.writeFile(path.join(tmpDir, filePath), [
      'def hello():',
      '    print("hello world")',
      '',
    ].join('\n'));

    const graph = buildGraph([
      { id: 'fn1', labels: ['Function'], properties: { name: 'hello', filePath, startLine: 1, endLine: 2 } },
    ]);

    const result = await renderSymbolContext(graph, graph.nodeById.get('fn1')!, tmpDir);
    expect(result).toContain('```python');
    expect(result).toContain('def hello():');
    expect(result).toContain('print("hello world")');
    expect(result).toContain('```');
  });

  it('truncates files longer than MAX_SOURCE_LINES', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'symbol-ctx-test-'));
    tmpDirs.push(tmpDir);
    const filePath = 'big.py';
    const totalLines = MAX_SOURCE_LINES + 20;
    const fileContent = Array.from({ length: totalLines }, (_, i) => `    line_${i + 1}`);
    fileContent.unshift('def big_function():');
    await fs.writeFile(path.join(tmpDir, filePath), fileContent.join('\n'));

    const graph = buildGraph([
      { id: 'fn1', labels: ['Function'], properties: { name: 'big_function', filePath, startLine: 1, endLine: totalLines + 1 } },
    ]);

    const result = await renderSymbolContext(graph, graph.nodeById.get('fn1')!, tmpDir);
    expect(result).toContain('```python');
    expect(result).toContain('truncated');
    expect(result).toContain(`showing ${MAX_SOURCE_LINES} of`);
    // Should NOT contain the last line
    expect(result).not.toContain(`line_${totalLines}`);
  });

  it('non-existent file renders without error, no source section', async () => {
    const graph = buildGraph([
      { id: 'fn1', labels: ['Function'], properties: { name: 'ghost', filePath: 'does_not_exist.py', startLine: 1, endLine: 5 } },
    ]);

    const result = await renderSymbolContext(graph, graph.nodeById.get('fn1')!, '/nonexistent/dir');
    expect(result).toContain('## ghost');
    expect(result).not.toContain('```python');
    expect(result).not.toContain('### Source');
  });
});

// ── renderBriefSymbolContext tests ──

describe('renderBriefSymbolContext', () => {
  it('produces compact output without source code', () => {
    const graph = buildGraph(
      [
        { id: 'fn1', labels: ['Function'], properties: { name: 'process_data', filePath: 'pipeline.py', startLine: 10, endLine: 25, kind: 'function', language: 'python' } },
        { id: 'c1', labels: ['Function'], properties: { name: 'caller_a', filePath: 'a.py', startLine: 1 } },
        { id: 'c2', labels: ['Function'], properties: { name: 'caller_b', filePath: 'b.py', startLine: 1 } },
        { id: 'e1', labels: ['Function'], properties: { name: 'helper', filePath: 'h.py', startLine: 1 } },
      ],
      [
        { id: 'r1', type: 'calls', startNode: 'c1', endNode: 'fn1' },
        { id: 'r2', type: 'calls', startNode: 'c2', endNode: 'fn1' },
        { id: 'r3', type: 'calls', startNode: 'fn1', endNode: 'e1' },
      ],
    );

    const result = renderBriefSymbolContext(graph, graph.nodeById.get('fn1')!);
    expect(result).toContain('## process_data');
    expect(result).toContain('**Defined in:** pipeline.py:10-25');
    expect(result).toContain('**Type:** function (python)');
    expect(result).toContain('**Called by:**');
    expect(result).toContain('`caller_a`');
    expect(result).toContain('`caller_b`');
    expect(result).toContain('**Calls:**');
    expect(result).toContain('`helper`');
    // Must NOT contain source code
    expect(result).not.toContain('```');
    expect(result).not.toContain('### Source');
  });

  it('truncates callers/callees lists beyond MAX_BRIEF limits', () => {
    const nodes = [
      { id: 'fn1', labels: ['Function'], properties: { name: 'target', filePath: 'x.py', startLine: 1 } },
    ];
    const rels = [];
    // Create 7 callers
    for (let i = 0; i < 7; i++) {
      nodes.push({ id: `c${i}`, labels: ['Function'], properties: { name: `caller_${i}`, filePath: `c${i}.py`, startLine: 1 } });
      rels.push({ id: `r${i}`, type: 'calls', startNode: `c${i}`, endNode: 'fn1' });
    }
    // Create 7 callees
    for (let i = 0; i < 7; i++) {
      nodes.push({ id: `e${i}`, labels: ['Function'], properties: { name: `callee_${i}`, filePath: `e${i}.py`, startLine: 1 } });
      rels.push({ id: `re${i}`, type: 'calls', startNode: 'fn1', endNode: `e${i}` });
    }

    const graph = buildGraph(nodes, rels);
    const result = renderBriefSymbolContext(graph, graph.nodeById.get('fn1')!);

    // Should show "total" count indicators
    expect(result).toContain('7 total');
    // Should NOT have more than 5 caller names listed
    expect(result).not.toContain('`caller_5`');
    expect(result).not.toContain('`callee_5`');
  });
});

// ── languageFromExtension tests ──

describe('languageFromExtension', () => {
  it('returns correct languages for common extensions', () => {
    expect(languageFromExtension('file.py')).toBe('python');
    expect(languageFromExtension('file.ts')).toBe('typescript');
    expect(languageFromExtension('file.tsx')).toBe('typescript');
    expect(languageFromExtension('file.js')).toBe('javascript');
    expect(languageFromExtension('file.go')).toBe('go');
    expect(languageFromExtension('file.rs')).toBe('rust');
    expect(languageFromExtension('file.java')).toBe('java');
    expect(languageFromExtension('file.rb')).toBe('ruby');
    expect(languageFromExtension('file.cpp')).toBe('cpp');
    expect(languageFromExtension('file.c')).toBe('c');
  });

  it('returns empty string for unknown extensions', () => {
    expect(languageFromExtension('file.xyz')).toBe('');
    expect(languageFromExtension('Makefile')).toBe('');
  });
});
