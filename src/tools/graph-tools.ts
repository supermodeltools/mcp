/**
 * Individual graph type tools for targeted codebase analysis.
 * Each tool calls a specific graph API endpoint for focused results.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import {
  Metadata,
  HandlerFunction,
  asTextContentResult,
  asErrorResult,
  ClientContext,
} from '../types';
import { maybeFilter } from '../filtering';
import { zipRepository } from '../utils/zip-repository';
import * as logger from '../utils/logger';
import {
  REPORT_REPO,
  REPORT_SUGGESTION,
  formatBytes,
  generateIdempotencyKey,
  classifyApiError,
} from '../utils/api-helpers';

// Graph type configuration
interface GraphTypeConfig {
  name: string;
  toolName: string;
  description: string;
  endpoint: string;
  operationId: string;
  apiMethod: 'generateCallGraph' | 'generateDependencyGraph' | 'generateDomainGraph' | 'generateParseGraph';
}

const GRAPH_TYPES: GraphTypeConfig[] = [
  {
    name: 'call',
    toolName: 'get_call_graph',
    description: `Generate a function-level call graph showing caller/callee relationships.

Use this to:
- Find all functions that call a specific function
- Find all functions called by a specific function
- Trace call chains through the codebase
- Understand function dependencies

Returns nodes (functions) and relationships (calls) between them.`,
    endpoint: '/v1/graphs/call',
    operationId: 'generateCallGraph',
    apiMethod: 'generateCallGraph',
  },
  {
    name: 'dependency',
    toolName: 'get_dependency_graph',
    description: `Generate a module-level dependency graph showing import relationships.

Use this to:
- Understand module dependencies
- Find circular dependencies
- Identify tightly coupled modules
- Plan module extraction or refactoring

Returns nodes (files/modules) and relationships (imports) between them.`,
    endpoint: '/v1/graphs/dependency',
    operationId: 'generateDependencyGraph',
    apiMethod: 'generateDependencyGraph',
  },
  {
    name: 'domain',
    toolName: 'get_domain_graph',
    description: `Generate a high-level domain classification graph.

Use this to:
- Understand the architectural domains in a codebase
- See how code is organized into logical areas
- Get a bird's-eye view of system structure
- Identify domain boundaries

Returns domains, subdomains, and their member files/functions.`,
    endpoint: '/v1/graphs/domain',
    operationId: 'generateDomainGraph',
    apiMethod: 'generateDomainGraph',
  },
  {
    name: 'parse',
    toolName: 'get_parse_graph',
    description: `Generate an AST-level parse graph with fine-grained code structure.

Use this to:
- Analyze detailed code structure
- Find specific syntax patterns
- Understand class/function definitions at AST level
- Support precise refactoring operations

Returns detailed AST nodes and structural relationships.`,
    endpoint: '/v1/graphs/parse',
    operationId: 'generateParseGraph',
    apiMethod: 'generateParseGraph',
  },
];

/**
 * Create a tool definition and handler for a specific graph type
 */
function createGraphTool(config: GraphTypeConfig): {
  metadata: Metadata;
  tool: Tool;
  handler: HandlerFunction;
} {
  const metadata: Metadata = {
    resource: 'graphs',
    operation: 'write',
    tags: [config.name],
    httpMethod: 'post',
    httpPath: config.endpoint,
    operationId: config.operationId,
  };

  const tool: Tool = {
    name: config.toolName,
    description: config.description,
    inputSchema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Path to the repository directory to analyze.',
        },
        jq_filter: {
          type: 'string',
          title: 'jq Filter',
          description: 'Optional jq filter to extract specific data from the response.',
        },
      },
      required: [],
    },
  };

  const handler: HandlerFunction = async (
    client: ClientContext,
    args: Record<string, unknown> | undefined,
    defaultWorkdir?: string
  ) => {
    if (!args) {
      args = {};
    }

    const { jq_filter, directory: providedDirectory } = args as {
      jq_filter?: string;
      directory?: string;
    };

    if (providedDirectory !== undefined && typeof providedDirectory !== 'string') {
      return asErrorResult({
        type: 'validation_error',
        message: 'Invalid "directory" parameter. Provide a valid directory path as a string.',
        code: 'INVALID_DIRECTORY',
        recoverable: false,
        suggestion: 'Pass directory as a string path, e.g. directory="/workspace/my-repo".',
      });
    }

    const directory = providedDirectory || defaultWorkdir;

    if (!directory || typeof directory !== 'string') {
      return asErrorResult({
        type: 'validation_error',
        message: 'No "directory" parameter provided and no default workdir configured.',
        code: 'MISSING_DIRECTORY',
        recoverable: false,
        suggestion: 'Provide a directory path or start the MCP server with a workdir argument.',
      });
    }

    const idempotencyKey = generateIdempotencyKey(directory, config.name);
    logger.debug(`[${config.toolName}] Idempotency key:`, idempotencyKey);

    // Create ZIP of repository
    let zipPath: string;
    let cleanup: (() => Promise<void>) | null = null;

    try {
      const zipResult = await zipRepository(directory);
      zipPath = zipResult.path;
      cleanup = zipResult.cleanup;
      logger.debug(`[${config.toolName}] ZIP created:`, zipResult.fileCount, 'files,', formatBytes(zipResult.sizeBytes));
    } catch (error: any) {
      const message = typeof error?.message === 'string' ? error.message : String(error);

      if (message.includes('does not exist')) {
        return asErrorResult({
          type: 'not_found_error',
          message: `Directory not found: ${directory}`,
          code: 'DIRECTORY_NOT_FOUND',
          recoverable: false,
          suggestion: 'Verify the path exists.',
        });
      }

      return asErrorResult({
        type: 'internal_error',
        message: `Failed to create ZIP archive: ${message}`,
        code: 'ZIP_CREATION_FAILED',
        recoverable: false,
        reportable: true,
        repo: REPORT_REPO,
        suggestion: REPORT_SUGGESTION,
      });
    }

    try {
      const fileBuffer = await readFile(zipPath);
      const fileBlob = new Blob([fileBuffer], { type: 'application/zip' });

      logger.debug(`[${config.toolName}] Calling API...`);
      console.error(`[Supermodel] Generating ${config.name} graph...`);

      // Call the appropriate API method via SupermodelClient
      const apiMethod = client.graphs[config.apiMethod].bind(client.graphs);
      const response = await apiMethod(fileBlob as any, { idempotencyKey });

      console.error(`[Supermodel] ${config.name} graph complete.`);

      // Apply optional jq filter
      const result = await maybeFilter(jq_filter, response);
      return asTextContentResult(result);
    } catch (error: any) {
      logger.error(`[${config.toolName}] API error:`, error.message);
      return asErrorResult(classifyApiError(error));
    } finally {
      if (cleanup) {
        try {
          await cleanup();
        } catch (cleanupError) {
          logger.warn(`[${config.toolName}] Cleanup failed:`, cleanupError);
        }
      }
    }
  };

  return { metadata, tool, handler };
}

// Create all graph tools
export const callGraphTool = createGraphTool(GRAPH_TYPES[0]);
export const dependencyGraphTool = createGraphTool(GRAPH_TYPES[1]);
export const domainGraphTool = createGraphTool(GRAPH_TYPES[2]);
export const parseGraphTool = createGraphTool(GRAPH_TYPES[3]);

// Export all tools as an array for easy registration
export const graphTools = [
  callGraphTool,
  dependencyGraphTool,
  domainGraphTool,
  parseGraphTool,
];
