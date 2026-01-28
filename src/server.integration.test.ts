/**
 * Integration tests for the MCP server.
 * Tests the JSON-RPC protocol, tool listing, and basic operations.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as path from 'path';

describe('MCP Server Integration', () => {
  let server: ChildProcess;
  let requestId = 0;
  let responseQueue: Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }> = new Map();
  let rl: readline.Interface;

  function sendRequest(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };
      responseQueue.set(id, { resolve, reject });
      server.stdin!.write(JSON.stringify(request) + '\n');

      // Timeout after 5 seconds
      setTimeout(() => {
        if (responseQueue.has(id)) {
          responseQueue.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 5000);
    });
  }

  beforeAll(async () => {
    // Start the MCP server
    const distPath = path.join(__dirname, '..', 'dist', 'index.js');
    server = spawn('node', [distPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    // Parse JSON-RPC responses
    rl = readline.createInterface({
      input: server.stdout!,
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      try {
        const response = JSON.parse(line);
        if (response.id && responseQueue.has(response.id)) {
          const { resolve, reject } = responseQueue.get(response.id)!;
          responseQueue.delete(response.id);
          if (response.error) {
            reject(new Error(JSON.stringify(response.error)));
          } else {
            resolve(response.result);
          }
        }
      } catch {
        // Not JSON, ignore
      }
    });

    // Wait for server to start
    await new Promise(r => setTimeout(r, 500));
  });

  afterAll(async () => {
    // Clear any pending response handlers
    responseQueue.clear();
    rl?.close();
    if (server && !server.killed) {
      server.stdin?.end();
      server.stdout?.destroy();
      server.stderr?.destroy();
      server.kill('SIGKILL');
    }
    // Give time for cleanup
    await new Promise(r => setTimeout(r, 100));
  });

  describe('protocol initialization', () => {
    it('should initialize successfully', async () => {
      const result = await sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'jest-test', version: '1.0.0' }
      });

      expect(result.protocolVersion).toBe('2024-11-05');
      expect(result.capabilities).toBeDefined();
      expect(result.serverInfo).toBeDefined();
      expect(result.serverInfo.name).toBe('supermodel_api');
    });

    it('should include server instructions', async () => {
      const result = await sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'jest-test', version: '1.0.0' }
      });

      expect(result.instructions).toBeDefined();
      expect(result.instructions).toContain('Supermodel Codebase Explorer');
    });
  });

  describe('tools/list', () => {
    it('should list all available tools', async () => {
      const result = await sendRequest('tools/list', {});

      expect(result.tools).toBeDefined();
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBeGreaterThanOrEqual(5);
    });

    it('should include explore_codebase tool', async () => {
      const result = await sendRequest('tools/list', {});
      const exploreTool = result.tools.find((t: any) => t.name === 'explore_codebase');

      expect(exploreTool).toBeDefined();
      expect(exploreTool.description).toContain('codebase analysis');
      expect(exploreTool.inputSchema.properties.directory).toBeDefined();
      expect(exploreTool.inputSchema.properties.query).toBeDefined();
    });

    it('should include individual graph tools', async () => {
      const result = await sendRequest('tools/list', {});
      const toolNames = result.tools.map((t: any) => t.name);

      expect(toolNames).toContain('get_call_graph');
      expect(toolNames).toContain('get_dependency_graph');
      expect(toolNames).toContain('get_domain_graph');
      expect(toolNames).toContain('get_parse_graph');
    });

    it('should have consistent schema for graph tools', async () => {
      const result = await sendRequest('tools/list', {});
      const graphTools = result.tools.filter((t: any) =>
        ['get_call_graph', 'get_dependency_graph', 'get_domain_graph', 'get_parse_graph'].includes(t.name)
      );

      for (const tool of graphTools) {
        expect(tool.inputSchema.properties.directory).toBeDefined();
        expect(tool.inputSchema.properties.directory.type).toBe('string');
        expect(tool.inputSchema.properties.jq_filter).toBeDefined();
        expect(tool.inputSchema.properties.jq_filter.type).toBe('string');
        expect(tool.inputSchema.required).toEqual([]);
      }
    });
  });

  describe('tools/call validation', () => {
    it('should return validation error for missing directory', async () => {
      const result = await sendRequest('tools/call', {
        name: 'get_call_graph',
        arguments: {}
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe('MISSING_DIRECTORY');
      expect(parsed.error.type).toBe('validation_error');
    });

    it('should return validation error for invalid directory type', async () => {
      const result = await sendRequest('tools/call', {
        name: 'get_call_graph',
        arguments: { directory: 123 }
      });

      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe('INVALID_DIRECTORY');
    });

    it('should return validation error for invalid jq_filter type', async () => {
      const result = await sendRequest('tools/call', {
        name: 'get_call_graph',
        arguments: { directory: '/tmp', jq_filter: ['invalid'] }
      });

      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe('INVALID_JQ_FILTER');
    });

    it('should return not_found error for non-existent directory', async () => {
      const result = await sendRequest('tools/call', {
        name: 'get_call_graph',
        arguments: { directory: '/nonexistent/path/xyz123' }
      });

      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe('DIRECTORY_NOT_FOUND');
      expect(parsed.error.type).toBe('not_found_error');
    });
  });

  describe('explore_codebase queries', () => {
    it('should return cache status without API call', async () => {
      const result = await sendRequest('tools/call', {
        name: 'explore_codebase',
        arguments: {
          directory: process.cwd(),
          query: 'graph_status'
        }
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      // graph_status returns cache info, not an error
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.query).toBe('graph_status');
    });
  });
});
