/**
 * `symbol_context` tool -- deep dive on a specific symbol.
 *
 * Given a function, class, or method name, returns (<10KB markdown):
 *  - Definition location (file, line)
 *  - Source code (up to MAX_SOURCE_LINES)
 *  - Callers (who calls this)
 *  - Callees (what this calls)
 *  - Domain membership
 *  - Related symbols in the same file
 *
 * Backed by pre-computed graphs (sub-second) with on-demand API fallback.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
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
  MAX_SOURCE_LINES,
} from '../constants';

export const tool: Tool = {
  name: 'symbol_context',
  description:
    `Strictly better than grep for understanding a function, class, or method. Given a symbol name, instantly returns its source code, definition location, all callers, all callees, architectural domain, and related symbols in the same file -- structural context that grep cannot reconstruct. Sub-second, zero cost. Supports partial matching ("filter" finds "QuerySet.filter", "filter_queryset", etc.) and "ClassName.method" syntax. IMPORTANT: Do NOT chain more than 2 symbol_context calls to trace a call path — use get_related instead, which finds the connecting path in one call. After understanding the code, make your edit and run tests to verify.`,
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
  const symbol = typeof args?.symbol === 'string' ? args.symbol.trim() : '';
  const rawDir = args?.directory as string | undefined;
  const directory = (rawDir && rawDir.trim()) || defaultWorkdir || process.cwd();

  if (!symbol) {
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
  const renderedParts = await Promise.all(
    matches.slice(0, 3).map(node => renderSymbolContext(graph, node, directory))
  );
  const rendered = renderedParts.join('\n---\n\n');

  const hint = `\n\n---\n*Tip: Need to trace a call chain? Use \`get_related\` with start and end symbols instead of chaining symbol_context calls. Ready to fix? Edit the code and run tests.*`;

  if (matches.length > 3) {
    return asTextContentResult(
      rendered + `\n\n*... and ${matches.length - 3} more matches. Use a more specific name to narrow results.*` + hint
    );
  }

  return asTextContentResult(rendered + hint);
};

// ── Symbol lookup ──

export function findSymbol(graph: IndexedGraph, query: string): CodeGraphNode[] {
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
      .sort((a, b) => {
        const pDiff = symbolPriority(a) - symbolPriority(b);
        if (pDiff !== 0) return pDiff;
        return callerCount(graph, b) - callerCount(graph, a);
      });
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
      return matched.sort((a, b) => {
        const pDiff = symbolPriority(a) - symbolPriority(b);
        if (pDiff !== 0) return pDiff;
        return callerCount(graph, b) - callerCount(graph, a);
      });
    }
  }

  // Strategy 3: Substring match (for partial names)
  if (lowerQuery.length < 2) {
    return [];
  }

  const substringMatches: CodeGraphNode[] = [];
  for (const [name, ids] of graph.nameIndex) {
    if (name.includes(lowerQuery)) {
      for (const id of ids) {
        const node = graph.nodeById.get(id);
        if (node && isCodeSymbol(node)) {
          substringMatches.push(node);
        }
      }
    }
  }

  // Sort by relevance: exact prefix > contains, then symbol priority, then caller count
  substringMatches.sort((a, b) => {
    const aName = (a.properties?.name as string || '').toLowerCase();
    const bName = (b.properties?.name as string || '').toLowerCase();
    const aPrefix = aName.startsWith(lowerQuery) ? 0 : 1;
    const bPrefix = bName.startsWith(lowerQuery) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    const pDiff = symbolPriority(a) - symbolPriority(b);
    if (pDiff !== 0) return pDiff;
    return callerCount(graph, b) - callerCount(graph, a);
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

function callerCount(graph: IndexedGraph, node: CodeGraphNode): number {
  return graph.callAdj.get(node.id)?.in.length || 0;
}

// ── Rendering ──

export async function renderSymbolContext(graph: IndexedGraph, node: CodeGraphNode, directory: string): Promise<string> {
  const name = node.properties?.name as string || '(unknown)';
  const rawFilePath = node.properties?.filePath as string || '';
  const filePath = normalizePath(rawFilePath);
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

  // Source code
  if (filePath && startLine > 0) {
    try {
      const absPath = path.resolve(directory, filePath);
      const content = await fs.readFile(absPath, 'utf-8');
      const fileLines = content.split('\n');
      const end = endLine > 0 ? Math.min(endLine, startLine + MAX_SOURCE_LINES - 1) : startLine + MAX_SOURCE_LINES - 1;
      const sourceSlice = fileLines.slice(startLine - 1, end);
      if (sourceSlice.length > 0) {
        const lang = languageFromExtension(filePath);
        lines.push(`### Source`);
        lines.push('');
        lines.push(`\`\`\`${lang}`);
        lines.push(sourceSlice.join('\n'));
        lines.push('```');
        if (endLine > 0 && endLine > startLine + MAX_SOURCE_LINES - 1) {
          lines.push(`*... truncated (showing ${MAX_SOURCE_LINES} of ${endLine - startLine + 1} lines)*`);
        }
        lines.push('');
      }
    } catch {
      // File unreadable — skip source section silently
    }
  }

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
    const pathEntry = graph.pathIndex.get(filePath) ?? graph.pathIndex.get(rawFilePath);
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
    const fileEntry = graph.pathIndex.get(filePath) ?? graph.pathIndex.get(rawFilePath);
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

export function languageFromExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.py': 'python',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.kt': 'kotlin',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.hpp': 'cpp',
    '.swift': 'swift',
    '.php': 'php',
    '.scala': 'scala',
    '.sh': 'bash',
    '.bash': 'bash',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.json': 'json',
    '.xml': 'xml',
    '.html': 'html',
    '.css': 'css',
    '.sql': 'sql',
    '.r': 'r',
    '.lua': 'lua',
    '.dart': 'dart',
    '.ex': 'elixir',
    '.exs': 'elixir',
    '.erl': 'erlang',
    '.hs': 'haskell',
    '.ml': 'ocaml',
    '.clj': 'clojure',
  };
  return map[ext] || '';
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
