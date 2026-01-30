/**
 * Task-specific query tools for focused codebase queries.
 * These tools provide fast, targeted answers to specific code navigation questions.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  HandlerFunction,
  asTextContentResult,
  asErrorResult,
  ClientContext,
} from '../types';
import { findCallSites, findCallSitesTool } from './find-call-sites';
import { traceCallChain, traceCallChainTool } from './trace-call-chain';
import { findDefinition, findDefinitionTool } from './find-definition';
import { traceDataFlow, traceDataFlowTool } from './trace-data-flow';

/**
 * Create a handler wrapper that calls the tool function and formats the result
 */
function createTaskQueryHandler(
  toolFunction: Function,
  toolName: string
): HandlerFunction {
  return async (
    client: ClientContext,
    args: Record<string, unknown> | undefined,
    defaultWorkdir?: string
  ) => {
    if (!args) {
      args = {};
    }

    // Inject default workdir if directory not provided
    if (!args.path && defaultWorkdir) {
      args.path = defaultWorkdir;
    }

    try {
      // Call the tool function
      const result = await toolFunction(args);

      // Return formatted JSON response
      return asTextContentResult(JSON.stringify(result, null, 2));
    } catch (error: any) {
      const message = typeof error?.message === 'string' ? error.message : String(error);

      // Handle common error cases
      if (message.includes('Graph not cached')) {
        return asErrorResult({
          type: 'validation_error',
          message: 'Graph not cached. Run explore_codebase or get_call_graph first to analyze the repository.',
          code: 'GRAPH_NOT_CACHED',
          recoverable: true,
          suggestion: 'Call explore_codebase or one of the get_*_graph tools first to analyze and cache the repository graph.',
        });
      }

      return asErrorResult({
        type: 'internal_error',
        message: `${toolName} failed: ${message}`,
        code: 'TOOL_EXECUTION_FAILED',
        recoverable: false,
        reportable: true,
      });
    }
  };
}

/**
 * Create tool metadata for each task-specific query tool
 */
function createTaskQueryTool(config: {
  name: string;
  description: string;
  inputSchema: any;
  handler: Function;
}): {
  metadata: any;
  tool: Tool;
  handler: HandlerFunction;
} {
  const metadata = {
    resource: 'queries',
    operation: 'read',
    tags: ['task-specific', 'query'],
  };

  const tool: Tool = {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
  };

  const handler = createTaskQueryHandler(config.handler, config.name);

  return { metadata, tool, handler };
}

// Create individual tool definitions
export const findCallSitesToolDef = createTaskQueryTool(findCallSitesTool);
export const traceCallChainToolDef = createTaskQueryTool(traceCallChainTool);
export const findDefinitionToolDef = createTaskQueryTool(findDefinitionTool);
export const traceDataFlowToolDef = createTaskQueryTool(traceDataFlowTool);

// Export all task query tools as an array for easy registration
export const taskQueryTools = [
  findCallSitesToolDef,
  traceCallChainToolDef,
  findDefinitionToolDef,
  traceDataFlowToolDef,
];
