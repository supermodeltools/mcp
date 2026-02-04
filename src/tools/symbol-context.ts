/**
 * `symbol_context` tool -- deep dive on a specific symbol.
 *
 * Given a function, class, or method name, returns (<5KB markdown):
 *  - Definition location (file, line)
 *  - Callers (who calls this)
 *  - Callees (what this calls)
 *  - Domain membership
 *  - Related symbols in the same file
 *
 * Backed by pre-computed graphs (sub-second) with on-demand API fallback.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  Endpoint,
  HandlerFunction,
  asTextContentResult,
  asErrorResult,
} from '../types';
import {
  IndexedGraph,
  resolveOrFetchGraph,
  normalizePath,
} from '../cache/graph-cache';
import { CodeGraphNode } from '../cache/graph-types';
import { classifyApiError } from '../utils/api-helpers';
import {
  MAX_SYMBOL_CALLERS,
  MAX_SYMBOL_CALLEES,
  MAX_SYMBOL_RELATED,
} from '../constants';

export const tool: Tool = {
  name: 'symbol_context',
  description:
    `Strictly better than grep for understanding a function, class, or method. Given a symbol name, instantly returns its definition location, all callers, all callees, architectural domain, and related symbols in the same file -- structural context that grep cannot reconstruct. Sub-second, zero cost. Supports partial matching ("filter" finds "QuerySet.filter", "filter_queryset", etc.) and "ClassName.method" syntax. Use this whenever you have a symbol name from a stack trace, issue, or search result and need to understand how it connects to the rest of the codebase.`,
  inputSchema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description:
          'Name of the function, class, or method to look up. Supports "ClassName.method" syntax.',
      },
      directory: {
        type: 'string',
        description:
          'Path to the repository directory. Omit if the MCP server was started with a default workdir.',
      },
    },
    required: ['symbol'],
  },
};

export const handler: HandlerFunction = async (client, args, defaultWorkdir) => {
  const symbol = args?.symbol as string;
  const directory = (args?.directory as string) ?? defaultWorkdir;

  if (!symbol || typeof symbol !== 'string') {
    return asErrorResult({
      type: 'validation_error',
      message: 'Missing required "symbol" parameter.',
      code: 'MISSING_SYMBOL',
      recoverable: false,
      suggestion: 'Provide the name of a function, class, or method to look up.',
    });
  }

  if (!directory || typeof directory !== 'string') {
    return asErrorResult({
      type: 'validation_error',
      message: 'No directory provided and no default workdir configured.',
      code: 'MISSING_DIRECTORY',
      recoverable: false,
      suggestion: 'Provide a directory parameter or start the MCP server with a workdir argument.',
    });
  }

  let graph: IndexedGraph;
  try {
    graph = await resolveOrFetchGraph(client, directory);
  } catch (error: any) {
    return asErrorResult(classifyApiError(error));
  }

  // Find the symbol
  const matches = findSymbol(graph, symbol);

  if (matches.length === 0) {
    return asTextContentResult(
      `No symbol matching "${symbol}" found in the code graph.\n\n` +
      `Try:\n` +
      `- A different spelling or casing\n` +
      `- Just the function name without the class prefix\n` +
      `- Use the \`overview\` tool to see available domains and key functions`
    );
  }

  // Render results for top matches (usually 1, sometimes a few)
  const rendered = matches
    .slice(0, 3)
    .map(node => renderSymbolContext(graph, node))
    .join('\n---\n\n');

  if (matches.length > 3) {
    return asTextContentResult(
      rendered + `\n\n*... and ${matches.length - 3} more matches. Use a more specific name to narrow results.*`
    );
  }

  return asTextContentResult(rendered);
};

// ── Symbol lookup ──

function findSymbol(graph: IndexedGraph, query: string): CodeGraphNode[] {
  const lowerQuery = query.toLowerCase();

  // Handle "ClassName.method" syntax
  let className: string | null = null;
  let methodName: string | null = null;
  if (query.includes('.')) {
    const parts = query.split('.');
    className = parts[0];
    methodName = parts.slice(1).join('.');
  }

  // Strategy 1: Exact name match
  const exactIds = graph.nameIndex.get(lowerQuery) || [];
  if (exactIds.length > 0) {
    return exactIds
      .map(id => graph.nodeById.get(id)!)
      .filter(n => n && isCodeSymbol(n))
      .sort((a, b) => symbolPriority(a) - symbolPriority(b));
  }

  // Strategy 2: ClassName.method match
  if (className && methodName) {
    const methodIds = graph.nameIndex.get(methodName.toLowerCase()) || [];
    const classIds = graph.nameIndex.get(className.toLowerCase()) || [];
    const classFilePaths = new Set(
      classIds.map(id => graph.nodeById.get(id)?.properties?.filePath as string).filter(Boolean)
    );

    const matched = methodIds
      .map(id => graph.nodeById.get(id)!)
      .filter(n => {
        if (!n || !isCodeSymbol(n)) return false;
        const fp = n.properties?.filePath as string;
        return fp && classFilePaths.has(fp);
      });

    if (matched.length > 0) {
      return matched.sort((a, b) => symbolPriority(a) - symbolPriority(b));
    }
  }

  // Strategy 3: Substring match (for partial names)
  const substringMatches: CodeGraphNode[] = [];
  for (const [name, ids] of graph.nameIndex) {
    if (name.includes(lowerQuery) || lowerQuery.includes(name)) {
      for (const id of ids) {
        const node = graph.nodeById.get(id);
        if (node && isCodeSymbol(node)) {
          substringMatches.push(node);
        }
      }
    }
  }

  // Sort by relevance: exact prefix > contains > contained-in
  substringMatches.sort((a, b) => {
    const aName = (a.properties?.name as string || '').toLowerCase();
    const bName = (b.properties?.name as string || '').toLowerCase();
    const aPrefix = aName.startsWith(lowerQuery) ? 0 : 1;
    const bPrefix = bName.startsWith(lowerQuery) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    return symbolPriority(a) - symbolPriority(b);
  });

  return substringMatches.slice(0, 10);
}

function isCodeSymbol(node: CodeGraphNode): boolean {
  const label = node.labels?.[0];
  return label === 'Function' || label === 'Class' || label === 'Type';
}

function symbolPriority(node: CodeGraphNode): number {
  const label = node.labels?.[0];
  if (label === 'Function') return 0;
  if (label === 'Class') return 1;
  if (label === 'Type') return 2;
  return 3;
}

// ── Rendering ──

function renderSymbolContext(graph: IndexedGraph, node: CodeGraphNode): string {
  const name = node.properties?.name as string || '(unknown)';
  const filePath = normalizePath(node.properties?.filePath as string || '');
  const startLine = node.properties?.startLine as number || 0;
  const endLine = node.properties?.endLine as number || 0;
  const kind = node.properties?.kind as string || node.labels?.[0]?.toLowerCase() || 'symbol';
  const language = node.properties?.language as string || '';

  const lines: string[] = [];

  // Header
  lines.push(`## ${name}`);
  lines.push('');
  lines.push(`**Defined in:** ${filePath}${startLine ? ':' + startLine : ''}${endLine ? '-' + endLine : ''}`);
  lines.push(`**Type:** ${kind}${language ? ' (' + language + ')' : ''}`);

  // Domain
  const domain = findDomain(graph, node.id);
  if (domain) {
    lines.push(`**Domain:** ${domain}`);
  }
  lines.push('');

  // Callers
  const adj = graph.callAdj.get(node.id);
  if (adj && adj.in.length > 0) {
    lines.push(`### Called by (${adj.in.length} callers):`);
    lines.push('');
    const callers = adj.in
      .map(id => graph.nodeById.get(id))
      .filter((n): n is CodeGraphNode => !!n)
      .sort((a, b) => {
        const aPath = a.properties?.filePath as string || '';
        const bPath = b.properties?.filePath as string || '';
        return aPath.localeCompare(bPath);
      })
      .slice(0, MAX_SYMBOL_CALLERS);

    for (const caller of callers) {
      const cName = caller.properties?.name as string || '(unknown)';
      const cFile = normalizePath(caller.properties?.filePath as string || '');
      const cLine = caller.properties?.startLine as number || 0;
      lines.push(`- \`${cName}\` — ${cFile}${cLine ? ':' + cLine : ''}`);
    }

    if (adj.in.length > MAX_SYMBOL_CALLERS) {
      lines.push(`- *... and ${adj.in.length - MAX_SYMBOL_CALLERS} more*`);
    }
    lines.push('');
  }

  // Callees
  if (adj && adj.out.length > 0) {
    lines.push(`### Calls (${adj.out.length} functions):`);
    lines.push('');
    const callees = adj.out
      .map(id => graph.nodeById.get(id))
      .filter((n): n is CodeGraphNode => !!n)
      .slice(0, MAX_SYMBOL_CALLEES);

    for (const callee of callees) {
      const cName = callee.properties?.name as string || '(unknown)';
      const cFile = normalizePath(callee.properties?.filePath as string || '');
      const cLine = callee.properties?.startLine as number || 0;
      lines.push(`- \`${cName}\` — ${cFile}${cLine ? ':' + cLine : ''}`);
    }

    if (adj.out.length > MAX_SYMBOL_CALLEES) {
      lines.push(`- *... and ${adj.out.length - MAX_SYMBOL_CALLEES} more*`);
    }
    lines.push('');
  }

  // Related symbols in same file
  if (filePath) {
    const pathEntry = graph.pathIndex.get(filePath);
    if (pathEntry) {
      const relatedIds = [
        ...pathEntry.functionIds,
        ...pathEntry.classIds,
        ...pathEntry.typeIds,
      ].filter(id => id !== node.id);

      if (relatedIds.length > 0) {
        lines.push(`### Other symbols in ${filePath}:`);
        lines.push('');

        const related = relatedIds
          .map(id => graph.nodeById.get(id))
          .filter((n): n is CodeGraphNode => !!n)
          .sort((a, b) => {
            const aLine = a.properties?.startLine as number || 0;
            const bLine = b.properties?.startLine as number || 0;
            return aLine - bLine;
          })
          .slice(0, MAX_SYMBOL_RELATED);

        for (const rel of related) {
          const rName = rel.properties?.name as string || '(unknown)';
          const rKind = rel.labels?.[0]?.toLowerCase() || '';
          const rLine = rel.properties?.startLine as number || 0;
          lines.push(`- \`${rName}\` (${rKind}) — line ${rLine}`);
        }

        if (relatedIds.length > MAX_SYMBOL_RELATED) {
          lines.push(`- *... and ${relatedIds.length - MAX_SYMBOL_RELATED} more*`);
        }
        lines.push('');
      }
    }
  }

  // Import relationships (for files containing this symbol)
  if (filePath) {
    const fileEntry = graph.pathIndex.get(filePath);
    if (fileEntry?.fileId) {
      const fileAdj = graph.importAdj.get(fileEntry.fileId);
      if (fileAdj) {
        const importedBy = fileAdj.in.length;
        const imports = fileAdj.out.length;
        if (importedBy > 0 || imports > 0) {
          lines.push(`### File imports:`);
          lines.push(`- Imported by ${importedBy} files | Imports ${imports} modules`);
          lines.push('');
        }
      }
    }
  }

  return lines.join('\n');
}

function findDomain(graph: IndexedGraph, nodeId: string): string | null {
  for (const [domainName, data] of graph.domainIndex) {
    if (data.memberIds.includes(nodeId)) {
      return domainName;
    }
  }
  return null;
}

export default { tool, handler } as Endpoint;
