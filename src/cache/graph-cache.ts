/**
 * LRU Cache for indexed graphs
 * Stores raw API responses + derived indexes for fast query execution
 * Supports disk persistence for pre-computed graphs
 */

import { SupermodelIR, CodeGraphNode, CodeGraphRelationship } from './graph-types';
import { DEFAULT_MAX_GRAPHS, DEFAULT_MAX_NODES, DEFAULT_CACHE_TTL_MS } from '../constants';
import { ClientContext } from '../types';
import { generateIdempotencyKey } from '../utils/api-helpers';
import { zipRepository } from '../utils/zip-repository';
import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { Blob } from 'buffer';
import * as logger from '../utils/logger';

// Adjacency list for traversal
interface AdjacencyList {
  out: string[];
  in: string[];
}

// Path index entry - what entities are defined in a file
interface PathIndexEntry {
  fileId: string;
  classIds: string[];
  functionIds: string[];
  typeIds: string[];
}

// Indexed graph structure
export interface IndexedGraph {
  // Raw data
  raw: SupermodelIR;

  // Indexes
  nodeById: Map<string, CodeGraphNode>;
  labelIndex: Map<string, string[]>;  // label -> node ids
  pathIndex: Map<string, PathIndexEntry>;  // filePath -> entities
  dirIndex: Map<string, string[]>;  // dir path -> child file/dir ids
  nameIndex: Map<string, string[]>;  // lowercase name -> node ids
  callAdj: Map<string, AdjacencyList>;  // function id -> callers/callees
  importAdj: Map<string, AdjacencyList>;  // file/module id -> imports/importers
  domainIndex: Map<string, { memberIds: string[], relationships: CodeGraphRelationship[] }>;

  // Precomputed
  summary: {
    filesProcessed: number;
    classes: number;
    functions: number;
    types: number;
    domains: number;
    primaryLanguage: string;
    nodeCount: number;
    relationshipCount: number;
  };

  // Metadata
  cachedAt: string;
  cacheKey: string;
}

// Cache entry with size tracking
interface CacheEntry {
  graph: IndexedGraph;
  nodeCount: number;
  lastAccessed: number;
  createdAt: number;
}

/**
 * Build indexes from raw SupermodelIR response
 */
export function buildIndexes(raw: SupermodelIR, cacheKey: string): IndexedGraph {
  const nodes = raw.graph?.nodes || [];
  const relationships = raw.graph?.relationships || [];

  // Initialize indexes
  const nodeById = new Map<string, CodeGraphNode>();
  const labelIndex = new Map<string, string[]>();
  const pathIndex = new Map<string, PathIndexEntry>();
  const dirIndex = new Map<string, string[]>();
  const nameIndex = new Map<string, string[]>();
  const callAdj = new Map<string, AdjacencyList>();
  const importAdj = new Map<string, AdjacencyList>();
  const domainIndex = new Map<string, { memberIds: string[], relationships: CodeGraphRelationship[] }>();

  // Build node indexes
  for (const node of nodes) {
    const id = node.id;
    const props = node.properties || {};
    const labels = node.labels || [];

    // nodeById
    nodeById.set(id, node);

    // labelIndex
    for (const label of labels) {
      if (!labelIndex.has(label)) {
        labelIndex.set(label, []);
      }
      labelIndex.get(label)!.push(id);
    }

    // nameIndex (lowercase for case-insensitive search)
    const name = props.name as string | undefined;
    if (name) {
      const lowerName = name.toLowerCase();
      if (!nameIndex.has(lowerName)) {
        nameIndex.set(lowerName, []);
      }
      nameIndex.get(lowerName)!.push(id);
    }

    // pathIndex - track what's defined in each file
    const filePath = props.filePath as string | undefined;
    if (filePath) {
      const normalized = normalizePath(filePath);
      if (!pathIndex.has(normalized)) {
        pathIndex.set(normalized, { fileId: '', classIds: [], functionIds: [], typeIds: [] });
      }
      const entry = pathIndex.get(normalized)!;

      const primaryLabel = labels[0];
      if (primaryLabel === 'File') {
        entry.fileId = id;
      } else if (primaryLabel === 'Class') {
        entry.classIds.push(id);
      } else if (primaryLabel === 'Function') {
        entry.functionIds.push(id);
      } else if (primaryLabel === 'Type') {
        entry.typeIds.push(id);
      }
    }

    // dirIndex - build directory tree
    if (labels[0] === 'Directory') {
      const dirPath = normalizePath(props.path as string || props.name as string || '');
      if (!dirIndex.has(dirPath)) {
        dirIndex.set(dirPath, []);
      }
    }

    // Initialize adjacency lists for functions and files
    if (labels[0] === 'Function') {
      callAdj.set(id, { out: [], in: [] });
    }
    if (labels[0] === 'File' || labels[0] === 'LocalModule' || labels[0] === 'ExternalModule') {
      importAdj.set(id, { out: [], in: [] });
    }

    // domainIndex
    if (labels[0] === 'Domain' || labels[0] === 'Subdomain') {
      domainIndex.set(name || id, { memberIds: [], relationships: [] });
    }
  }

  // Build relationship indexes
  for (const rel of relationships) {
    const { type, startNode, endNode } = rel;

    // Call adjacency
    if (type === 'calls') {
      if (callAdj.has(startNode)) {
        callAdj.get(startNode)!.out.push(endNode);
      }
      if (callAdj.has(endNode)) {
        callAdj.get(endNode)!.in.push(startNode);
      }
    }

    // Import adjacency
    if (type === 'IMPORTS') {
      // Some graphs emit IMPORTS edges from non-File nodes (e.g. Function -> Module).
      // Create adjacency lazily for any node that participates.
      let startAdj = importAdj.get(startNode);
      if (!startAdj) {
        startAdj = { out: [], in: [] };
        importAdj.set(startNode, startAdj);
      }
      startAdj.out.push(endNode);

      let endAdj = importAdj.get(endNode);
      if (!endAdj) {
        endAdj = { out: [], in: [] };
        importAdj.set(endNode, endAdj);
      }
      endAdj.in.push(startNode);
    }

    // Directory contains
    if (type === 'CONTAINS_FILE' || type === 'CHILD_DIRECTORY') {
      const startNode_ = nodeById.get(startNode);
      if (startNode_ && startNode_.labels?.[0] === 'Directory') {
        const dirPath = normalizePath(startNode_.properties?.path as string || startNode_.properties?.name as string || '');
        if (dirIndex.has(dirPath)) {
          dirIndex.get(dirPath)!.push(endNode);
        }
      }
    }

    // Domain membership
    if (type === 'belongsTo') {
      const targetNode = nodeById.get(endNode);
      if (targetNode) {
        const domainName = targetNode.properties?.name as string;
        if (domainIndex.has(domainName)) {
          domainIndex.get(domainName)!.memberIds.push(startNode);
        }
      }
    }

    // Domain relationships
    const startNodeData = nodeById.get(startNode);
    const endNodeData = nodeById.get(endNode);
    if (startNodeData?.labels?.[0] === 'Domain' && endNodeData?.labels?.[0] === 'Domain') {
      const domainName = startNodeData.properties?.name as string;
      if (domainIndex.has(domainName)) {
        domainIndex.get(domainName)!.relationships.push(rel);
      }
    }
  }

  // Compute summary
  const summary = {
    filesProcessed: raw.summary?.filesProcessed || labelIndex.get('File')?.length || 0,
    classes: raw.summary?.classes || labelIndex.get('Class')?.length || 0,
    functions: raw.summary?.functions || labelIndex.get('Function')?.length || 0,
    types: raw.summary?.types || labelIndex.get('Type')?.length || 0,
    domains: raw.summary?.domains || labelIndex.get('Domain')?.length || 0,
    primaryLanguage: raw.summary?.primaryLanguage || 'unknown',
    nodeCount: nodes.length,
    relationshipCount: relationships.length,
  };

  return {
    raw,
    nodeById,
    labelIndex,
    pathIndex,
    dirIndex,
    nameIndex,
    callAdj,
    importAdj,
    domainIndex,
    summary,
    cachedAt: new Date().toISOString(),
    cacheKey,
  };
}

/**
 * Normalize file paths for consistent matching
 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * LRU Cache for indexed graphs
 */
export class GraphCache {
  private cache = new Map<string, CacheEntry>();
  private maxGraphs: number;
  private maxNodes: number;
  private maxAgeMs: number;
  private currentNodes = 0;

  constructor(options?: { maxGraphs?: number; maxNodes?: number; maxAgeMs?: number }) {
    this.maxGraphs = options?.maxGraphs || DEFAULT_MAX_GRAPHS;
    this.maxNodes = options?.maxNodes || DEFAULT_MAX_NODES;
    this.maxAgeMs = options?.maxAgeMs || DEFAULT_CACHE_TTL_MS;
  }

  get(cacheKey: string): IndexedGraph | null {
    const entry = this.cache.get(cacheKey);
    if (entry) {
      // Update access time (LRU)
      entry.lastAccessed = Date.now();
      return entry.graph;
    }
    return null;
  }

  set(cacheKey: string, graph: IndexedGraph): void {
    const nodeCount = graph.summary.nodeCount;

    // Evict stale entries first
    this.evictStale();

    // Evict if needed
    while (
      (this.cache.size >= this.maxGraphs || this.currentNodes + nodeCount > this.maxNodes) &&
      this.cache.size > 0
    ) {
      this.evictOldest();
    }

    // Store
    const now = Date.now();
    this.cache.set(cacheKey, {
      graph,
      nodeCount,
      lastAccessed: now,
      createdAt: now,
    });
    this.currentNodes += nodeCount;
  }

  has(cacheKey: string): boolean {
    return this.cache.has(cacheKey);
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey)!;
      this.currentNodes -= entry.nodeCount;
      this.cache.delete(oldestKey);
    }
  }

  /**
   * Evict all cache entries that have exceeded their TTL (maxAgeMs)
   * This method can be called manually or is automatically invoked before adding new entries
   * @returns Number of entries evicted
   */
  evictStale(): number {
    const now = Date.now();
    const keysToEvict: string[] = [];

    // Find all stale entries
    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > this.maxAgeMs) {
        keysToEvict.push(key);
      }
    }

    // Evict them
    for (const key of keysToEvict) {
      const entry = this.cache.get(key)!;
      this.currentNodes -= entry.nodeCount;
      this.cache.delete(key);
    }

    return keysToEvict.length;
  }

  status(): { graphs: number; nodes: number; keys: string[] } {
    return {
      graphs: this.cache.size,
      nodes: this.currentNodes,
      keys: Array.from(this.cache.keys()),
    };
  }
}

/**
 * Save a SupermodelIR to disk for later use as a pre-computed cache.
 * Stores as JSON with a metadata wrapper.
 */
export async function saveCacheToDisk(
  cacheDir: string,
  repoName: string,
  raw: SupermodelIR,
  commitHash?: string
): Promise<string> {
  await fs.mkdir(cacheDir, { recursive: true });

  const fileName = `${sanitizeFileName(repoName)}.json`;
  const filePath = join(cacheDir, fileName);

  const payload = {
    version: 1,
    repoName,
    commitHash: commitHash || null,
    savedAt: new Date().toISOString(),
    raw,
  };

  await fs.writeFile(filePath, JSON.stringify(payload));
  return filePath;
}

/**
 * Load all pre-computed graphs from a cache directory into the GraphCache.
 * Returns a Map of repoName -> IndexedGraph for repo auto-detection.
 */
export async function loadCacheFromDisk(
  cacheDir: string,
  cache: GraphCache
): Promise<Map<string, IndexedGraph>> {
  const repoMap = new Map<string, IndexedGraph>();

  let entries: string[];
  try {
    entries = await fs.readdir(cacheDir);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      logger.debug('Cache directory does not exist:', cacheDir);
      return repoMap;
    }
    throw error;
  }

  const jsonFiles = entries.filter(e => e.endsWith('.json'));
  logger.debug(`Found ${jsonFiles.length} cache files in ${cacheDir}`);

  for (const file of jsonFiles) {
    try {
      const filePath = join(cacheDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const payload = JSON.parse(content);

      if (!payload.raw || !payload.repoName) {
        logger.warn(`Skipping invalid cache file: ${file}`);
        continue;
      }

      const repoName = payload.repoName as string;
      const cacheKey = `precache:${repoName}`;
      const graph = buildIndexes(payload.raw, cacheKey);

      cache.set(cacheKey, graph);
      repoMap.set(repoName.toLowerCase(), graph);

      // Index by commit hash for exact matching (e.g. "commit:abc1234")
      const commitHash = payload.commitHash as string | null;
      if (commitHash) {
        repoMap.set(`commit:${commitHash}`, graph);
      }

      // Also store common variants of the repo name for matching
      // e.g. "django" for "django__django", "astropy" for "astropy__astropy"
      const parts = repoName.toLowerCase().split(/[_\-\/]/);
      for (const part of parts) {
        if (part && part.length > 2 && !repoMap.has(part)) {
          repoMap.set(part, graph);
        }
      }

      logger.debug(`Loaded pre-computed graph for ${repoName} (commit: ${commitHash || 'unknown'}): ${graph.summary.nodeCount} nodes`);
    } catch (error: any) {
      logger.warn(`Failed to load cache file ${file}: ${error.message}`);
    }
  }

  return repoMap;
}

/**
 * Detect which pre-computed graph matches a given directory.
 * Tries: git remote name, directory basename, parent directory name.
 */
function detectRepo(
  directory: string,
  repoMap: Map<string, IndexedGraph>
): IndexedGraph | null {
  if (repoMap.size === 0) return null;

  // Strategy 0 (highest priority): Match by exact commit hash
  try {
    const { execSync } = require('child_process');
    const commitHash = execSync('git rev-parse --short HEAD', {
      cwd: directory, encoding: 'utf-8', timeout: 2000,
    }).trim();
    if (commitHash && repoMap.has(`commit:${commitHash}`)) {
      return repoMap.get(`commit:${commitHash}`)!;
    }
  } catch {
    // Not a git repo
  }

  // Strategy 1: Try directory basename
  const dirName = basename(directory).toLowerCase();
  if (repoMap.has(dirName)) {
    return repoMap.get(dirName)!;
  }

  // Strategy 2: Try git remote (sync, best-effort)
  try {
    const { execSync } = require('child_process');
    const remote = execSync('git remote get-url origin', {
      cwd: directory,
      encoding: 'utf-8',
      timeout: 2000,
    }).trim();

    // Extract repo name from URL: "https://github.com/django/django.git" -> "django"
    const match = remote.match(/\/([^\/]+?)(?:\.git)?$/);
    if (match) {
      const repoName = match[1].toLowerCase();
      if (repoMap.has(repoName)) {
        return repoMap.get(repoName)!;
      }
    }

    // Try org/repo format: "django/django" -> try "django"
    const orgMatch = remote.match(/\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
    if (orgMatch) {
      const orgName = orgMatch[1].toLowerCase();
      const repoName = orgMatch[2].toLowerCase();
      // Try "org__repo" format (swe-bench style)
      const sweKey = `${orgName}__${repoName}`;
      if (repoMap.has(sweKey)) {
        return repoMap.get(sweKey)!;
      }
      if (repoMap.has(orgName)) {
        return repoMap.get(orgName)!;
      }
      if (repoMap.has(repoName)) {
        return repoMap.get(repoName)!;
      }
    }
  } catch {
    // Not a git repo or git not available -- that's fine
  }

  // Strategy 3: If there's only one cached graph, use it (common in SWE-bench)
  if (repoMap.size <= 3) {
    // Small map likely has only one real repo with name variants
    const uniqueGraphs = new Set([...repoMap.values()]);
    if (uniqueGraphs.size === 1) {
      return [...uniqueGraphs][0];
    }
  }

  return null;
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

/**
 * Detect the repo name from a directory (git remote or basename).
 */
function detectRepoName(directory: string): string {
  try {
    const { execSync } = require('child_process');
    const remote = execSync('git remote get-url origin', {
      cwd: directory,
      encoding: 'utf-8',
      timeout: 2000,
    }).trim();
    const match = remote.match(/\/([^\/]+?)(?:\.git)?$/);
    if (match) return match[1];
  } catch {
    // Not a git repo
  }
  return basename(directory);
}

// Global cache instance
export const graphCache = new GraphCache();

// Repo map for pre-computed graphs (populated at startup)
let _repoMap: Map<string, IndexedGraph> = new Map();
let _noApiFallback = false;

export function setRepoMap(map: Map<string, IndexedGraph>): void {
  _repoMap = map;
}

export function setNoApiFallback(enabled: boolean): void {
  _noApiFallback = enabled;
}

/**
 * Resolve a graph for a directory: pre-computed cache → LRU cache → API fallback.
 * When --no-api-fallback is set, throws instead of calling the API.
 */
export async function resolveOrFetchGraph(
  client: ClientContext,
  directory: string
): Promise<IndexedGraph> {
  // 1. Pre-computed cache
  const precomputed = detectRepo(directory, _repoMap);
  if (precomputed) return precomputed;

  // 2. LRU cache
  const idempotencyKey = generateIdempotencyKey(directory);
  const cached = graphCache.get(idempotencyKey);
  if (cached) return cached;

  // 3. Fast-fail when API fallback is disabled (e.g. SWE-bench)
  if (_noApiFallback) {
    throw {
      response: null,
      request: null,
      message: 'No pre-computed graph available for this repository. Use grep, find, and file reading to explore the codebase instead.',
      code: 'NO_CACHE',
    };
  }

  // 4. API fallback
  console.error('[Supermodel] Generating codebase graph (this may take a few minutes)...');
  const zipResult = await zipRepository(directory);
  let progressInterval: NodeJS.Timeout | null = null;
  let elapsed = 0;
  progressInterval = setInterval(() => {
    elapsed += 15;
    console.error(`[Supermodel] Analysis in progress... (${elapsed}s elapsed)`);
  }, 15000);

  try {
    const fileBuffer = await fs.readFile(zipResult.path);
    const fileBlob = new Blob([fileBuffer], { type: 'application/zip' });

    const response = await client.graphs.generateSupermodelGraph(
      fileBlob as any,
      { idempotencyKey }
    );

    const graph = buildIndexes(response, idempotencyKey);
    graphCache.set(idempotencyKey, graph);

    console.error('[Supermodel] Analysis complete.');
    return graph;
  } finally {
    if (progressInterval) clearInterval(progressInterval);
    await zipResult.cleanup();
  }
}

/**
 * Pre-compute and cache a graph for a directory during server startup.
 * If a cache already exists (in repoMap or on disk), this is a no-op.
 * Otherwise calls the API, saves to cacheDir for cross-container persistence,
 * and updates the in-memory repoMap.
 *
 * The Supermodel API has server-side idempotency caching, so repeated calls
 * with the same idempotency key (same repo + commit) return instantly.
 */
export async function precacheForDirectory(
  client: ClientContext,
  directory: string,
  cacheDir: string | undefined
): Promise<void> {
  // Already cached?
  if (detectRepo(directory, _repoMap)) {
    logger.debug('Graph already cached for', directory);
    return;
  }

  logger.info('Pre-computing graph for', directory, '(first run for this repo; subsequent runs will be instant)...');

  const idempotencyKey = generateIdempotencyKey(directory);
  const repoName = detectRepoName(directory);

  const zipResult = await zipRepository(directory);
  let progressInterval: NodeJS.Timeout | null = null;
  let elapsed = 0;
  progressInterval = setInterval(() => {
    elapsed += 15;
    logger.info(`Analysis in progress... (${elapsed}s elapsed)`);
  }, 15000);

  try {
    const fileBuffer = await fs.readFile(zipResult.path);
    const fileBlob = new Blob([fileBuffer], { type: 'application/zip' });

    const response = await client.graphs.generateSupermodelGraph(
      fileBlob as any,
      { idempotencyKey }
    );

    const graph = buildIndexes(response, `precache:${repoName}`);

    // Update in-memory caches
    graphCache.set(idempotencyKey, graph);
    _repoMap.set(repoName.toLowerCase(), graph);
    const parts = repoName.toLowerCase().split(/[_\-\/]/);
    for (const part of parts) {
      if (part && part.length > 2 && !_repoMap.has(part)) {
        _repoMap.set(part, graph);
      }
    }

    // Persist to disk for cross-container reuse
    if (cacheDir) {
      try {
        const savedPath = await saveCacheToDisk(cacheDir, repoName, response);
        logger.info('Saved graph to:', savedPath);
      } catch (err: any) {
        // Non-fatal: cache dir might be read-only or full
        logger.warn('Failed to persist graph to disk:', err.message);
      }
    }

    logger.info(`Pre-compute complete: ${graph.summary.nodeCount} nodes, ${graph.summary.relationshipCount} relationships`);
  } finally {
    if (progressInterval) clearInterval(progressInterval);
    await zipResult.cleanup();
  }
}
