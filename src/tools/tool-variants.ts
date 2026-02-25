/**
 * Experimental tool variants to test parallel calling behavior.
 *
 * Each variant reuses the same underlying graph + handler logic from
 * symbol-context.ts but changes the tool name, description, and/or
 * schema to test whether framing affects the model's willingness to
 * call MCP tools in parallel with built-in tools (Read, Grep, etc.).
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Endpoint, HandlerFunction, asTextContentResult, asErrorResult } from '../types';
import {
  IndexedGraph,
  resolveOrFetchGraph,
  normalizePath,
} from '../cache/graph-cache';
import { CodeGraphNode } from '../cache/graph-types';
import { findSymbol, renderBriefSymbolContext } from './symbol-context';
import {
  MAX_SYMBOL_CALLERS,
  MAX_SYMBOL_CALLEES,
} from '../constants';

// ─── Variant D: "search_symbol" ────────────────────────────────────
// Hypothesis: framing as a search operation (like Grep/Glob) makes the
// model treat it as parallel-safe alongside other search tools.

export const searchSymbolTool: Tool = {
  name: 'search_symbol',
  description:
    'Search for a function, class, or method by name. Returns file location, callers, and callees. Like Grep but for code structure. Safe to call alongside Read, Grep, and Glob.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Function, class, or method name to search for.',
      },
      directory: {
        type: 'string',
        description: 'Repository path. Omit to use default.',
      },
    },
    required: ['query'],
  },
  annotations: { readOnlyHint: true },
};

const searchSymbolHandler: HandlerFunction = async (client, args, defaultWorkdir) => {
  const query = typeof args?.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return asErrorResult({
      type: 'validation_error',
      message: 'Missing required "query" parameter.',
      code: 'MISSING_QUERY',
      recoverable: false,
      suggestion: 'Provide the name of a function, class, or method to search for.',
    });
  }

  const rawDir = args?.directory as string | undefined;
  const directory = (rawDir && rawDir.trim()) || defaultWorkdir || process.cwd();

  let graph: IndexedGraph;
  try {
    graph = await resolveOrFetchGraph(client, directory);
  } catch (error: any) {
    return asErrorResult({ type: 'internal_error', message: error.message, code: 'GRAPH_ERROR', recoverable: false });
  }

  const matches = findSymbol(graph, query);
  if (matches.length === 0) {
    return asTextContentResult(`No symbol matching "${query}" found.`);
  }

  // Always brief — keep response small so model doesn't "wait for it"
  const parts = matches.slice(0, 3).map(node => renderBriefSymbolContext(graph, node));
  let result = parts.join('\n---\n\n');
  if (matches.length > 3) {
    result += `\n\n*... and ${matches.length - 3} more matches.*`;
  }
  return asTextContentResult(result);
};

export const searchSymbolEndpoint: Endpoint = { tool: searchSymbolTool, handler: searchSymbolHandler };


// ─── Variant E: Split into find_definition + trace_calls ───────────
// Hypothesis: two small tools give the model reason to call them in
// parallel with each other AND with built-in tools.

export const findDefinitionTool: Tool = {
  name: 'find_definition',
  description:
    'Find where a function, class, or method is defined. Returns file path and line number. Fast, read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Symbol name to find.',
      },
      directory: {
        type: 'string',
        description: 'Repository path. Omit to use default.',
      },
    },
    required: ['name'],
  },
  annotations: { readOnlyHint: true },
};

const findDefinitionHandler: HandlerFunction = async (client, args, defaultWorkdir) => {
  const name = typeof args?.name === 'string' ? args.name.trim() : '';
  if (!name) {
    return asErrorResult({
      type: 'validation_error',
      message: 'Missing required "name" parameter.',
      code: 'MISSING_NAME',
      recoverable: false,
    });
  }

  const rawDir = args?.directory as string | undefined;
  const directory = (rawDir && rawDir.trim()) || defaultWorkdir || process.cwd();

  let graph: IndexedGraph;
  try {
    graph = await resolveOrFetchGraph(client, directory);
  } catch (error: any) {
    return asErrorResult({ type: 'internal_error', message: error.message, code: 'GRAPH_ERROR', recoverable: false });
  }

  const matches = findSymbol(graph, name);
  if (matches.length === 0) {
    return asTextContentResult(`No symbol matching "${name}" found.`);
  }

  // Ultra-compact: just location lines
  const lines = matches.slice(0, 5).map(node => {
    const sym = node.properties?.name as string || '(unknown)';
    const fp = normalizePath(node.properties?.filePath as string || '');
    const start = node.properties?.startLine as number || 0;
    const end = node.properties?.endLine as number || 0;
    const kind = node.labels?.[0]?.toLowerCase() || 'symbol';
    return `${sym} (${kind}) — ${fp}:${start}-${end}`;
  });

  return asTextContentResult(lines.join('\n'));
};

export const findDefinitionEndpoint: Endpoint = { tool: findDefinitionTool, handler: findDefinitionHandler };


export const traceCallsTool: Tool = {
  name: 'trace_calls',
  description:
    'Get the caller/callee graph for a function or method. Shows who calls it and what it calls. Fast, read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Symbol name to trace.',
      },
      directory: {
        type: 'string',
        description: 'Repository path. Omit to use default.',
      },
    },
    required: ['name'],
  },
  annotations: { readOnlyHint: true },
};

const traceCallsHandler: HandlerFunction = async (client, args, defaultWorkdir) => {
  const name = typeof args?.name === 'string' ? args.name.trim() : '';
  if (!name) {
    return asErrorResult({
      type: 'validation_error',
      message: 'Missing required "name" parameter.',
      code: 'MISSING_NAME',
      recoverable: false,
    });
  }

  const rawDir = args?.directory as string | undefined;
  const directory = (rawDir && rawDir.trim()) || defaultWorkdir || process.cwd();

  let graph: IndexedGraph;
  try {
    graph = await resolveOrFetchGraph(client, directory);
  } catch (error: any) {
    return asErrorResult({ type: 'internal_error', message: error.message, code: 'GRAPH_ERROR', recoverable: false });
  }

  const matches = findSymbol(graph, name);
  if (matches.length === 0) {
    return asTextContentResult(`No symbol matching "${name}" found.`);
  }

  const node = matches[0];
  const sym = node.properties?.name as string || '(unknown)';
  const adj = graph.callAdj.get(node.id);
  const lines: string[] = [`## ${sym}`];

  if (adj && adj.in.length > 0) {
    lines.push(`\n**Called by (${adj.in.length}):**`);
    adj.in
      .map(id => graph.nodeById.get(id))
      .filter((n): n is CodeGraphNode => !!n)
      .slice(0, MAX_SYMBOL_CALLERS)
      .forEach(n => {
        const cName = n.properties?.name as string || '?';
        const cFile = normalizePath(n.properties?.filePath as string || '');
        const cLine = n.properties?.startLine as number || 0;
        lines.push(`- \`${cName}\` — ${cFile}:${cLine}`);
      });
  }

  if (adj && adj.out.length > 0) {
    lines.push(`\n**Calls (${adj.out.length}):**`);
    adj.out
      .map(id => graph.nodeById.get(id))
      .filter((n): n is CodeGraphNode => !!n)
      .slice(0, MAX_SYMBOL_CALLEES)
      .forEach(n => {
        const cName = n.properties?.name as string || '?';
        const cFile = normalizePath(n.properties?.filePath as string || '');
        const cLine = n.properties?.startLine as number || 0;
        lines.push(`- \`${cName}\` — ${cFile}:${cLine}`);
      });
  }

  return asTextContentResult(lines.join('\n'));
};

export const traceCallsEndpoint: Endpoint = { tool: traceCallsTool, handler: traceCallsHandler };


// ─── Variant F: "annotate" ─────────────────────────────────────────
// Hypothesis: framing as supplementary enrichment ("annotate your work")
// makes the model fire it alongside other tools instead of waiting.

export const annotateTool: Tool = {
  name: 'annotate',
  description:
    'Enrich your understanding with structural metadata for a symbol — definition location, callers, callees. Fire alongside Read or Grep to get parallel context. Read-only, zero side effects.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Function, class, or method name.',
      },
      directory: {
        type: 'string',
        description: 'Repository path. Omit to use default.',
      },
    },
    required: ['symbol'],
  },
  annotations: { readOnlyHint: true },
};

const annotateHandler: HandlerFunction = async (client, args, defaultWorkdir) => {
  const symbol = typeof args?.symbol === 'string' ? args.symbol.trim() : '';
  if (!symbol) {
    return asErrorResult({
      type: 'validation_error',
      message: 'Missing required "symbol" parameter.',
      code: 'MISSING_SYMBOL',
      recoverable: false,
    });
  }

  const rawDir = args?.directory as string | undefined;
  const directory = (rawDir && rawDir.trim()) || defaultWorkdir || process.cwd();

  let graph: IndexedGraph;
  try {
    graph = await resolveOrFetchGraph(client, directory);
  } catch (error: any) {
    return asErrorResult({ type: 'internal_error', message: error.message, code: 'GRAPH_ERROR', recoverable: false });
  }

  const matches = findSymbol(graph, symbol);
  if (matches.length === 0) {
    return asTextContentResult(`No symbol matching "${symbol}" found.`);
  }

  const parts = matches.slice(0, 3).map(node => renderBriefSymbolContext(graph, node));
  let result = parts.join('\n---\n\n');
  if (matches.length > 3) {
    result += `\n\n*... and ${matches.length - 3} more matches.*`;
  }
  return asTextContentResult(result);
};

export const annotateEndpoint: Endpoint = { tool: annotateTool, handler: annotateHandler };
