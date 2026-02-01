/**
 * Tool for agents to submit feature requests as GitHub issues.
 * Creates issues on the supermodeltools/mcp repository.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  Metadata,
  HandlerFunction,
  asErrorResult,
  ClientContext,
} from '../types';
import {
  GITHUB_REPO,
  validateGitHubToken,
  validateRequiredString,
  validateLabels,
  createGitHubIssue,
} from '../utils/github';

export const metadata: Metadata = {
  resource: 'issues',
  operation: 'write',
  tags: ['feature-request', 'github'],
  httpMethod: 'post',
  httpPath: '/repos/supermodeltools/mcp/issues',
  operationId: 'createFeatureRequest',
};

export const tool: Tool = {
  name: 'request_feature',
  description: `Submit a feature request to the Supermodel MCP server GitHub repository (${GITHUB_REPO}).

Creates a GitHub issue on behalf of the agent. The Supermodel team actively monitors and responds to all submitted issues.

Use this tool whenever you believe a new feature, improvement, or enhancement would be helpful for the Supermodel MCP server or its underlying API. Examples include:
- Suggesting a new tool, query type, or graph capability
- Requesting improvements to an existing tool (e.g. better filtering, new parameters, improved output format)
- Proposing changes to error messages, documentation, or developer experience
- Identifying a missing capability you needed while working on a task

This tool requires a GITHUB_TOKEN environment variable. To set it up:
1. Create a GitHub personal access token at https://github.com/settings/tokens with the "public_repo" scope
2. Set it in your environment: export GITHUB_TOKEN=ghp_your_token_here
3. Restart the MCP server`,
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short, descriptive title for the feature request.',
      },
      description: {
        type: 'string',
        description: 'Detailed description of the feature. Include context, use cases, and expected behavior.',
      },
      labels: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional labels to categorize the issue (e.g. ["enhancement"]).',
      },
    },
    required: ['title', 'description'],
  },
};

export const handler: HandlerFunction = async (
  _client: ClientContext,
  args: Record<string, unknown> | undefined,
) => {
  const tokenError = validateGitHubToken();
  if (tokenError) return asErrorResult(tokenError);

  if (!args) {
    return asErrorResult({
      type: 'validation_error',
      message: 'Missing required parameters: title and description.',
      code: 'MISSING_PARAMETERS',
      recoverable: false,
      suggestion: 'Provide both "title" and "description" parameters.',
    });
  }

  const { title, description, labels } = args as {
    title?: unknown;
    description?: unknown;
    labels?: unknown;
  };

  const titleError = validateRequiredString(
    title, 'title', 'INVALID_TITLE',
    'Provide a short, descriptive title as a string.',
  );
  if (titleError) return asErrorResult(titleError);

  const descError = validateRequiredString(
    description, 'description', 'INVALID_DESCRIPTION',
    'Provide a detailed description as a string.',
  );
  if (descError) return asErrorResult(descError);

  const labelsError = validateLabels(labels);
  if (labelsError) return asErrorResult(labelsError);

  return createGitHubIssue(
    'request_feature',
    {
      title: title as string,
      body: description as string,
      labels: labels as string[] | undefined,
    },
    'Feature request created successfully.',
  );
};

export default { metadata, tool, handler };
