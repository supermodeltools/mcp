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
        instructions: `# Server Instructions: Supermodel Codebase Explorer

## Available Tools

### Comprehensive Analysis
- **explore_codebase**: Full graph with query system. Best for comprehensive analysis with built-in queries (search, function calls, domain mapping).

### Targeted Graph Tools
For faster, focused analysis, use these specialized tools:
- **get_call_graph**: Function call relationships. Use for "what calls X?" or "what does X call?"
- **get_dependency_graph**: Module import relationships. Use for understanding dependencies.
- **get_domain_graph**: High-level architecture domains. Use for codebase overview.
- **get_parse_graph**: AST-level structure. Use for detailed refactoring analysis.

## Tool Selection Guide
- Quick question about function calls → \`get_call_graph\`
- Understanding module dependencies → \`get_dependency_graph\`
- Architecture overview → \`get_domain_graph\`
- Comprehensive analysis with queries → \`explore_codebase\`

## Strategies

### Debugging
1. Use \`get_call_graph\` to trace function relationships related to the bug.
2. Analyze the nodes and relationships to understand the issue context.
3. Use the graph to navigate more efficiently than grep.

### Planning
1. Use \`get_dependency_graph\` to understand blast radius of changes.
2. Use \`get_domain_graph\` to identify architectural patterns.
3. Look at nodes you plan to change to analyze impact.

### Analysis
1. Start with \`get_domain_graph\` for high-level architecture.
2. Drill down with \`get_call_graph\` or \`get_dependency_graph\` for specifics.
3. Use \`explore_codebase\` with queries for complex analysis.

## Performance

For faster responses:
- Use targeted tools (\`get_call_graph\`, etc.) instead of full \`explore_codebase\`
- Analyze subdirectories instead of full repo (e.g., \`/repo/src/core\` vs \`/repo\`)

## Error Handling

When a tool call returns an error, check the structured error fields:
- \`error.recoverable: true\` → wait briefly and retry the request
- \`error.reportable: true\` → this is a server-side bug, not your fault

If you receive a reportable error and have GitHub access:
1. Search the \`error.repo\` issues for the \`error.code\` to avoid duplicates
2. If no existing issue, open one with the error code, message, and any reproduction context
3. If you can identify and fix the root cause, fork the repo and open a PR`,
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

    // Create a map for quick handler lookup
    const toolMap = new Map(
      allTools.map(t => [t.tool.name, t])
    );

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

