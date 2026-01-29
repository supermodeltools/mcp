/**
 * Shared utilities for API operations across graph tools.
 * Extracted to eliminate code duplication between graph-tools.ts and create-supermodel-graph.ts.
 */

import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { basename, resolve } from 'path';
import { StructuredError } from '../types';

export const REPORT_REPO = 'https://github.com/supermodeltools/mcp.git';
export const REPORT_SUGGESTION = 'This may be a bug in the MCP server. You can help by opening an issue at https://github.com/supermodeltools/mcp/issues with the error details, or fork the repo and open a PR with a fix.';

/**
 * Format bytes as human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Generate an idempotency key in format {repo}-{pathHash}:{graphType}:{hash}
 * Includes path hash to prevent collisions between same-named repos
 */
export function generateIdempotencyKey(directory: string, graphType = 'supermodel'): string {
  const repoName = basename(directory);
  const absolutePath = resolve(directory);

  // Always include path hash to prevent collisions
  const pathHash = createHash('sha1').update(absolutePath).digest('hex').substring(0, 7);

  let hash: string;
  let statusHash = '';

  try {
    // Get git commit hash
    hash = execSync('git rev-parse --short HEAD', {
      cwd: directory,
      encoding: 'utf-8',
    }).trim();

    // Include working tree status in hash to detect uncommitted changes
    const statusOutput = execSync('git status --porcelain', {
      cwd: directory,
      encoding: 'utf-8',
    }).toString();

    if (statusOutput) {
      // Create hash of status output
      statusHash = '-' + createHash('sha1')
        .update(statusOutput)
        .digest('hex')
        .substring(0, 7);
    }
  } catch {
    // Fallback for non-git directories: use path hash as main identifier
    hash = pathHash;
  }

  return `${repoName}-${pathHash}:${graphType}:${hash}${statusHash}`;
}

/**
 * Classify an API error into a structured error response.
 * Extracts HTTP status, network conditions, and timeout signals
 * to produce an agent-actionable error with recovery guidance.
 */
export function classifyApiError(error: any): StructuredError {
  // Guard against non-Error throws (strings, nulls, plain objects)
  if (!error || typeof error !== 'object') {
    return {
      type: 'internal_error',
      message: typeof error === 'string' ? error : 'An unexpected error occurred.',
      code: 'UNKNOWN_ERROR',
      recoverable: false,
      reportable: true,
      repo: REPORT_REPO,
      suggestion: REPORT_SUGGESTION,
      details: { errorType: typeof error },
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
          details: { apiKeySet: !!process.env.SUPERMODEL_API_KEY, httpStatus: 401 },
        };
      case 403:
        return {
          type: 'authorization_error',
          message: 'API key does not have permission for this operation.',
          code: 'FORBIDDEN',
          recoverable: false,
          suggestion: 'Verify your API key has the correct permissions. Contact support if unexpected.',
          details: { httpStatus: 403 },
        };
      case 404:
        return {
          type: 'not_found_error',
          message: 'API endpoint not found.',
          code: 'ENDPOINT_NOT_FOUND',
          recoverable: false,
          suggestion: 'Check SUPERMODEL_BASE_URL environment variable. Default: https://api.supermodeltools.com',
          details: { baseUrl: process.env.SUPERMODEL_BASE_URL || 'https://api.supermodeltools.com', httpStatus: 404 },
        };
      case 429:
        return {
          type: 'rate_limit_error',
          message: 'API rate limit exceeded.',
          code: 'RATE_LIMITED',
          recoverable: true,
          suggestion: 'Wait 30-60 seconds and retry. Consider analyzing smaller subdirectories to reduce API calls.',
          details: { httpStatus: 429 },
        };
      case 500:
      case 502:
      case 503:
      case 504:
        return {
          type: 'internal_error',
          message: `Supermodel API server error (HTTP ${status}).`,
          code: 'SERVER_ERROR',
          recoverable: true,
          reportable: true,
          repo: REPORT_REPO,
          suggestion: 'The API may be temporarily unavailable. Wait a few minutes and retry. If persistent, open an issue at https://github.com/supermodeltools/mcp/issues with the error details, or fork the repo and open a PR with a fix.',
          details: { httpStatus: status },
        };
      default: {
        const isServerError = status >= 500;
        return {
          type: isServerError ? 'internal_error' : 'validation_error',
          message: `API request failed with HTTP ${status}.`,
          code: 'API_ERROR',
          recoverable: isServerError,
          ...(isServerError && {
            reportable: true,
            repo: REPORT_REPO,
            suggestion: 'The API may be temporarily unavailable. Wait a few minutes and retry. If persistent, open an issue at https://github.com/supermodeltools/mcp/issues with the error details, or fork the repo and open a PR with a fix.',
          }),
          ...(!isServerError && { suggestion: 'Check the request parameters and base URL configuration.' }),
          details: { httpStatus: status },
        };
      }
    }
  }

  if (error.request) {
    // Distinguish timeout from general network failure
    if (error.code === 'UND_ERR_HEADERS_TIMEOUT' || error.code === 'UND_ERR_BODY_TIMEOUT' || error.message?.includes('timeout')) {
      return {
        type: 'timeout_error',
        message: 'API request timed out. The codebase may be too large for a single analysis.',
        code: 'REQUEST_TIMEOUT',
        recoverable: true,
        suggestion: 'Analyze a smaller subdirectory (e.g. directory="/repo/src/core") or increase SUPERMODEL_TIMEOUT_MS.',
      };
    }

    return {
      type: 'network_error',
      message: 'No response from Supermodel API server.',
      code: 'NO_RESPONSE',
      recoverable: true,
      suggestion: 'Check network connectivity. Verify the API is reachable at the configured base URL.',
      details: { baseUrl: process.env.SUPERMODEL_BASE_URL || 'https://api.supermodeltools.com' },
    };
  }

  // Catch-all for unexpected errors - include the actual message
  return {
    type: 'internal_error',
    message: error.message || 'An unexpected error occurred.',
    code: 'UNKNOWN_ERROR',
    recoverable: false,
    reportable: true,
    repo: REPORT_REPO,
    suggestion: REPORT_SUGGESTION,
    details: { errorType: error.name || 'Error' },
  };
}
