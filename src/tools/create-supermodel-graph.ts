// @ts-nocheck
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'fs/promises';
import {
  Metadata,
  Endpoint,
  HandlerFunction,
  asTextContentResult,
  asErrorResult,
  ClientContext
} from '../types';
import { maybeFilter, isJqError } from '../filtering';

export const metadata: Metadata = {
  resource: 'graphs',
  operation: 'write',
  tags: [],
  httpMethod: 'post',
  httpPath: '/v1/graphs/supermodel',
  operationId: 'generateSupermodelGraph',
};

export const tool: Tool = {
  name: 'create_supermodel_graph_graphs',
  description:
    "When using this tool, always use the `jq_filter` parameter to reduce the response size and improve performance.\n\nOnly omit if you're sure you don't need the data.\n\nUpload a zipped repository snapshot to generate the Supermodel Intermediate Representation (SIR) artifact bundle.\n\n# Response Schema\n(Refer to the schema in the existing documentation)\n",
  inputSchema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Path to the zipped repository archive containing the code to analyze.',
      },
      'Idempotency-Key': {
        type: 'string',
      },
      jq_filter: {
        type: 'string',
        title: 'jq Filter',
        description:
          'A jq filter to apply to the response to include certain fields.',
      },
    },
    required: ['file', 'Idempotency-Key'],
  },
};

export const handler: HandlerFunction = async (client: ClientContext, args: Record<string, unknown> | undefined) => {
  if (!args) {
    return asErrorResult('No arguments provided');
  }

  const { jq_filter, file, 'Idempotency-Key': idempotencyKey } = args as any;

  if (!file || typeof file !== 'string') {
    return asErrorResult('File argument is required and must be a string path');
  }

  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return asErrorResult('Idempotency-Key argument is required');
  }

  try {
    // Read the file into a Buffer and convert to Blob
    // The SDK expects a Blob type, not a stream
    console.error('[DEBUG] Reading file:', file);
    const fileBuffer = await readFile(file);

    // Create a Blob from the buffer
    // In Node.js 18+, Blob is available globally
    const fileBlob = new Blob([fileBuffer], { type: 'application/zip' });

    console.error('[DEBUG] File size:', fileBuffer.length, 'bytes');
    console.error('[DEBUG] Making API request with idempotency key:', idempotencyKey);

    // Construct the request object
    const requestParams = {
        file: fileBlob as any,
        idempotencyKey: idempotencyKey
    };

    const response = await client.graphs.generateSupermodelGraph(requestParams);

    console.error('[DEBUG] API request successful');

    return asTextContentResult(await maybeFilter(jq_filter, response));
  } catch (error: any) {
    if (isJqError(error)) {
      return asErrorResult(error.message);
    }

    // Enhanced error logging
    console.error('[ERROR] API call failed:', error);
    console.error('[ERROR] Error name:', error.name);
    console.error('[ERROR] Error message:', error.message);
    console.error('[ERROR] Error stack:', error.stack);

    if (error.response) {
      console.error('[ERROR] Response status:', error.response.status);
      console.error('[ERROR] Response statusText:', error.response.statusText);
      console.error('[ERROR] Response headers:', error.response.headers);
      try {
        const responseText = await error.response.text();
        console.error('[ERROR] Response body:', responseText);
      } catch (e) {
        console.error('[ERROR] Could not read response body');
      }
    }

    if (error.request) {
      console.error('[ERROR] Request was made but no response received');
    }

    return asErrorResult(`API call failed: ${error.message || String(error)}. Check server logs for details.`);
  }
};

export default { metadata, tool, handler };
