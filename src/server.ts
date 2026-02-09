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

## Recommended workflow
1. \`overview\` first to learn architecture and key symbols (1 call)
2. \`symbol_context\` on 1-2 symbols from the issue to see source, callers, callees (1-2 calls)
3. Stop calling MCP tools. Use the results to make your fix.

## Anti-patterns
- >3 MCP calls = diminishing returns. The sweet spot is 1-2 calls.
- Chasing callers-of-callers burns iterations without helping.

## After fixing
Run the project's existing test suite (e.g. pytest). Do NOT write standalone test scripts.

## Tool reference
- \`overview\`: Architecture map, domains, hub functions, file counts. Zero-arg, sub-second.
- \`symbol_context\`: Source, callers, callees, domain for any function/class/method. Supports "Class.method" and partial matching.`,
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
      try {
        logger.debug('Loading pre-computed graphs from:', cacheDir);
        const repoMap = await loadCacheFromDisk(cacheDir, graphCache);
        setRepoMap(repoMap);
        logger.debug(`Loaded ${repoMap.size} repo mappings`);
      } catch (err: any) {
        logger.warn('Failed to load cache directory:', err.message || err);
      }
    }

    // Connect transport FIRST so the MCP handshake completes immediately.
    // This prevents Claude Code from timing out the server (MCP_TIMEOUT=60s)
    // when precaching requires a slow API call.
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Supermodel MCP Server running on stdio');

    // Precache the workdir's repo if --precache flag is set.
    // Runs AFTER connect but BEFORE noApiFallback so the API is available.
    // This is fire-and-forget from the MCP client's perspective — tools
    // that arrive before precaching finishes will use on-demand API calls.
    if (this.options?.precache && this.defaultWorkdir) {
      try {
        await precacheForDirectory(this.client, this.defaultWorkdir, cacheDir);
      } catch (err: any) {
        // Non-fatal: if precaching fails, tools fall back to on-demand API
        logger.warn('Startup precache failed:', err.message || err);
      }
    }

    // NOW enable no-api-fallback (after precaching had its chance)
    setNoApiFallback(!!this.options?.noApiFallback);
  }
}
