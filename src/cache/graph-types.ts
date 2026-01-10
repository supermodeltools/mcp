/**
 * Type definitions for Supermodel IR graph data
 * Mirrors the API response schema
 */

export interface CodeGraphNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}

export interface CodeGraphRelationship {
  id: string;
  type: string;
  startNode: string;
  endNode: string;
  properties: Record<string, unknown>;
}

export interface SupermodelIR {
  repo?: string;
  version?: string;
  schemaVersion?: string;
  generatedAt?: string;
  summary?: {
    filesProcessed?: number;
    classes?: number;
    functions?: number;
    types?: number;
    domains?: number;
    primaryLanguage?: string;
    repoSizeBytes?: number;
  };
  graph?: {
    nodes: CodeGraphNode[];
    relationships: CodeGraphRelationship[];
  };
  artifacts?: Array<{
    id: string;
    kind: string;
    label: string;
    metadata?: Record<string, unknown>;
  }>;
}
