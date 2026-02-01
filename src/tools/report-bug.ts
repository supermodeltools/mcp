/**
 * Tool for agents to submit bug reports as GitHub issues.
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
  validateOptionalString,
  validateLabels,
  createGitHubIssue,
} from '../utils/github';

export const metadata: Metadata = {
  resource: 'issues',
  operation: 'write',
  tags: ['bug-report', 'github'],
  httpMethod: 'post',
  httpPath: '/repos/supermodeltools/mcp/issues',
  operationId: 'createBugReport',
};

export const tool: Tool = {
  name: 'report_bug',
  description: `Submit a bug report to the Supermodel MCP server GitHub repository (${GITHUB_REPO}).

Creates a GitHub issue with structured fields (steps to reproduce, expected vs actual behavior) formatted into a clear bug report. The Supermodel team actively monitors and responds to all submitted issues.

Use this tool whenever you encounter a bug, error, or unexpected behavior with any Supermodel MCP tool or with the underlying Supermodel API. Examples include:
- A tool returned an error that seems incorrect or unexpected
- A tool produced results that don't match its description or documentation
- You encountered a crash, hang, timeout, or other failure that appears to be a server-side issue
- The API returned malformed, incomplete, or nonsensical data
- An edge case or specific input caused a tool to break
- You received an error with "reportable: true" in the structured error response

Providing steps_to_reproduce, expected_behavior, and actual_behavior helps the team fix bugs faster, but only title and description are required.

This tool requires a GITHUB_TOKEN environment variable. To set it up:
1. Create a GitHub personal access token at https://github.com/settings/tokens with the "public_repo" scope
2. Set it in your environment: export GITHUB_TOKEN=ghp_your_token_here
3. Restart the MCP server`,
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Short, descriptive title for the bug (e.g. "get_call_graph fails on monorepo with symlinks").',
      },
      description: {
        type: 'string',
        description: 'What happened? Describe the bug clearly.',
      },
      steps_to_reproduce: {
        type: 'string',
        description: 'Step-by-step instructions to reproduce the bug.',
      },
      expected_behavior: {
        type: 'string',
        description: 'What you expected to happen.',
      },
      actual_behavior: {
        type: 'string',
        description: 'What actually happened instead.',
      },
      labels: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional labels to categorize the issue (e.g. ["bug", "crash"]).',
      },
    },
    required: ['title', 'description'],
  },
};

/**
 * Format structured bug report fields into a markdown issue body.
 */
export function formatBugReportBody(fields: {
  description: string;
  steps_to_reproduce?: string;
  expected_behavior?: string;
  actual_behavior?: string;
}): string {
  const sections: string[] = [];

  sections.push('## Description\n\n' + fields.description);

  if (fields.steps_to_reproduce) {
    sections.push('## Steps to Reproduce\n\n' + fields.steps_to_reproduce);
  }

  if (fields.expected_behavior) {
    sections.push('## Expected Behavior\n\n' + fields.expected_behavior);
  }

  if (fields.actual_behavior) {
    sections.push('## Actual Behavior\n\n' + fields.actual_behavior);
  }

  return sections.join('\n\n');
}

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

  const {
    title,
    description,
    steps_to_reproduce,
    expected_behavior,
    actual_behavior,
    labels,
  } = args as {
    title?: unknown;
    description?: unknown;
    steps_to_reproduce?: unknown;
    expected_behavior?: unknown;
    actual_behavior?: unknown;
    labels?: unknown;
  };

  const titleError = validateRequiredString(
    title, 'title', 'INVALID_TITLE',
    'Provide a short, descriptive title for the bug.',
  );
  if (titleError) return asErrorResult(titleError);

  const descError = validateRequiredString(
    description, 'description', 'INVALID_DESCRIPTION',
    'Describe the bug clearly.',
  );
  if (descError) return asErrorResult(descError);

  const stepsError = validateOptionalString(
    steps_to_reproduce, 'steps_to_reproduce', 'INVALID_STEPS',
    'Provide steps to reproduce as a string.',
  );
  if (stepsError) return asErrorResult(stepsError);

  const expectedError = validateOptionalString(
    expected_behavior, 'expected_behavior', 'INVALID_EXPECTED_BEHAVIOR',
    'Describe expected behavior as a string.',
  );
  if (expectedError) return asErrorResult(expectedError);

  const actualError = validateOptionalString(
    actual_behavior, 'actual_behavior', 'INVALID_ACTUAL_BEHAVIOR',
    'Describe actual behavior as a string.',
  );
  if (actualError) return asErrorResult(actualError);

  const labelsError = validateLabels(labels);
  if (labelsError) return asErrorResult(labelsError);

  const body = formatBugReportBody({
    description: description as string,
    steps_to_reproduce: steps_to_reproduce as string | undefined,
    expected_behavior: expected_behavior as string | undefined,
    actual_behavior: actual_behavior as string | undefined,
  });

  return createGitHubIssue(
    'report_bug',
    {
      title: title as string,
      body,
      labels: labels as string[] | undefined,
    },
    'Bug report created successfully.',
  );
};

export default { metadata, tool, handler };
