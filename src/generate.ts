/**
 * `generate` subcommand -- produce a static Supermodel.md file from an IndexedGraph.
 *
 * The generated markdown contains the most valuable graph data so that an
 * AI agent can read it once with a native `Read` tool and use native tools
 * (Grep, Glob, Read) from there -- all parallelizable within a single turn.
 *
 * Usage:
 *   node dist/index.js generate <directory> [--output <path>] [--cache-dir <dir>]
 *
 * @module generate
 */

import { IndexedGraph, normalizePath } from './cache/graph-cache';
import {
  MAX_GENERATE_HUB_FUNCTIONS,
  MAX_GENERATE_SYMBOL_CLASSES,
  MAX_GENERATE_SYMBOL_FUNCTIONS,
  MAX_GENERATE_HOTSPOTS,
  MAX_GENERATE_HOTSPOT_EDGES,
  MAX_GENERATE_FILE_MAP_FILES,
  MAX_GENERATE_IMPORT_FILES,
  MAX_GENERATE_TEST_MAP,
  MAX_OVERVIEW_DOMAINS,
  DEFAULT_API_TIMEOUT_MS,
  CONNECTION_TIMEOUT_MS,
} from './constants';

// ─── Renderer ────────────────────────────────────────────────────────────────

/**
 * Render an IndexedGraph to a structured Supermodel.md string.
 *
 * Sections: Header, Domains, Hub Functions, Symbol Index, Call Graph Hotspots,
 * File Map, Import Graph, Test Map.
 */
export function renderSupermodelMd(graph: IndexedGraph): string {
  const sections: string[] = [];

  sections.push(renderHeader(graph));
  sections.push(renderDomains(graph));
  sections.push(renderHubFunctions(graph));
  sections.push(renderSymbolIndex(graph));
  sections.push(renderCallGraphHotspots(graph));
  sections.push(renderFileMap(graph));
  sections.push(renderImportGraph(graph));
  sections.push(renderTestMap(graph));

  return sections.filter(Boolean).join('\n');
}

// ─── Section renderers ───────────────────────────────────────────────────────

function renderHeader(graph: IndexedGraph): string {
  const s = graph.summary;
  const repoName = graph.raw.repo ? graph.raw.repo.substring(0, 8) : 'Codebase';
  const lines: string[] = [];
  lines.push(`# ${repoName}`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Files | ${s.filesProcessed} |`);
  lines.push(`| Functions | ${s.functions} |`);
  lines.push(`| Classes | ${s.classes} |`);
  lines.push(`| Language | ${s.primaryLanguage} |`);
  lines.push(`| Nodes | ${s.nodeCount} |`);
  lines.push(`| Relationships | ${s.relationshipCount} |`);
  lines.push('');
  return lines.join('\n');
}

function renderDomains(graph: IndexedGraph): string {
  if (graph.domainIndex.size === 0) return '';

  const lines: string[] = [];
  lines.push('## Domains');
  lines.push('');

  const domains = [...graph.domainIndex.entries()]
    .map(([name, data]) => ({ name, memberCount: data.memberIds.length, memberIds: data.memberIds }))
    .sort((a, b) => b.memberCount - a.memberCount)
    .slice(0, MAX_OVERVIEW_DOMAINS);

  for (const domain of domains) {
    // Get description from domain node
    const domainNodes = graph.nameIndex.get(domain.name.toLowerCase()) || [];
    let desc = '';
    for (const nid of domainNodes) {
      const node = graph.nodeById.get(nid);
      if (node?.labels?.[0] === 'Domain') {
        desc = (node.properties?.description as string) || '';
        break;
      }
    }
    const descStr = desc ? `: ${truncate(desc, 120)}` : '';

    // Key files for domain
    const keyFiles = getKeyFilesForDomain(graph, domain.memberIds);
    const filesStr = keyFiles.length > 0 ? `\n  Key files: ${keyFiles.join(', ')}` : '';

    lines.push(`- **${domain.name}** (${domain.memberCount} members)${descStr}${filesStr}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderHubFunctions(graph: IndexedGraph): string {
  const hubs = getHubFunctions(graph, MAX_GENERATE_HUB_FUNCTIONS);
  if (hubs.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Hub Functions');
  lines.push('');
  lines.push('| Function | Location | Callers | Callees | Domain |');
  lines.push('|----------|----------|---------|---------|--------|');

  for (const hub of hubs) {
    const domain = getDomainForNode(graph, hub.nodeId) || '';
    lines.push(`| \`${hub.name}\` | ${hub.filePath}:${hub.line} | ${hub.callerCount} | ${hub.calleeCount} | ${domain} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderSymbolIndex(graph: IndexedGraph): string {
  const lines: string[] = [];
  lines.push('## Symbol Index');
  lines.push('');

  // Top classes by caller count (how many functions call into their methods)
  const classIds = graph.labelIndex.get('Class') || [];
  if (classIds.length > 0) {
    const classEntries = classIds
      .map(id => {
        const node = graph.nodeById.get(id);
        if (!node) return null;
        const name = node.properties?.name as string;
        const filePath = node.properties?.filePath as string;
        const line = node.properties?.startLine as number;
        if (!name || !filePath) return null;

        // Count callers across all methods in this class
        const methodCallers = countClassCallers(graph, id);
        return { name, filePath: normalizePath(filePath), line: line || 0, callers: methodCallers };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => b.callers - a.callers)
      .slice(0, MAX_GENERATE_SYMBOL_CLASSES);

    if (classEntries.length > 0) {
      lines.push('### Classes');
      lines.push('');
      lines.push('| Class | Location | Method Callers |');
      lines.push('|-------|----------|----------------|');
      for (const cls of classEntries) {
        lines.push(`| \`${cls.name}\` | ${cls.filePath}:${cls.line} | ${cls.callers} |`);
      }
      lines.push('');
    }
  }

  // Top functions by caller count
  const funcEntries = getHubFunctions(graph, MAX_GENERATE_SYMBOL_FUNCTIONS);
  if (funcEntries.length > 0) {
    lines.push('### Functions');
    lines.push('');
    lines.push('| Function | Location | Callers |');
    lines.push('|----------|----------|---------|');
    for (const fn of funcEntries) {
      lines.push(`| \`${fn.name}\` | ${fn.filePath}:${fn.line} | ${fn.callerCount} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderCallGraphHotspots(graph: IndexedGraph): string {
  const hubs = getHubFunctions(graph, MAX_GENERATE_HOTSPOTS);
  if (hubs.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Call Graph Hotspots');
  lines.push('');

  for (const hub of hubs) {
    lines.push(`### \`${hub.name}\` (${hub.filePath}:${hub.line})`);
    lines.push('');

    // Callers
    const callerNames = resolveNodeNames(graph, hub.callerIds.slice(0, MAX_GENERATE_HOTSPOT_EDGES));
    if (callerNames.length > 0) {
      lines.push(`**Callers:** ${callerNames.map(c => `\`${c.name}\` (${c.filePath}:${c.line})`).join(', ')}`);
    }

    // Callees
    const calleeNames = resolveNodeNames(graph, hub.calleeIds.slice(0, MAX_GENERATE_HOTSPOT_EDGES));
    if (calleeNames.length > 0) {
      lines.push(`**Callees:** ${calleeNames.map(c => `\`${c.name}\` (${c.filePath}:${c.line})`).join(', ')}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

function renderFileMap(graph: IndexedGraph): string {
  if (graph.domainIndex.size === 0 && graph.pathIndex.size === 0) return '';

  const lines: string[] = [];
  lines.push('## File Map');
  lines.push('');

  if (graph.domainIndex.size > 0) {
    // Group files by domain
    const domainFiles = new Map<string, { path: string; symbolCount: number }[]>();

    for (const [name, data] of graph.domainIndex) {
      const files = new Map<string, number>();
      for (const memberId of data.memberIds) {
        const node = graph.nodeById.get(memberId);
        const fp = node?.properties?.filePath as string;
        if (fp) {
          const normalized = normalizePath(fp);
          files.set(normalized, (files.get(normalized) || 0) + 1);
        }
      }
      const sorted = [...files.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([path, count]) => ({ path, symbolCount: count }));
      if (sorted.length > 0) {
        domainFiles.set(name, sorted);
      }
    }

    // Sort domains by total file count
    const sortedDomains = [...domainFiles.entries()]
      .sort((a, b) => b[1].length - a[1].length);

    let totalFiles = 0;
    for (const [domain, files] of sortedDomains) {
      if (totalFiles >= MAX_GENERATE_FILE_MAP_FILES) break;

      lines.push(`### ${domain}`);
      lines.push('');
      const remaining = MAX_GENERATE_FILE_MAP_FILES - totalFiles;
      const filesToShow = files.slice(0, remaining);
      for (const f of filesToShow) {
        lines.push(`- ${f.path} (${f.symbolCount} symbols)`);
      }
      totalFiles += filesToShow.length;
      if (files.length > filesToShow.length) {
        lines.push(`- ... and ${files.length - filesToShow.length} more files`);
      }
      lines.push('');
    }
  } else {
    // No domains -- just list files by symbol count
    const fileEntries = [...graph.pathIndex.entries()]
      .map(([path, entry]) => ({
        path,
        symbolCount: entry.classIds.length + entry.functionIds.length + entry.typeIds.length,
      }))
      .sort((a, b) => b.symbolCount - a.symbolCount)
      .slice(0, MAX_GENERATE_FILE_MAP_FILES);

    for (const f of fileEntries) {
      lines.push(`- ${f.path} (${f.symbolCount} symbols)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderImportGraph(graph: IndexedGraph): string {
  // Find files with the most importers (in-degree)
  const importEntries: { path: string; importers: number; imports: number }[] = [];

  for (const [nodeId, adj] of graph.importAdj) {
    const node = graph.nodeById.get(nodeId);
    if (!node) continue;
    const label = node.labels?.[0];
    if (label !== 'File' && label !== 'LocalModule') continue;

    const filePath = (node.properties?.filePath as string) || (node.properties?.name as string) || '';
    if (!filePath) continue;

    importEntries.push({
      path: normalizePath(filePath),
      importers: adj.in.length,
      imports: adj.out.length,
    });
  }

  if (importEntries.length === 0) return '';

  importEntries.sort((a, b) => b.importers - a.importers);
  const top = importEntries.slice(0, MAX_GENERATE_IMPORT_FILES);

  const lines: string[] = [];
  lines.push('## Import Graph');
  lines.push('');
  lines.push('| File | Imported By | Imports |');
  lines.push('|------|------------|---------|');
  for (const entry of top) {
    lines.push(`| ${entry.path} | ${entry.importers} | ${entry.imports} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderTestMap(graph: IndexedGraph): string {
  // Heuristic: match test files to source files by naming convention
  const testFiles: string[] = [];
  const sourceFiles: string[] = [];

  for (const [path] of graph.pathIndex) {
    if (isTestFile(path)) {
      testFiles.push(path);
    } else {
      sourceFiles.push(path);
    }
  }

  if (testFiles.length === 0) return '';

  const mappings: { source: string; test: string }[] = [];

  for (const testPath of testFiles) {
    const sourcePath = inferSourceFile(testPath, sourceFiles);
    if (sourcePath) {
      mappings.push({ source: sourcePath, test: testPath });
    }
  }

  if (mappings.length === 0) return '';

  mappings.sort((a, b) => a.source.localeCompare(b.source));
  const top = mappings.slice(0, MAX_GENERATE_TEST_MAP);

  const lines: string[] = [];
  lines.push('## Test Map');
  lines.push('');
  lines.push('| Source File | Test File |');
  lines.push('|------------|-----------|');
  for (const m of top) {
    lines.push(`| ${m.source} | ${m.test} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface HubEntry {
  nodeId: string;
  name: string;
  filePath: string;
  line: number;
  callerCount: number;
  calleeCount: number;
  callerIds: string[];
  calleeIds: string[];
}

function getHubFunctions(graph: IndexedGraph, limit: number): HubEntry[] {
  const hubs: HubEntry[] = [];

  for (const [nodeId, adj] of graph.callAdj) {
    if (adj.in.length < 2) continue;

    const node = graph.nodeById.get(nodeId);
    if (!node) continue;

    const name = node.properties?.name as string;
    const filePath = node.properties?.filePath as string;
    const line = node.properties?.startLine as number;
    if (!name || !filePath) continue;

    hubs.push({
      nodeId,
      name,
      filePath: normalizePath(filePath),
      line: line || 0,
      callerCount: adj.in.length,
      calleeCount: adj.out.length,
      callerIds: adj.in,
      calleeIds: adj.out,
    });
  }

  hubs.sort((a, b) => b.callerCount - a.callerCount);
  return hubs.slice(0, limit);
}

function getKeyFilesForDomain(graph: IndexedGraph, memberIds: string[]): string[] {
  const pathCounts = new Map<string, number>();
  for (const id of memberIds) {
    const node = graph.nodeById.get(id);
    if (!node) continue;
    const fp = node.properties?.filePath as string;
    if (fp) {
      const normalized = normalizePath(fp);
      pathCounts.set(normalized, (pathCounts.get(normalized) || 0) + 1);
    }
  }
  return [...pathCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([p]) => p);
}

function getDomainForNode(graph: IndexedGraph, nodeId: string): string | null {
  for (const [name, data] of graph.domainIndex) {
    if (data.memberIds.includes(nodeId)) return name;
  }
  return null;
}

function countClassCallers(graph: IndexedGraph, classId: string): number {
  const node = graph.nodeById.get(classId);
  if (!node) return 0;

  const filePath = node.properties?.filePath as string;
  const className = node.properties?.name as string;
  if (!filePath || !className) return 0;

  // Find functions in the same file that might be methods of this class
  const normalized = normalizePath(filePath);
  const pathEntry = graph.pathIndex.get(normalized);
  if (!pathEntry) return 0;

  let totalCallers = 0;
  for (const funcId of pathEntry.functionIds) {
    const funcNode = graph.nodeById.get(funcId);
    if (!funcNode) continue;

    // Heuristic: function is a method if its name contains the class name or
    // if it's in the same file. This is a rough approximation.
    const adj = graph.callAdj.get(funcId);
    if (adj) {
      totalCallers += adj.in.length;
    }
  }

  return totalCallers;
}

function resolveNodeNames(graph: IndexedGraph, nodeIds: string[]): { name: string; filePath: string; line: number }[] {
  const results: { name: string; filePath: string; line: number }[] = [];
  for (const id of nodeIds) {
    const node = graph.nodeById.get(id);
    if (!node) continue;
    const name = node.properties?.name as string;
    const filePath = node.properties?.filePath as string;
    const line = node.properties?.startLine as number;
    if (name && filePath) {
      results.push({ name, filePath: normalizePath(filePath), line: line || 0 });
    }
  }
  return results;
}

function isTestFile(path: string): boolean {
  const lower = path.toLowerCase();
  // Common test file patterns
  return (
    lower.includes('/test/') ||
    lower.includes('/tests/') ||
    lower.includes('/__tests__/') ||
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.includes('_test.') ||
    lower.match(/\/test_[^\/]+$/) !== null
  );
}

function inferSourceFile(testPath: string, sourceFiles: string[]): string | null {
  // Extract the base name and try common transformations
  const parts = testPath.split('/');
  const fileName = parts[parts.length - 1];

  // Remove test prefixes/suffixes
  const candidates: string[] = [];

  // test_foo.py -> foo.py
  if (fileName.startsWith('test_')) {
    candidates.push(fileName.substring(5));
  }
  // foo_test.py -> foo.py
  if (fileName.includes('_test.')) {
    candidates.push(fileName.replace('_test.', '.'));
  }
  // foo.test.ts -> foo.ts
  if (fileName.includes('.test.')) {
    candidates.push(fileName.replace('.test.', '.'));
  }
  // foo.spec.ts -> foo.spec
  if (fileName.includes('.spec.')) {
    candidates.push(fileName.replace('.spec.', '.'));
  }
  // test/test_foo.py -> try matching to foo.py in src/
  // tests/foo_test.go -> try matching to foo.go in src/

  if (candidates.length === 0) return null;

  // Try to find a source file matching any candidate
  for (const candidate of candidates) {
    const match = sourceFiles.find(sf => {
      const sfParts = sf.split('/');
      return sfParts[sfParts.length - 1] === candidate;
    });
    if (match) return match;
  }

  return null;
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen - 3) + '...';
}

// ─── CLI Handler ─────────────────────────────────────────────────────────────

/**
 * Handle the `generate` subcommand.
 * Parses args, loads/creates graph, calls renderSupermodelMd, writes output.
 */
export async function handleGenerate(args: string[]) {
  if (args.length === 0) {
    console.error('Usage: supermodel-mcp generate <directory> [--output <path>] [--cache-dir <dir>]');
    console.error('');
    console.error('Generate a Supermodel.md file from a code graph.');
    console.error('');
    console.error('Options:');
    console.error('  --output <path>      Output file path (default: <directory>/Supermodel.md)');
    console.error('  --cache-dir <dir>    Directory with pre-computed graph cache');
    console.error('');
    console.error('Environment:');
    console.error('  SUPERMODEL_API_KEY   Required if no cached graph exists.');
    console.error('  SUPERMODEL_CACHE_DIR Alternative to --cache-dir.');
    process.exit(1);
  }

  // Parse args
  let directory = '';
  let outputPath = '';
  let cacheDir = process.env.SUPERMODEL_CACHE_DIR || '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && i + 1 < args.length) {
      outputPath = args[++i];
    } else if (args[i] === '--cache-dir' && i + 1 < args.length) {
      cacheDir = args[++i];
    } else if (!args[i].startsWith('--')) {
      directory = args[i];
    }
  }

  if (!directory) {
    console.error('Error: directory argument is required');
    process.exit(1);
  }

  const { resolve, basename, join } = require('path');
  const { execSync } = require('child_process');
  const { existsSync } = require('fs');
  const { writeFile, readFile, mkdir } = require('fs/promises');
  const resolvedDir = resolve(directory);

  if (!outputPath) {
    outputPath = join(resolvedDir, 'Supermodel.md');
  }

  // Detect repo name
  let detectedName = basename(resolvedDir);
  try {
    const remote = execSync('git remote get-url origin', {
      cwd: resolvedDir, encoding: 'utf-8', timeout: 2000,
    }).trim();
    const match = remote.match(/\/([^\/]+?)(?:\.git)?$/);
    if (match) detectedName = match[1];
  } catch {}

  // Get commit hash
  let commitHash = '';
  try {
    commitHash = execSync('git rev-parse --short HEAD', {
      cwd: resolvedDir, encoding: 'utf-8', timeout: 2000,
    }).trim();
  } catch {}

  const name = commitHash ? `${detectedName}_${commitHash}` : detectedName;

  // Try loading from cache first
  const { buildIndexes, loadCacheFromDisk, saveCacheToDisk, sanitizeFileName, GraphCache } = require('./cache/graph-cache');

  let graph: IndexedGraph | null = null;

  if (cacheDir) {
    console.error(`Looking for cached graph in: ${cacheDir}`);
    const tempCache = new GraphCache();
    const repoMap = await loadCacheFromDisk(cacheDir, tempCache);

    if (repoMap.size > 0) {
      // Try to find matching graph
      const lowerName = detectedName.toLowerCase();
      graph = repoMap.get(lowerName) || null;

      if (!graph && commitHash) {
        graph = repoMap.get(`commit:${commitHash}`) || null;
      }

      // If only one graph, use it
      if (!graph && repoMap.size <= 3) {
        const uniqueGraphs = new Set([...repoMap.values()]);
        if (uniqueGraphs.size === 1) {
          graph = [...uniqueGraphs][0];
        }
      }

      if (graph) {
        console.error(`Found cached graph: ${graph.summary.nodeCount} nodes`);
      }
    }
  }

  // If no cache, call API
  if (!graph) {
    if (!process.env.SUPERMODEL_API_KEY) {
      console.error('Error: No cached graph found and SUPERMODEL_API_KEY not set.');
      console.error('Either provide a --cache-dir with a pre-computed graph or set SUPERMODEL_API_KEY.');
      process.exit(1);
    }

    console.error(`Generating graph for: ${resolvedDir}`);

    const { Configuration, DefaultApi, SupermodelClient } = require('@supermodeltools/sdk');
    const { zipRepository } = require('./utils/zip-repository');
    const { Blob } = require('buffer');
    const { generateIdempotencyKey } = require('./utils/api-helpers');
    const { Agent } = require('undici');

    const parsedTimeout = parseInt(process.env.SUPERMODEL_TIMEOUT_MS || '', 10);
    const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_API_TIMEOUT_MS;

    const httpAgent = new Agent({
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      connectTimeout: CONNECTION_TIMEOUT_MS,
    });

    const fetchWithTimeout: typeof fetch = (url: any, init: any) => {
      return fetch(url, { ...init, dispatcher: httpAgent } as any);
    };

    const config = new Configuration({
      basePath: process.env.SUPERMODEL_BASE_URL || 'https://api.supermodeltools.com',
      apiKey: process.env.SUPERMODEL_API_KEY,
      fetchApi: fetchWithTimeout,
    });

    const api = new DefaultApi(config);
    const client = new SupermodelClient(api);

    // Step 1: Zip
    console.error('Step 1/3: Creating ZIP archive...');
    const zipResult = await zipRepository(resolvedDir);
    console.error(`  ZIP created: ${zipResult.fileCount} files, ${(zipResult.sizeBytes / 1024 / 1024).toFixed(1)} MB`);

    // Step 2: API call
    console.error('Step 2/3: Analyzing codebase...');
    const idempotencyKey = generateIdempotencyKey(resolvedDir);

    let progressInterval: NodeJS.Timeout | null = null;
    let elapsed = 0;
    progressInterval = setInterval(() => {
      elapsed += 15;
      console.error(`  Analysis in progress... (${elapsed}s elapsed)`);
    }, 15000);

    let response: any;
    try {
      const fileBuffer = await readFile(zipResult.path);
      const fileBlob = new Blob([fileBuffer], { type: 'application/zip' });
      response = await client.generateSupermodelGraph(fileBlob, { idempotencyKey });
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      await zipResult.cleanup();
    }

    graph = buildIndexes(response, `generate:${name}`) as IndexedGraph;
    console.error(`  Analysis complete: ${graph!.summary.nodeCount} nodes, ${graph!.summary.relationshipCount} relationships`);

    // Save cache for reuse
    if (cacheDir) {
      console.error('Step 3/3: Saving cache...');
      const savedPath = await saveCacheToDisk(cacheDir, name, response, commitHash || undefined);
      console.error(`  Saved to: ${savedPath}`);
    }
  }

  // Render and write
  console.error('Rendering Supermodel.md...');
  const markdown = renderSupermodelMd(graph!);

  // Ensure output directory exists
  const outputDir = require('path').dirname(outputPath);
  await mkdir(outputDir, { recursive: true });

  await writeFile(outputPath, markdown, 'utf-8');
  const sizeKB = (Buffer.byteLength(markdown, 'utf-8') / 1024).toFixed(1);
  console.error(`Written to: ${outputPath} (${sizeKB} KB)`);
}
