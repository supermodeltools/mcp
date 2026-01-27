/**
 * Individual graph type tools for targeted codebase analysis.
 * Each tool calls a specific graph API endpoint for focused results.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { basename, resolve } from 'path';
import {
  Metadata,
  HandlerFunction,
  asTextContentResult,
  asErrorResult,
  ClientContext,
  StructuredError
} from '../types';
import { maybeFilter } from '../filtering';
import { zipRepository } from '../utils/zip-repository';
import * as logger from '../utils/logger';

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

const REPORT_REPO = 'https://github.com/supermodeltools/mcp.git';
const REPORT_SUGGESTION = 'This may be a bug in the MCP server. You can help by opening an issue at https://github.com/supermodeltools/mcp/issues with the error details, or fork the repo and open a PR with a fix.';

/**
 * Generate an idempotency key for a specific graph type
 */
function generateIdempotencyKey(directory: string, graphType: string): string {
  const repoName = basename(directory);
  const absolutePath = resolve(directory);
  const pathHash = createHash('sha1').update(absolutePath).digest('hex').substring(0, 7);

  let hash: string;
  let statusHash = '';

  try {
    hash = execSync('git rev-parse --short HEAD', {
      cwd: directory,
      encoding: 'utf-8',
    }).trim();

    const statusOutput = execSync('git status --porcelain', {
      cwd: directory,
      encoding: 'utf-8',
    }).toString();

    if (statusOutput) {
      statusHash = '-' + createHash('sha1')
        .update(statusOutput)
        .digest('hex')
        .substring(0, 7);
    }
  } catch {
    hash = pathHash;
  }

  return `${repoName}-${pathHash}:${graphType}:${hash}${statusHash}`;
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Classify API errors into structured responses
 */
function classifyApiError(error: any): StructuredError {
  if (!error || typeof error !== 'object') {
    return {
      type: 'internal_error',
      message: typeof error === 'string' ? error : 'An unexpected error occurred.',
      code: 'UNKNOWN_ERROR',
      recoverable: false,
      reportable: true,
      repo: REPORT_REPO,
      suggestion: REPORT_SUGGESTION,
    };
  }

  if (error.response) {
    const status = error.response.status;

    switch (status) {
      case 401:
        return {
          type: 'authentication_error',
          message: 'Invalid or missing API key.',
          code: 'INVALID_API_KEY',
          recoverable: false,
          suggestion: 'Set the SUPERMODEL_API_KEY environment variable and restart the MCP server.',
        };
      case 403:
        return {
          type: 'authorization_error',
          message: 'API key does not have permission for this operation.',
          code: 'FORBIDDEN',
          recoverable: false,
          suggestion: 'Verify your API key has the correct permissions.',
        };
      case 429:
        return {
          type: 'rate_limit_error',
          message: 'API rate limit exceeded.',
          code: 'RATE_LIMITED',
          recoverable: true,
          suggestion: 'Wait 30-60 seconds and retry.',
        };
      default:
        if (status >= 500) {
          return {
            type: 'internal_error',
            message: `API server error (HTTP ${status}).`,
            code: 'SERVER_ERROR',
            recoverable: true,
            reportable: true,
            repo: REPORT_REPO,
            suggestion: REPORT_SUGGESTION,
          };
        }
    }
  }

  return {
    type: 'internal_error',
    message: error.message || 'An unexpected error occurred.',
    code: 'UNKNOWN_ERROR',
    recoverable: false,
    reportable: true,
    repo: REPORT_REPO,
    suggestion: REPORT_SUGGESTION,
  };
}

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

      // Call the appropriate API method
      const apiMethod = client.api[config.apiMethod].bind(client.api);
      const response = await apiMethod({
        idempotencyKey,
        file: fileBlob as any,
      });

      console.error(`[Supermodel] ${config.name} graph complete.`);

      // Apply optional jq filter
      const result = await maybeFilter(jq_filter, response);
      return asTextContentResult(result);
    } catch (error: any) {
      logger.error(`[${config.toolName}] API error:`, error.message);
      return asErrorResult(classifyApiError(error));
    } finally {
      if (cleanup) {
        await cleanup();
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
