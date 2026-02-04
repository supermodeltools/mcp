/**
 * MCP Server implementation for the Supermodel codebase analysis tools.
 * Redesigned for maximum SWE-bench performance:
 *  - 2 tools (overview, symbol_context) instead of 10
 *  - Pre-computed graph support for sub-second response times
 *  - On-demand API fallback when no cache exists
 * @module server
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Configuration, DefaultApi, SupermodelClient } from '@supermodeltools/sdk';
import overviewTool from './tools/overview';
import symbolContextTool from './tools/symbol-context';
import { ClientContext } from './types';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { cleanupOldZips } from './utils/zip-repository';
import { graphCache, loadCacheFromDisk, setRepoMap, setNoApiFallback, precacheForDirectory } from './cache/graph-cache';
import { Agent } from 'undici';
import { DEFAULT_API_TIMEOUT_MS, CONNECTION_TIMEOUT_MS, ZIP_CLEANUP_AGE_MS } from './constants';
import * as logger from './utils/logger';

// Configure HTTP timeout for API requests
const parsedTimeout = parseInt(process.env.SUPERMODEL_TIMEOUT_MS || '', 10);
const TIMEOUT_MS = Number.isFinite(parsedTimeout) && parsedTimeout > 0
  ? parsedTimeout
  : DEFAULT_API_TIMEOUT_MS;

const agent = new Agent({
  headersTimeout: TIMEOUT_MS,
  bodyTimeout: TIMEOUT_MS,
  connectTimeout: CONNECTION_TIMEOUT_MS,
});

const fetchWithTimeout: typeof fetch = (url, init) => {
  return fetch(url, {
    ...init,
    // @ts-ignore - 'dispatcher' is a valid undici option
    dispatcher: agent,
  });
};

export interface ServerOptions {
  noApiFallback?: boolean;
  precache?: boolean;
}

export class Server {
  private server: McpServer;
  private client: ClientContext;
  private defaultWorkdir?: string;
  private options?: ServerOptions;
  constructor(defaultWorkdir?: string, options?: ServerOptions) {
    this.defaultWorkdir = defaultWorkdir;
    this.options = options;
    // Note: noApiFallback is deferred to start() so startup precaching can use the API
    this.server = new McpServer(
      {
        name: 'supermodel_api',
        version: '0.0.1',
      },
      {
        capabilities: { tools: {}, logging: {} },
        instructions: `# Supermodel: Codebase Intelligence

Two tools for instant codebase understanding. Pre-computed graphs enable sub-second responses.

## \`overview\` — Start here
Get the architecture map: domains, key files, hub functions, file/class/function counts.
Call this first on any new task to understand WHERE in the codebase to look.

## \`symbol_context\` — Deep dive on a symbol
Given a function, class, or method name, get its definition location, callers, callees, domain membership, and related symbols in the same file.
Use this when you know WHAT to investigate (e.g. from an issue description, stack trace, or grep result).
Supports partial matching and "ClassName.method" syntax.

## Recommended workflow
1. Call \`overview\` to understand the codebase architecture
2. Read the issue/bug description and identify relevant domains and symbols
3. Call \`symbol_context\` on key symbols to understand their structural context
4. Use Read/Grep to examine the actual source code at the identified locations
5. Make your fix and verify with tests`,
      },
    );

    const config = new Configuration({
      basePath: process.env.SUPERMODEL_BASE_URL || 'https://api.supermodeltools.com',
      apiKey: process.env.SUPERMODEL_API_KEY,
      fetchApi: fetchWithTimeout,
    });

    logger.debug('Server configuration:');
    logger.debug('Base URL:', config.basePath);
    logger.debug('API Key set:', !!process.env.SUPERMODEL_API_KEY);
    if (this.defaultWorkdir) {
      logger.debug('Default workdir:', this.defaultWorkdir);
    }

    const api = new DefaultApi(config);
    this.client = {
      graphs: new SupermodelClient(api),
    };

    this.setupHandlers();
  }

  private setupHandlers() {
    const allTools = [
      overviewTool,
      symbolContextTool,
    ];

    // Create a map for quick handler lookup
    const toolMap = new Map<string, typeof allTools[0]>();
    for (const t of allTools) {
      if (toolMap.has(t.tool.name)) {
        throw new Error(`Duplicate tool name: ${t.tool.name}`);
      }
      toolMap.set(t.tool.name, t);
    }

    this.server.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: allTools.map(t => t.tool),
      };
    });

    this.server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const tool = toolMap.get(name);
      if (tool) {
        return tool.handler(this.client, args, this.defaultWorkdir);
      }

      throw new Error(`Unknown tool: ${name}`);
    });
  }

  async start() {
    // Clean up any stale ZIP files from previous sessions
    await cleanupOldZips(ZIP_CLEANUP_AGE_MS);

    // Load pre-computed graphs from cache directory
    const cacheDir = process.env.SUPERMODEL_CACHE_DIR;
    if (cacheDir) {
      logger.debug('Loading pre-computed graphs from:', cacheDir);
      const repoMap = await loadCacheFromDisk(cacheDir, graphCache);
      setRepoMap(repoMap);
      logger.debug(`Loaded ${repoMap.size} repo mappings`);
    }

    // Precache the workdir's repo if --precache flag is set.
    // Runs BEFORE noApiFallback is set so the API is available.
    // On first run for a repo this calls the Supermodel API (5-15 min).
    // The API has server-side idempotency caching, so repeated calls
    // with the same repo+commit return instantly. Results are saved to
    // cacheDir for cross-container persistence.
    if (this.options?.precache && this.defaultWorkdir) {
      try {
        await precacheForDirectory(this.client, this.defaultWorkdir, cacheDir);
      } catch (err: any) {
        // Non-fatal: if precaching fails, tools fall back to no-cache error
        logger.warn('Startup precache failed:', err.message || err);
      }
    }

    // NOW enable no-api-fallback (after precaching had its chance)
    if (this.options?.noApiFallback) {
      setNoApiFallback(true);
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Supermodel MCP Server running on stdio');
  }
}
