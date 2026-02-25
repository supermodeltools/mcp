/**
 * MCP Server implementation for the Supermodel codebase analysis tools.
 * Redesigned for maximum SWE-bench performance:
 *  - 1 tool (symbol_context) with batch support; overview injected into instructions
 *  - Pre-computed graph support for sub-second response times
 *  - On-demand API fallback when no cache exists
 * @module server
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Configuration, DefaultApi, SupermodelClient } from '@supermodeltools/sdk';
import { renderOverview } from './tools/overview';
import symbolContextTool, { minimalTool as symbolContextMinimalTool } from './tools/symbol-context';
import {
  searchSymbolEndpoint,
  findDefinitionEndpoint,
  traceCallsEndpoint,
  annotateEndpoint,
} from './tools/tool-variants';
import exploreFunctionEndpoint from './tools/explore-function';
import findConnectionsEndpoint from './tools/find-connections';
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

    const experiment = process.env.SUPERMODEL_EXPERIMENT;

    // Note: noApiFallback is deferred to start() so startup precaching can use the API
    const experimentInstructions: Record<string, string> = {
      'minimal-instructions': 'Codebase analysis tool. Call symbol_context to look up functions/classes.',
      'search-symbol': 'Codebase search tool. Use `search_symbol` alongside Grep and Read for parallel exploration.',
      'split-tools': 'Codebase tools: `find_definition` locates symbols, `trace_calls` shows caller/callee graphs. Call them alongside Read, Grep, and Glob.',
      'annotate': 'Codebase annotation tool. Fire `annotate` alongside your Read and Grep calls to enrich results with structural metadata.',
      'graphrag': `# Supermodel: Codebase Intelligence

Two tools for understanding codebase architecture and call relationships.

## Tools
- \`explore_function\`: BFS traversal of a function's call graph. Shows callers, callees, and cross-subsystem boundaries. Use this to trace impact, find dependencies, or identify callers.
- \`find_connections\`: Find how two domains/subsystems connect via function calls.

## Workflow
1. Identify key symbols from the issue, call \`explore_function\` to understand their call-graph context.
2. Use the cross-subsystem markers (← DIFFERENT SUBSYSTEM) to find architectural boundaries.
3. Start editing by turn 3. Max 3 MCP calls total.

## Rules
- Do NOT use TodoWrite. Act directly.
- Use the Task tool to delegate subtasks.`,
    };

    const instructions = experiment && experimentInstructions[experiment]
      ? experimentInstructions[experiment]
      : `# Supermodel: Codebase Intelligence

One read-only tool for instant codebase understanding. Pre-computed graphs enable sub-second responses.

The codebase overview is included below in these instructions — you already have the architecture map.

## Recommended workflow
1. Identify symbols from the issue/overview and call \`symbol_context\` to explore them.
   Batch via \`symbols\` array or issue multiple calls in parallel (read-only, safe).
2. Stop calling MCP tools. Start editing by turn 3. Max 3 MCP calls total.

## Rules
- Do NOT use TodoWrite. Act directly.
- Use the Task tool to delegate subtasks (e.g. running tests, exploring tangential code).
- >2 MCP turns = diminishing returns. Explore everything you need in one turn.

## After fixing
Run the full related test suite to catch regressions. Do NOT write standalone test scripts.

## Tool reference
- \`symbol_context\`: Source, callers, callees, domain for any function/class/method.
  Supports "Class.method", partial matching, and batch lookups via \`symbols\` array.
  Use \`brief: true\` for compact output when looking up 3+ symbols.
  Read-only — safe to call in parallel.`;

    this.server = new McpServer(
      {
        name: 'supermodel_api',
        version: '0.0.1',
      },
      {
        capabilities: { tools: {}, logging: {} },
        instructions,
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
    const experiment = process.env.SUPERMODEL_EXPERIMENT;

    // Experiment variants: swap tool definitions to test parallel calling behavior
    let allTools: typeof symbolContextTool[];
    switch (experiment) {
      case 'minimal-schema':
        allTools = [{ tool: symbolContextMinimalTool, handler: symbolContextTool.handler }];
        break;
      case 'search-symbol':
        allTools = [searchSymbolEndpoint];
        break;
      case 'split-tools':
        allTools = [findDefinitionEndpoint, traceCallsEndpoint];
        break;
      case 'annotate':
        allTools = [annotateEndpoint];
        break;
      case 'graphrag':
        allTools = [exploreFunctionEndpoint, findConnectionsEndpoint];
        break;
      default:
        allTools = [symbolContextTool];
        break;
    }

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

  private getTestHint(primaryLanguage: string): string {
    switch (primaryLanguage.toLowerCase()) {
      case 'python': return '\n\n**Test with:** `python -m pytest <test_file> -x`';
      case 'javascript':
      case 'typescript': return '\n\n**Test with:** `npm test`';
      case 'go': return '\n\n**Test with:** `go test ./...`';
      case 'rust': return '\n\n**Test with:** `cargo test`';
      case 'java': return '\n\n**Test with:** `mvn test` or `gradle test`';
      case 'ruby': return '\n\n**Test with:** `bundle exec rake test`';
      default: return '';
    }
  }

  private injectOverviewInstructions(repoMap: Map<string, import('./cache/graph-cache').IndexedGraph>) {
    if (repoMap.size === 0) return;

    // Skip overview injection during experiments to isolate variables (except graphrag)
    if (process.env.SUPERMODEL_EXPERIMENT && process.env.SUPERMODEL_EXPERIMENT !== 'graphrag') return;

    // Only inject if there's exactly 1 unique graph (SWE-bench always has exactly 1 repo)
    const uniqueGraphs = new Set([...repoMap.values()]);
    if (uniqueGraphs.size !== 1) return;

    const graph = [...uniqueGraphs][0];
    try {
      const overview = renderOverview(graph);
      const testHint = this.getTestHint(graph.summary.primaryLanguage);
      const current = (this.server.server as any)._instructions as string | undefined;
      (this.server.server as any)._instructions = (current || '') + '\n\n' + overview + testHint;
      logger.debug('Injected overview into server instructions');
    } catch (err: any) {
      logger.warn('Failed to render overview for instructions:', err.message || err);
    }
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
        this.injectOverviewInstructions(repoMap);
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
