/**
 * MCP Server implementation for the Supermodel codebase analysis tools.
 * Provides JSON-RPC handlers for code graph generation and exploration.
 * @module server
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Configuration, DefaultApi, SupermodelClient } from '@supermodeltools/sdk';
import createSupermodelGraphTool from './tools/create-supermodel-graph';
import { graphTools } from './tools/graph-tools';
import { ClientContext } from './types';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { cleanupOldZips } from './utils/zip-repository';
import { Agent } from 'undici';
import { DEFAULT_API_TIMEOUT_MS, CONNECTION_TIMEOUT_MS, ZIP_CLEANUP_AGE_MS } from './constants';
import * as logger from './utils/logger';

// Configure HTTP timeout for API requests (default from constants)
// Some complex repos can take 10+ minutes to process
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
    // @ts-ignore - 'dispatcher' is a valid undici option that TypeScript's
    // built-in fetch types don't recognize. This routes requests through our
    // custom Agent with extended timeouts.
    dispatcher: agent,
  });
};

export class Server {
  private server: McpServer;
  private client: ClientContext;
  private defaultWorkdir?: string;

  constructor(defaultWorkdir?: string) {
    this.defaultWorkdir = defaultWorkdir;
    this.server = new McpServer(
      {
        name: 'supermodel_api',
        version: '0.0.1',
      },
      {
        capabilities: { tools: {}, logging: {} },
        instructions: `# Supermodel: Code Graph Tools

Generate code graphs to understand a codebase before making changes.

## Recommended Workflow

1. Start with \`get_domain_graph\` to understand architecture
2. Use \`get_call_graph\` or \`get_dependency_graph\` to drill into specific areas
3. Use \`get_parse_graph\` only when you need full structural detail

Node IDs are consistent across all graph types. A function ID from \`get_domain_graph\` can be looked up in \`get_call_graph\` results to find its callers.

## Performance

- First call takes 30+ seconds (API processing time)
- Analyze subdirectories for faster results: \`src/auth\` instead of full repo
- Use \`jq_filter\` to extract only the data you need

## explore_codebase

Returns the complete graph with all data combined. Useful for comprehensive exports or integration with external tools. For iterative analysis, prefer the individual graph tools above.

## Errors

- \`error.recoverable: true\` → retry after brief wait
- \`error.reportable: true\` → server bug, can be reported`,
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
    // Collect all tools: the main explore_codebase tool plus individual graph tools
    const allTools = [
      createSupermodelGraphTool,
      ...graphTools,
    ];

    // Create a map for quick handler lookup, checking for duplicates
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

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Supermodel MCP Server running on stdio');
  }
}

