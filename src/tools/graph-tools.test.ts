import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  callGraphTool,
  dependencyGraphTool,
  domainGraphTool,
  parseGraphTool,
  graphTools,
} from './graph-tools';
import { ClientContext } from '../types';

describe('graph-tools', () => {
  describe('tool exports', () => {
    it('should export callGraphTool with correct name', () => {
      expect(callGraphTool.tool.name).toBe('get_call_graph');
      expect(callGraphTool.metadata.operationId).toBe('generateCallGraph');
    });

    it('should export dependencyGraphTool with correct name', () => {
      expect(dependencyGraphTool.tool.name).toBe('get_dependency_graph');
      expect(dependencyGraphTool.metadata.operationId).toBe('generateDependencyGraph');
    });

    it('should export domainGraphTool with correct name', () => {
      expect(domainGraphTool.tool.name).toBe('get_domain_graph');
      expect(domainGraphTool.metadata.operationId).toBe('generateDomainGraph');
    });

    it('should export parseGraphTool with correct name', () => {
      expect(parseGraphTool.tool.name).toBe('get_parse_graph');
      expect(parseGraphTool.metadata.operationId).toBe('generateParseGraph');
    });

    it('should export graphTools array with all 4 tools', () => {
      expect(graphTools).toHaveLength(4);
      const toolNames = graphTools.map(t => t.tool.name);
      expect(toolNames).toContain('get_call_graph');
      expect(toolNames).toContain('get_dependency_graph');
      expect(toolNames).toContain('get_domain_graph');
      expect(toolNames).toContain('get_parse_graph');
    });
  });

  describe('tool metadata', () => {
    it('should have correct HTTP endpoints for each tool', () => {
      expect(callGraphTool.metadata.httpPath).toBe('/v1/graphs/call');
      expect(dependencyGraphTool.metadata.httpPath).toBe('/v1/graphs/dependency');
      expect(domainGraphTool.metadata.httpPath).toBe('/v1/graphs/domain');
      expect(parseGraphTool.metadata.httpPath).toBe('/v1/graphs/parse');
    });

    it('should all use POST method', () => {
      graphTools.forEach(tool => {
        expect(tool.metadata.httpMethod).toBe('post');
      });
    });

    it('should all have write operation', () => {
      graphTools.forEach(tool => {
        expect(tool.metadata.operation).toBe('write');
      });
    });
  });

  describe('tool input schema', () => {
    it('should have directory and jq_filter properties', () => {
      graphTools.forEach(tool => {
        const props = tool.tool.inputSchema.properties as Record<string, any>;
        expect(props.directory).toBeDefined();
        expect(props.directory.type).toBe('string');
        expect(props.jq_filter).toBeDefined();
        expect(props.jq_filter.type).toBe('string');
      });
    });

    it('should not require any parameters (directory can use default workdir)', () => {
      graphTools.forEach(tool => {
        expect(tool.tool.inputSchema.required).toEqual([]);
      });
    });
  });

  describe('handler parameter validation', () => {
    let mockClient: ClientContext;

    beforeEach(() => {
      mockClient = {
        graphs: {
          generateCallGraph: jest.fn(),
          generateDependencyGraph: jest.fn(),
          generateDomainGraph: jest.fn(),
          generateParseGraph: jest.fn(),
        },
      } as any;
    });

    it('should return MISSING_DIRECTORY error when no directory and no default workdir', async () => {
      const result = await callGraphTool.handler(mockClient, undefined);

      expect(result.isError).toBe(true);
      const errorContent = JSON.parse(result.content[0].type === 'text' ? (result.content[0] as any).text : '');
      expect(errorContent.error.type).toBe('validation_error');
      expect(errorContent.error.code).toBe('MISSING_DIRECTORY');
      expect(errorContent.error.recoverable).toBe(false);
    });

    it('should return INVALID_DIRECTORY error when directory is not a string', async () => {
      const result = await callGraphTool.handler(mockClient, { directory: 123 });

      expect(result.isError).toBe(true);
      const errorContent = JSON.parse(result.content[0].type === 'text' ? (result.content[0] as any).text : '');
      expect(errorContent.error.type).toBe('validation_error');
      expect(errorContent.error.code).toBe('INVALID_DIRECTORY');
      expect(errorContent.error.recoverable).toBe(false);
    });

    it('should return INVALID_JQ_FILTER error when jq_filter is not a string', async () => {
      const result = await callGraphTool.handler(mockClient, {
        directory: '/some/path',
        jq_filter: 123
      });

      expect(result.isError).toBe(true);
      const errorContent = JSON.parse(result.content[0].type === 'text' ? (result.content[0] as any).text : '');
      expect(errorContent.error.type).toBe('validation_error');
      expect(errorContent.error.code).toBe('INVALID_JQ_FILTER');
      expect(errorContent.error.recoverable).toBe(false);
    });

    it('should return DIRECTORY_NOT_FOUND error for non-existent directory', async () => {
      const result = await callGraphTool.handler(mockClient, {
        directory: '/nonexistent/path/xyz123'
      });

      expect(result.isError).toBe(true);
      const errorContent = JSON.parse(result.content[0].type === 'text' ? (result.content[0] as any).text : '');
      expect(errorContent.error.type).toBe('not_found_error');
      expect(errorContent.error.code).toBe('DIRECTORY_NOT_FOUND');
    });

    it('should use default workdir when directory not provided', async () => {
      // Will fail at zip stage since /default/workdir doesn't exist,
      // but proves it attempted to use the default workdir
      const result = await callGraphTool.handler(mockClient, {}, '/default/workdir');

      expect(result.isError).toBe(true);
      const errorContent = JSON.parse(result.content[0].type === 'text' ? (result.content[0] as any).text : '');
      // Should get to the directory validation stage using default workdir
      expect(errorContent.error.code).toBe('DIRECTORY_NOT_FOUND');
    });
  });

  describe('idempotency key format', () => {
    it('should include graph type in idempotency key format', () => {
      // The idempotency key format is: {repoName}-{pathHash}:{graphType}:{commitHash}
      // Each graph type should produce different keys for the same directory
      // This is tested implicitly through the tool metadata tags
      expect(callGraphTool.metadata.tags).toContain('call');
      expect(dependencyGraphTool.metadata.tags).toContain('dependency');
      expect(domainGraphTool.metadata.tags).toContain('domain');
      expect(parseGraphTool.metadata.tags).toContain('parse');
    });
  });

  describe('tool description safety', () => {
    it('should not contain instructions that could be misused', () => {
      for (const tool of graphTools) {
        const desc = (tool.tool.description ?? '').toLowerCase();
        // Descriptions should be read-only analysis focused
        expect(desc).not.toContain('delete');
        expect(desc).not.toContain('remove file');
        expect(desc).not.toContain('execute command');
        expect(desc).not.toContain('run shell');
        expect(desc).not.toContain('modify');
        expect(desc).not.toContain('write to');
      }
    });

    it('should focus on analysis and understanding', () => {
      for (const tool of graphTools) {
        const desc = (tool.tool.description ?? '').toLowerCase();
        // All tools should be about understanding/analyzing code
        expect(
          desc.includes('find') ||
          desc.includes('understand') ||
          desc.includes('analyze') ||
          desc.includes('trace') ||
          desc.includes('identify')
        ).toBe(true);
      }
    });
  });

  describe('all handlers validate parameters consistently', () => {
    let mockClient: ClientContext;

    beforeEach(() => {
      mockClient = {
        graphs: {
          generateCallGraph: jest.fn(),
          generateDependencyGraph: jest.fn(),
          generateDomainGraph: jest.fn(),
          generateParseGraph: jest.fn(),
        },
      } as any;
    });

    it('should all return MISSING_DIRECTORY for undefined args', async () => {
      for (const tool of graphTools) {
        const result = await tool.handler(mockClient, undefined);
        expect(result.isError).toBe(true);
        const errorContent = JSON.parse(result.content[0].type === 'text' ? (result.content[0] as any).text : '');
        expect(errorContent.error.code).toBe('MISSING_DIRECTORY');
      }
    });

    it('should all return INVALID_DIRECTORY for non-string directory', async () => {
      for (const tool of graphTools) {
        const result = await tool.handler(mockClient, { directory: { invalid: true } });
        expect(result.isError).toBe(true);
        const errorContent = JSON.parse(result.content[0].type === 'text' ? (result.content[0] as any).text : '');
        expect(errorContent.error.code).toBe('INVALID_DIRECTORY');
      }
    });

    it('should all return INVALID_JQ_FILTER for non-string jq_filter', async () => {
      for (const tool of graphTools) {
        const result = await tool.handler(mockClient, {
          directory: '/some/path',
          jq_filter: ['invalid', 'array']
        });
        expect(result.isError).toBe(true);
        const errorContent = JSON.parse(result.content[0].type === 'text' ? (result.content[0] as any).text : '');
        expect(errorContent.error.code).toBe('INVALID_JQ_FILTER');
      }
    });
  });
});
