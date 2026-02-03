/**
 * Task-specific tool: Trace data flow for a variable/parameter
 * Follow how data flows through function parameters and variables
 */

import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { graphCache } from '../cache';
import { CodeGraphNode } from '../cache/graph-types';
import { generateIdempotencyKey } from '../utils/api-helpers';

const TraceDataFlowArgsSchema = z.object({
  path: z.string().describe('Repository path'),
  variable: z.string().describe('Variable or parameter name to trace'),
  function_name: z.string().optional().describe('Function context (optional, helps narrow scope)'),
  max_depth: z.number().optional().describe('Maximum depth to trace'),
});

type TraceDataFlowArgs = z.infer<typeof TraceDataFlowArgsSchema>;

export interface DataFlowStep {
  step_type: 'definition' | 'usage' | 'assignment' | 'passed_to' | 'returned_from' | 'transformation';
  location: {
    function: string;
    file: string;
    line: number;
  };
  description: string;
  variable_name?: string;
  transformed_to?: string;
}

export interface TraceDataFlowResponse {
  variable: string;
  function_context?: string;
  found: boolean;
  flow_steps: DataFlowStep[];
  summary: string;
}

/**
 * Trace data flow for a variable/parameter
 */
export async function traceDataFlow(args: TraceDataFlowArgs): Promise<TraceDataFlowResponse> {
  const { path, variable, function_name, max_depth = 5 } = args;

  // Get cached graph
  const cacheKey = getCacheKey(path);
  const graph = graphCache.get(cacheKey);

  if (!graph) {
    throw new Error(
      'Graph not cached. Run explore_codebase first to analyze the repository.'
    );
  }

  // Find variable/parameter nodes
  const variableNodes = findVariablesByName(graph, variable, function_name);

  if (variableNodes.length === 0) {
    return {
      variable,
      function_context: function_name,
      found: false,
      flow_steps: [],
      summary: function_name
        ? `Variable "${variable}" not found in function "${function_name}".`
        : `Variable "${variable}" not found in codebase.`,
    };
  }

  // Build flow steps from the variable node
  const flowSteps: DataFlowStep[] = [];
  const visited = new Set<string>();

  // Start with the first matching variable
  const startNode = variableNodes[0];
  traceFromNode(graph, startNode, flowSteps, visited, 0, max_depth);

  // If no flow found, at least report the definition
  if (flowSteps.length === 0) {
    const props = startNode.properties || {};
    flowSteps.push({
      step_type: 'definition',
      location: {
        function: props.scope as string || 'unknown',
        file: props.filePath as string || 'unknown',
        line: props.startLine as number || 0,
      },
      description: `Variable "${variable}" is defined here`,
      variable_name: variable,
    });
  }

  // Generate summary
  const summary = generateSummary(variable, function_name, flowSteps);

  return {
    variable,
    function_context: function_name,
    found: true,
    flow_steps: flowSteps,
    summary,
  };
}

/**
 * Recursively trace data flow from a node
 */
function traceFromNode(
  graph: any,
  node: CodeGraphNode,
  steps: DataFlowStep[],
  visited: Set<string>,
  depth: number,
  maxDepth: number
): void {
  if (depth >= maxDepth || visited.has(node.id)) {
    return;
  }
  visited.add(node.id);

  const props = node.properties || {};

  // Add definition step
  if (depth === 0) {
    steps.push({
      step_type: 'definition',
      location: {
        function: props.scope as string || 'unknown',
        file: props.filePath as string || 'unknown',
        line: props.startLine as number || 0,
      },
      description: `Variable "${props.name}" is defined`,
      variable_name: props.name as string,
    });
  }

  // Find relationships from this node
  const relationships = graph.raw?.graph?.relationships || [];

  for (const rel of relationships) {
    if (rel.startNode !== node.id) continue;

    const targetNode = graph.nodeById.get(rel.endNode);
    if (!targetNode) continue;

    const targetProps = targetNode.properties || {};

    // Handle different relationship types
    if (rel.type === 'USES' || rel.type === 'reads') {
      steps.push({
        step_type: 'usage',
        location: {
          function: targetProps.name as string || 'unknown',
          file: targetProps.filePath as string || props.filePath as string || 'unknown',
          line: targetProps.startLine as number || 0,
        },
        description: `Used in ${targetProps.name || 'expression'}`,
        variable_name: props.name as string,
      });
    } else if (rel.type === 'ASSIGNS' || rel.type === 'writes') {
      steps.push({
        step_type: 'assignment',
        location: {
          function: props.scope as string || 'unknown',
          file: props.filePath as string || 'unknown',
          line: rel.properties?.lineNumber as number || 0,
        },
        description: `Assigned value`,
        variable_name: props.name as string,
      });
    } else if (rel.type === 'PASSED_TO' || rel.type === 'argument_to') {
      steps.push({
        step_type: 'passed_to',
        location: {
          function: targetProps.name as string || 'unknown',
          file: targetProps.filePath as string || 'unknown',
          line: targetProps.startLine as number || 0,
        },
        description: `Passed as argument to ${targetProps.name}`,
        variable_name: props.name as string,
      });

      // Continue tracing in the called function
      traceFromNode(graph, targetNode, steps, visited, depth + 1, maxDepth);
    } else if (rel.type === 'RETURNS') {
      steps.push({
        step_type: 'returned_from',
        location: {
          function: props.scope as string || 'unknown',
          file: props.filePath as string || 'unknown',
          line: rel.properties?.lineNumber as number || 0,
        },
        description: `Returned from function`,
        variable_name: props.name as string,
      });
    } else if (rel.type === 'transforms_to' || rel.type === 'TRANSFORMS') {
      steps.push({
        step_type: 'transformation',
        location: {
          function: props.scope as string || 'unknown',
          file: props.filePath as string || 'unknown',
          line: rel.properties?.lineNumber as number || 0,
        },
        description: `Transformed to ${targetProps.name}`,
        variable_name: props.name as string,
        transformed_to: targetProps.name as string,
      });

      // Continue tracing the transformed variable
      traceFromNode(graph, targetNode, steps, visited, depth + 1, maxDepth);
    }
  }
}

/**
 * Find variable/parameter nodes by name
 */
function findVariablesByName(graph: any, name: string, functionContext?: string): CodeGraphNode[] {
  const lowerName = name.toLowerCase();
  const nodeIds = graph.nameIndex.get(lowerName) || [];

  let nodes = nodeIds
    .map((id: string) => graph.nodeById.get(id))
    .filter((node: CodeGraphNode) => {
      if (!node) return false;
      const label = node.labels?.[0] || '';
      return ['Variable', 'Parameter', 'Field', 'Constant'].includes(label);
    });

  // Filter by function context if provided
  if (functionContext) {
    const lowerContext = functionContext.toLowerCase();
    nodes = nodes.filter((node: CodeGraphNode) => {
      const scope = (node.properties?.scope as string || '').toLowerCase();
      return scope.includes(lowerContext);
    });
  }

  return nodes;
}

/**
 * Generate natural language summary
 */
function generateSummary(variable: string, functionContext: string | undefined, steps: DataFlowStep[]): string {
  if (steps.length === 0) {
    return `No data flow found for "${variable}".`;
  }

  if (steps.length === 1) {
    return `Variable "${variable}" is defined but not used in tracked data flows.`;
  }

  // Count step types
  const usages = steps.filter(s => s.step_type === 'usage').length;
  const passedTo = steps.filter(s => s.step_type === 'passed_to').length;
  const transforms = steps.filter(s => s.step_type === 'transformation').length;

  const parts: string[] = [];
  if (usages > 0) parts.push(`${usages} usage(s)`);
  if (passedTo > 0) parts.push(`passed to ${passedTo} function(s)`);
  if (transforms > 0) parts.push(`${transforms} transformation(s)`);

  const context = functionContext ? ` in "${functionContext}"` : '';
  return `Data flow for "${variable}"${context}: ${parts.join(', ')} (${steps.length} total steps)`;
}

/**
 * Helper: Generate cache key matching explore_codebase's format
 */
function getCacheKey(path: string): string {
  return generateIdempotencyKey(path);
}

/**
 * Tool metadata for MCP registration
 */
export const traceDataFlowTool = {
  name: 'trace_data_flow',
  description: 'Trace how data flows through a variable or parameter, showing usage, transformations, and passing between functions',
  inputSchema: zodToJsonSchema(TraceDataFlowArgsSchema),
  handler: traceDataFlow,
};
