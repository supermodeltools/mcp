import { describe, it, expect } from '@jest/globals';
import { renderSupermodelMd } from './generate';
import { IndexedGraph } from './cache/graph-cache';

describe('generate', () => {
  describe('renderSupermodelMd', () => {
    it('should produce output under 50KB', () => {
      const graph = createRichMockGraph();
      const md = renderSupermodelMd(graph);
      const sizeBytes = Buffer.byteLength(md, 'utf-8');
      expect(sizeBytes).toBeLessThan(50 * 1024);
    });

    it('should include all sections for a rich graph', () => {
      const graph = createRichMockGraph();
      const md = renderSupermodelMd(graph);

      expect(md).toContain('# ');             // Header
      expect(md).toContain('## Domains');
      expect(md).toContain('## Hub Functions');
      expect(md).toContain('## Symbol Index');
      expect(md).toContain('### Classes');
      expect(md).toContain('### Functions');
      expect(md).toContain('## Call Graph Hotspots');
      expect(md).toContain('## File Map');
      expect(md).toContain('## Import Graph');
      expect(md).toContain('## Test Map');
    });

    it('should include file:line references', () => {
      const graph = createRichMockGraph();
      const md = renderSupermodelMd(graph);
      // file:line pattern like "src/foo.py:10"
      expect(md).toMatch(/\w+\.\w+:\d+/);
    });

    it('should render header with summary stats', () => {
      const graph = createRichMockGraph();
      const md = renderSupermodelMd(graph);

      expect(md).toContain('| Files |');
      expect(md).toContain('| Functions |');
      expect(md).toContain('| Classes |');
      expect(md).toContain('| Language |');
    });

    it('should render hub functions as a table', () => {
      const graph = createRichMockGraph();
      const md = renderSupermodelMd(graph);

      expect(md).toContain('| Function | Location | Callers | Callees | Domain |');
    });

    it('should render import graph as a table', () => {
      const graph = createRichMockGraph();
      const md = renderSupermodelMd(graph);

      expect(md).toContain('| File | Imported By | Imports |');
    });

    it('should render test map with source-to-test mappings', () => {
      const graph = createRichMockGraph();
      const md = renderSupermodelMd(graph);

      expect(md).toContain('| Source File | Test File |');
      // Should map test_auth.py -> auth.py
      expect(md).toContain('src/auth.py');
      expect(md).toContain('tests/test_auth.py');
    });

    it('should handle empty graph gracefully', () => {
      const graph = createEmptyMockGraph();
      const md = renderSupermodelMd(graph);

      // Should still have a header
      expect(md).toContain('# ');
      // Should not crash or produce garbage
      expect(md.length).toBeGreaterThan(0);
    });

    it('should handle graph with no domains', () => {
      const graph = createNoDomainMockGraph();
      const md = renderSupermodelMd(graph);

      expect(md).not.toContain('## Domains');
      // Should still render other sections
      expect(md).toContain('## Hub Functions');
    });

    it('should render call graph hotspots with callers and callees', () => {
      const graph = createRichMockGraph();
      const md = renderSupermodelMd(graph);

      expect(md).toContain('**Callers:**');
      expect(md).toContain('**Callees:**');
    });

    it('should render file map grouped by domain', () => {
      const graph = createRichMockGraph();
      const md = renderSupermodelMd(graph);

      // Should show domain names as subsections in file map
      expect(md).toContain('### Auth');
    });
  });
});

// ─── Mock graph builders ─────────────────────────────────────────────────────

function createEmptyMockGraph(): IndexedGraph {
  return {
    raw: { graph: { nodes: [], relationships: [] } } as any,
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
      primaryLanguage: 'unknown',
      nodeCount: 0,
      relationshipCount: 0,
    },
    cachedAt: new Date().toISOString(),
    cacheKey: 'test-empty',
  };
}

function createNoDomainMockGraph(): IndexedGraph {
  const nodeById = new Map<string, any>();
  const labelIndex = new Map<string, string[]>();
  const pathIndex = new Map<string, any>();
  const nameIndex = new Map<string, string[]>();
  const callAdj = new Map<string, any>();
  const importAdj = new Map<string, any>();

  // Add some functions with callers
  const funcIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const id = `func${i}`;
    funcIds.push(id);
    nodeById.set(id, {
      id,
      labels: ['Function'],
      properties: { name: `func${i}`, filePath: `src/module${i}.ts`, startLine: 10 + i },
    });
    nameIndex.set(`func${i}`, [id]);
    callAdj.set(id, { out: [], in: [] });
  }
  labelIndex.set('Function', funcIds);

  // Create call edges: func0 is called by func1..func5
  for (let i = 1; i <= 5; i++) {
    callAdj.get(`func0`)!.in.push(`func${i}`);
    callAdj.get(`func${i}`)!.out.push('func0');
  }
  // func1 is called by func6..func8
  for (let i = 6; i <= 8; i++) {
    callAdj.get(`func1`)!.in.push(`func${i}`);
    callAdj.get(`func${i}`)!.out.push('func1');
  }

  // Add files
  const fileIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const id = `file${i}`;
    fileIds.push(id);
    nodeById.set(id, {
      id,
      labels: ['File'],
      properties: { filePath: `src/module${i}.ts`, name: `module${i}.ts` },
    });
    pathIndex.set(`src/module${i}.ts`, {
      fileId: id,
      classIds: [],
      functionIds: [`func${i}`],
      typeIds: [],
    });
    importAdj.set(id, { out: [], in: [] });
  }
  labelIndex.set('File', fileIds);

  // Import edges: file0 imported by file1..file4
  for (let i = 1; i <= 4; i++) {
    importAdj.get(`file0`)!.in.push(`file${i}`);
    importAdj.get(`file${i}`)!.out.push('file0');
  }

  return {
    raw: { graph: { nodes: [], relationships: [] } } as any,
    nodeById,
    labelIndex,
    pathIndex,
    dirIndex: new Map(),
    nameIndex,
    callAdj,
    importAdj,
    domainIndex: new Map(),
    summary: {
      filesProcessed: 10,
      classes: 0,
      functions: 10,
      types: 0,
      domains: 0,
      primaryLanguage: 'typescript',
      nodeCount: 20,
      relationshipCount: 8,
    },
    cachedAt: new Date().toISOString(),
    cacheKey: 'test-no-domain',
  };
}

function createRichMockGraph(): IndexedGraph {
  const nodeById = new Map<string, any>();
  const labelIndex = new Map<string, string[]>();
  const pathIndex = new Map<string, any>();
  const nameIndex = new Map<string, string[]>();
  const callAdj = new Map<string, any>();
  const importAdj = new Map<string, any>();
  const domainIndex = new Map<string, any>();

  const funcIds: string[] = [];
  const classIds: string[] = [];
  const fileIds: string[] = [];
  const domainIds: string[] = [];

  // Create domains
  for (const domainName of ['Auth', 'Database', 'API']) {
    const id = `domain_${domainName.toLowerCase()}`;
    domainIds.push(id);
    nodeById.set(id, {
      id,
      labels: ['Domain'],
      properties: { name: domainName, description: `The ${domainName} domain handles all ${domainName.toLowerCase()}-related logic` },
    });
    nameIndex.set(domainName.toLowerCase(), [id]);
    domainIndex.set(domainName, { memberIds: [], relationships: [] });
  }
  labelIndex.set('Domain', domainIds);

  // Create classes
  for (let i = 0; i < 5; i++) {
    const id = `class${i}`;
    classIds.push(id);
    const filePath = i < 2 ? 'src/auth.py' : i < 4 ? 'src/db.py' : 'src/api.py';
    nodeById.set(id, {
      id,
      labels: ['Class'],
      properties: { name: `Class${i}`, filePath, startLine: 10 + i * 20 },
    });
    nameIndex.set(`class${i}`, [id]);

    // Assign to domain
    const domain = i < 2 ? 'Auth' : i < 4 ? 'Database' : 'API';
    domainIndex.get(domain)!.memberIds.push(id);
  }
  labelIndex.set('Class', classIds);

  // Create functions (20 functions across files)
  const fileNames = ['src/auth.py', 'src/db.py', 'src/api.py', 'src/utils.py', 'src/models.py'];
  for (let i = 0; i < 20; i++) {
    const id = `func${i}`;
    funcIds.push(id);
    const filePath = fileNames[i % fileNames.length];
    nodeById.set(id, {
      id,
      labels: ['Function'],
      properties: { name: `function_${i}`, filePath, startLine: 10 + i * 5 },
    });
    nameIndex.set(`function_${i}`, [id]);
    callAdj.set(id, { out: [], in: [] });

    // Assign to domain
    const domainName = i % 5 < 2 ? 'Auth' : i % 5 < 4 ? 'Database' : 'API';
    domainIndex.get(domainName)!.memberIds.push(id);
  }
  labelIndex.set('Function', funcIds);

  // Create call edges -- func0 is called by many others (hub)
  for (let i = 1; i <= 10; i++) {
    callAdj.get('func0')!.in.push(`func${i}`);
    callAdj.get(`func${i}`)!.out.push('func0');
  }
  // func0 calls func11..func14
  for (let i = 11; i <= 14; i++) {
    callAdj.get('func0')!.out.push(`func${i}`);
    callAdj.get(`func${i}`)!.in.push('func0');
  }
  // func1 is also a hub
  for (let i = 5; i <= 12; i++) {
    if (i === 1) continue;
    callAdj.get('func1')!.in.push(`func${i}`);
    callAdj.get(`func${i}`)!.out.push('func1');
  }
  // func2 has some callers
  for (let i = 10; i <= 15; i++) {
    callAdj.get('func2')!.in.push(`func${i}`);
    callAdj.get(`func${i}`)!.out.push('func2');
  }

  // Create files
  for (const fp of fileNames) {
    const id = `file_${fp.replace(/[\/\.]/g, '_')}`;
    fileIds.push(id);
    nodeById.set(id, {
      id,
      labels: ['File'],
      properties: { filePath: fp, name: fp.split('/').pop() },
    });
    importAdj.set(id, { out: [], in: [] });

    // Populate pathIndex
    const funcsInFile = funcIds.filter(fid => nodeById.get(fid)?.properties?.filePath === fp);
    const classesInFile = classIds.filter(cid => nodeById.get(cid)?.properties?.filePath === fp);
    pathIndex.set(fp, {
      fileId: id,
      classIds: classesInFile,
      functionIds: funcsInFile,
      typeIds: [],
    });
  }

  // Add test files
  const testFiles = ['tests/test_auth.py', 'tests/test_db.py', 'tests/test_api.py'];
  for (const fp of testFiles) {
    const id = `file_${fp.replace(/[\/\.]/g, '_')}`;
    fileIds.push(id);
    nodeById.set(id, {
      id,
      labels: ['File'],
      properties: { filePath: fp, name: fp.split('/').pop() },
    });
    importAdj.set(id, { out: [], in: [] });
    pathIndex.set(fp, {
      fileId: id,
      classIds: [],
      functionIds: [],
      typeIds: [],
    });
  }
  labelIndex.set('File', fileIds);

  // Import edges: auth.py is imported by many
  const authFileId = `file_src_auth_py`;
  for (let i = 1; i < fileIds.length; i++) {
    if (fileIds[i] === authFileId) continue;
    importAdj.get(authFileId)!.in.push(fileIds[i]);
    const adj = importAdj.get(fileIds[i]);
    if (adj) adj.out.push(authFileId);
  }

  return {
    raw: { repo: 'test-repo', graph: { nodes: [], relationships: [] } } as any,
    nodeById,
    labelIndex,
    pathIndex,
    dirIndex: new Map(),
    nameIndex,
    callAdj,
    importAdj,
    domainIndex,
    summary: {
      filesProcessed: fileNames.length + testFiles.length,
      classes: classIds.length,
      functions: funcIds.length,
      types: 0,
      domains: 3,
      primaryLanguage: 'python',
      nodeCount: nodeById.size,
      relationshipCount: 30,
    },
    cachedAt: new Date().toISOString(),
    cacheKey: 'test-rich',
  };
}
