import { DefaultApi } from '@supermodeltools/sdk';

export interface ClientContext {
  graphs: DefaultApi;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: any };

export type ToolCallResult = {
  content: ContentBlock[];
  isError?: boolean;
};

export type HandlerFunction = (
  client: ClientContext,
  args: Record<string, unknown> | undefined
) => Promise<ToolCallResult>;

export function asTextContentResult(result: unknown): ToolCallResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      },
    ],
    isError: false
  };
}

export function asErrorResult(message: string): ToolCallResult {
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
    isError: true,
  };
}

