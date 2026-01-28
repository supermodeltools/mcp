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
        instructions: `# Supermodel Codebase Explorer

## Choosing the Right Tool

| Situation | Tool | Why |
|-----------|------|-----|
| New codebase, need overview | \`get_domain_graph\` | Shows domains, responsibilities, architecture |
| Debugging function calls | \`get_call_graph\` | Function nodes + calls relationships |
| Understanding imports | \`get_dependency_graph\` | File nodes + IMPORTS relationships |
| Full code structure | \`get_parse_graph\` | All nodes and structural relationships |
| Iterative exploration | \`explore_codebase\` | Built-in queries for search and navigation |

## Available Tools

### Individual Graph Tools

**\`get_domain_graph\`** - High-level architecture
- Returns: Domains with descriptions, responsibilities, subdomains, file/function assignments
- Best for: Understanding how a codebase is organized

**\`get_call_graph\`** - Function call relationships
- Returns: Function nodes with "calls" relationships
- Best for: Debugging, tracing execution, finding callers/callees

**\`get_dependency_graph\`** - Import relationships
- Returns: File nodes with "IMPORTS" relationships
- Best for: Finding circular deps, understanding module coupling

**\`get_parse_graph\`** - Full code structure
- Returns: All nodes (File, Class, Function, Type) and structural relationships
- Best for: Comprehensive analysis, detailed refactoring

### explore_codebase (with queries)

Full analysis with built-in query interface:
- \`query: "summary"\` - Graph statistics
- \`query: "search", searchText: "..."\` - Find nodes by name
- \`query: "list_nodes", labels: [...]\` - Filter by type
- \`query: "function_calls_in/out", targetId: "..."\` - Trace calls
- \`query: "graph_status"\` - Check cache without API call

## Tips

- **Start with domain graph** for architecture overview
- **Target subdirectories** when possible (faster, smaller output)
- **Use jq_filter** to extract specific data

## Error Handling

- \`error.recoverable: true\` → retry after brief wait
- \`error.reportable: true\` → server bug, report to \`error.repo\``,
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

