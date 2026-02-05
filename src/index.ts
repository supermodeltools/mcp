#!/usr/bin/env node
/**
 * Entry point for the Supermodel MCP Server.
 *
 * Usage:
 *   node dist/index.js [workdir] [--no-api-fallback]  -- Start MCP server
 *   node dist/index.js precache <dir> [--output-dir <dir>]  -- Pre-compute graph for a repo
 *
 * @module index
 */
import { Server } from './server';
import * as logger from './utils/logger';

async function main() {
  const args = process.argv.slice(2);

  // Handle precache subcommand
  if (args[0] === 'precache') {
    await handlePrecache(args.slice(1));
    return;
  }

  // Normal MCP server mode — parse flags
  let defaultWorkdir: string | undefined;
  let noApiFallback = !!process.env.SUPERMODEL_NO_API_FALLBACK;
  let precache = false;

  for (const arg of args) {
    if (arg === '--no-api-fallback') {
      noApiFallback = true;
    } else if (arg === '--precache') {
      precache = true;
    } else if (!arg.startsWith('--')) {
      defaultWorkdir = arg;
    }
  }

  if (defaultWorkdir) {
    logger.debug('Default workdir:', defaultWorkdir);
  }
  if (noApiFallback) {
    logger.debug('API fallback disabled (cache-only mode)');
  }
  if (precache) {
    logger.debug('Startup precaching enabled');
  }

  const server = new Server(defaultWorkdir, { noApiFallback, precache });
  await server.start();
}

async function handlePrecache(args: string[]) {
  if (args.length === 0) {
    console.error('Usage: supermodel-mcp precache <directory> [--output-dir <dir>] [--name <repo-name>]');
    console.error('');
    console.error('Pre-compute a code graph for a repository and save it to disk.');
    console.error('');
    console.error('Options:');
    console.error('  --output-dir <dir>   Directory to save the cache file (default: ./supermodel-cache)');
    console.error('  --name <name>        Repository name for the cache key (default: directory basename)');
    console.error('');
    console.error('Environment:');
    console.error('  SUPERMODEL_API_KEY   Required. API key for the Supermodel service.');
    console.error('  SUPERMODEL_CACHE_DIR Alternative to --output-dir.');
    process.exit(1);
  }

  // Parse args
  let directory = '';
  let outputDir = process.env.SUPERMODEL_CACHE_DIR || './supermodel-cache';
  let repoName = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output-dir' && i + 1 < args.length) {
      outputDir = args[++i];
    } else if (args[i] === '--name' && i + 1 < args.length) {
      repoName = args[++i];
    } else if (!args[i].startsWith('--')) {
      directory = args[i];
    }
  }

  if (!directory) {
    console.error('Error: directory argument is required');
    process.exit(1);
  }

  if (!process.env.SUPERMODEL_API_KEY) {
    console.error('Error: SUPERMODEL_API_KEY environment variable is required');
    process.exit(1);
  }

  const { resolve, basename, join } = require('path');
  const { execSync } = require('child_process');
  const { existsSync } = require('fs');
  const resolvedDir = resolve(directory);

  // Detect repo name from git remote, falling back to directory basename
  let detectedName = basename(resolvedDir);
  try {
    const remote = execSync('git remote get-url origin', {
      cwd: resolvedDir, encoding: 'utf-8', timeout: 2000,
    }).trim();
    const match = remote.match(/\/([^\/]+?)(?:\.git)?$/);
    if (match) detectedName = match[1];
  } catch {}

  // Get commit hash for commit-specific caching
  let commitHash = '';
  try {
    commitHash = execSync('git rev-parse --short HEAD', {
      cwd: resolvedDir, encoding: 'utf-8', timeout: 2000,
    }).trim();
  } catch {}

  const name = repoName || (commitHash ? `${detectedName}_${commitHash}` : detectedName);

  // Check if cache file already exists (skip redundant API calls)
  const { saveCacheToDisk, buildIndexes, sanitizeFileName } = require('./cache/graph-cache');
  const expectedPath = join(outputDir, `${sanitizeFileName(name)}.json`);
  if (existsSync(expectedPath)) {
    console.error(`Cache already exists: ${expectedPath}`);
    console.error('Skipping precache (graph already generated for this commit).');
    return;
  }

  console.error(`Pre-computing graph for: ${resolvedDir}`);
  console.error(`Repository name: ${detectedName}, commit: ${commitHash || 'unknown'}`);
  console.error(`Cache file: ${expectedPath}`);
  console.error('');

  // Import what we need
  const { Configuration, DefaultApi, SupermodelClient } = require('@supermodeltools/sdk');
  const { zipRepository } = require('./utils/zip-repository');
  const { readFile } = require('fs/promises');
  const { Blob } = require('buffer');
  const { generateIdempotencyKey } = require('./utils/api-helpers');
  const { Agent } = require('undici');

  const { DEFAULT_API_TIMEOUT_MS, CONNECTION_TIMEOUT_MS } = require('./constants');

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
  console.error('Step 2/3: Analyzing codebase (this may take several minutes)...');
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

  const graph = buildIndexes(response, `precache:${name}`);
  console.error(`  Analysis complete: ${graph.summary.nodeCount} nodes, ${graph.summary.relationshipCount} relationships`);
  console.error(`  Files: ${graph.summary.filesProcessed}, Functions: ${graph.summary.functions}, Classes: ${graph.summary.classes}`);

  // Step 3: Save to disk
  console.error('Step 3/3: Saving to disk...');
  const savedPath = await saveCacheToDisk(outputDir, name, response, commitHash || undefined);
  console.error(`  Saved to: ${savedPath}`);
  console.error('');
  console.error('Done! To use this cache, set SUPERMODEL_CACHE_DIR=' + outputDir);
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
