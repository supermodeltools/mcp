/**
 * jq filtering utilities for JSON response transformation.
 * Provides optional jq filter application to API responses.
 * @module filtering
 */
// @ts-nocheck
import initJq from 'jq-web';

/**
 * Optionally applies a jq filter to a response object.
 * @param jqFilter - The jq filter string, or undefined to skip filtering
 * @param response - The JSON response to filter
 * @returns The filtered response, or the original response if no filter provided
 */
export async function maybeFilter(jqFilter: unknown | undefined, response: any): Promise<any> {
  if (jqFilter && typeof jqFilter === 'string') {
    return await jq(response, jqFilter);
  } else {
    return response;
  }
}

/**
 * Applies a jq filter to JSON data.
 * @param json - The JSON data to filter
 * @param jqFilter - The jq filter expression
 * @returns The filtered result
 */
async function jq(json: any, jqFilter: string) {
  return (await initJq).json(json, jqFilter);
}

/**
 * Type guard to check if an error is a jq parsing error.
 * @param error - The error to check
 * @returns True if the error is a jq-related error with stderr output
 */
export function isJqError(error: any): error is Error {
  return error instanceof Error && 'stderr' in error;
}

