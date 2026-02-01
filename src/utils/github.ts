/**
 * Shared utilities for GitHub API interactions.
 * Used by feedback tools (request_feature, report_bug) to create issues.
 */

import {
  ToolCallResult,
  asTextContentResult,
  asErrorResult,
  StructuredError,
} from '../types';
import * as logger from './logger';

export const GITHUB_REPO = 'supermodeltools/mcp';
export const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/issues`;
export const GITHUB_FETCH_TIMEOUT_MS = 15_000;

export interface GitHubIssuePayload {
  title: string;
  body: string;
  labels?: string[];
}

export interface GitHubIssueResult {
  html_url: string;
  number: number;
  title: string;
}

/**
 * Validate that GITHUB_TOKEN is set. Returns a StructuredError if not.
 */
export function validateGitHubToken(): StructuredError | null {
  if (!process.env.GITHUB_TOKEN) {
    return {
      type: 'authentication_error',
      message: 'GITHUB_TOKEN environment variable is not set.',
      code: 'MISSING_GITHUB_TOKEN',
      recoverable: false,
      suggestion: 'Set the GITHUB_TOKEN environment variable with a token that has repo scope, then restart the MCP server.',
    };
  }
  return null;
}

/**
 * Validate a required string parameter.
 * Returns a StructuredError if invalid, null if valid.
 */
export function validateRequiredString(
  value: unknown,
  paramName: string,
  code: string,
  suggestion: string,
): StructuredError | null {
  if (!value || typeof value !== 'string') {
    return {
      type: 'validation_error',
      message: `Missing or invalid "${paramName}" parameter. Must be a non-empty string.`,
      code,
      recoverable: false,
      suggestion,
    };
  }
  return null;
}

/**
 * Validate an optional string parameter.
 * Returns a StructuredError if present but invalid, null otherwise.
 */
export function validateOptionalString(
  value: unknown,
  paramName: string,
  code: string,
  suggestion: string,
): StructuredError | null {
  if (value !== undefined && (typeof value !== 'string' || value === '')) {
    return {
      type: 'validation_error',
      message: `Invalid "${paramName}" parameter. Must be a non-empty string if provided.`,
      code,
      recoverable: false,
      suggestion,
    };
  }
  return null;
}

/**
 * Validate an optional labels array.
 * Returns a StructuredError if invalid, null if valid.
 */
export function validateLabels(labels: unknown): StructuredError | null {
  if (labels === undefined) return null;

  if (!Array.isArray(labels)) {
    return {
      type: 'validation_error',
      message: 'Invalid "labels" parameter. Must be an array of strings.',
      code: 'INVALID_LABELS',
      recoverable: false,
      suggestion: 'Provide labels as an array of strings, e.g. ["enhancement", "good first issue"].',
    };
  }

  if (!labels.every((l: unknown) => typeof l === 'string')) {
    return {
      type: 'validation_error',
      message: 'Invalid "labels" parameter. All items must be strings.',
      code: 'INVALID_LABELS',
      recoverable: false,
      suggestion: 'Provide labels as an array of strings, e.g. ["enhancement", "good first issue"].',
    };
  }

  return null;
}

/**
 * Classify a GitHub API HTTP error response into a StructuredError.
 */
export function classifyGitHubHttpError(status: number, errorBody: string): StructuredError {
  switch (status) {
    case 401:
      return {
        type: 'authentication_error',
        message: 'GitHub token is invalid or expired.',
        code: 'INVALID_GITHUB_TOKEN',
        recoverable: false,
        suggestion: 'Check that GITHUB_TOKEN is valid and has not expired.',
      };
    case 403:
      return {
        type: 'authorization_error',
        message: 'GitHub token does not have permission to create issues.',
        code: 'GITHUB_FORBIDDEN',
        recoverable: false,
        suggestion: 'Ensure the GITHUB_TOKEN has "repo" or "public_repo" scope.',
      };
    case 404:
      return {
        type: 'not_found_error',
        message: `Repository ${GITHUB_REPO} not found or not accessible.`,
        code: 'REPO_NOT_FOUND',
        recoverable: false,
        suggestion: 'Check that the GitHub token has access to the repository.',
      };
    case 422:
      return {
        type: 'validation_error',
        message: `GitHub rejected the issue: ${errorBody}`,
        code: 'GITHUB_VALIDATION_ERROR',
        recoverable: false,
        suggestion: 'Check the title and description for invalid content.',
      };
    case 429:
      return {
        type: 'rate_limit_error',
        message: 'GitHub API rate limit exceeded.',
        code: 'GITHUB_RATE_LIMITED',
        recoverable: true,
        suggestion: 'Wait a few minutes and retry.',
      };
    default:
      return {
        type: 'internal_error',
        message: `GitHub API returned HTTP ${status}: ${errorBody}`,
        code: 'GITHUB_API_ERROR',
        recoverable: status >= 500,
        suggestion: status >= 500
          ? 'GitHub may be experiencing issues. Wait and retry.'
          : 'Check the request parameters.',
      };
  }
}

/**
 * Create a GitHub issue via the API.
 * Handles authentication, HTTP errors, and network failures.
 *
 * @param toolName - Name of the calling tool (for logging)
 * @param payload - The issue title, body, and optional labels
 * @param successMessage - Message to include in the success response
 * @returns ToolCallResult with success data or structured error
 */
export async function createGitHubIssue(
  toolName: string,
  payload: GitHubIssuePayload,
  successMessage: string,
): Promise<ToolCallResult> {
  const token = process.env.GITHUB_TOKEN;

  // Token was already validated by the caller, but guard anyway
  if (!token) {
    return asErrorResult({
      type: 'authentication_error',
      message: 'GITHUB_TOKEN environment variable is not set.',
      code: 'MISSING_GITHUB_TOKEN',
      recoverable: false,
      suggestion: 'Set the GITHUB_TOKEN environment variable with a token that has repo scope, then restart the MCP server.',
    });
  }

  const body: Record<string, unknown> = {
    title: payload.title,
    body: payload.body,
  };

  if (payload.labels && payload.labels.length > 0) {
    body.labels = payload.labels;
  }

  logger.debug(`[${toolName}] Creating issue:`, payload.title);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GITHUB_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(GITHUB_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(`[${toolName}] GitHub API error:`, response.status, errorBody);
      return asErrorResult(classifyGitHubHttpError(response.status, errorBody));
    }

    const issue = await response.json() as GitHubIssueResult;
    logger.debug(`[${toolName}] Issue created:`, issue.html_url);

    return asTextContentResult({
      message: successMessage,
      issue_url: issue.html_url,
      issue_number: issue.number,
      title: issue.title,
    });
  } catch (error: any) {
    logger.error(`[${toolName}] Network error:`, error.message);
    return asErrorResult({
      type: 'network_error',
      message: `Failed to reach GitHub API: ${error.message}`,
      code: 'GITHUB_NETWORK_ERROR',
      recoverable: true,
      suggestion: 'Check network connectivity and retry.',
    });
  } finally {
    clearTimeout(timeout);
  }
}
