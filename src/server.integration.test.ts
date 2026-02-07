/**
 * Integration tests for the MCP server.
 * Tests the JSON-RPC protocol, tool listing, and basic operations.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import * as readline from 'readline';
import * as path from 'path';

const SERVER_STARTUP_TIMEOUT_MS = 5000;
const STARTUP_POLL_INTERVAL_MS = 100;

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

      setTimeout(() => {
        if (responseQueue.has(id)) {
          responseQueue.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 5000);
    });
  }

  beforeAll(async () => {
    const distPath = path.join(__dirname, '..', 'dist', 'index.js');
    if (!existsSync(distPath)) {
      throw new Error(
        `Server build not found at ${distPath}. Run 'npm run build' first.`
      );
    }

    server = spawn('node', [distPath, '--no-api-fallback'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    server.on('error', (err) => {
      throw new Error(`Failed to start MCP server: ${err.message}`);
    });

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

    let ready = false;
    const startTime = Date.now();
    while (Date.now() - startTime < SERVER_STARTUP_TIMEOUT_MS) {
      if (server.exitCode !== null) {
        throw new Error(`Server exited unexpectedly with code ${server.exitCode}`);
      }
      await new Promise(r => setTimeout(r, STARTUP_POLL_INTERVAL_MS));
      if (server.stdin?.writable) {
        ready = true;
        break;
      }
    }

    if (!ready) {
      throw new Error(`Server not ready after ${SERVER_STARTUP_TIMEOUT_MS}ms`);
    }
  });

  afterAll(async () => {
    responseQueue.clear();
    rl?.close();
    if (server && !server.killed) {
      server.stdin?.end();
      server.stdout?.destroy();
      server.stderr?.destroy();
      server.kill('SIGKILL');
    }
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
      expect(result.instructions).toContain('Supermodel: Codebase Intelligence');
    });
  });

  describe('tools/list', () => {
    it('should list exactly 2 tools', async () => {
      const result = await sendRequest('tools/list', {});

      expect(result.tools).toBeDefined();
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBe(2);
    });

    it('should include overview and symbol_context tools', async () => {
      const result = await sendRequest('tools/list', {});
      const toolNames = result.tools.map((t: any) => t.name);

      expect(toolNames).toContain('overview');
      expect(toolNames).toContain('symbol_context');
    });

    it('should have correct schema for tools', async () => {
      const result = await sendRequest('tools/list', {});

      const overviewTool = result.tools.find((t: any) => t.name === 'overview');
      expect(overviewTool.inputSchema.properties.directory).toBeDefined();

      const symbolTool = result.tools.find((t: any) => t.name === 'symbol_context');
      expect(symbolTool.inputSchema.properties.symbol).toBeDefined();
      expect(symbolTool.inputSchema.properties.directory).toBeDefined();
      expect(symbolTool.inputSchema.required).toContain('symbol');
    });
  });

  describe('tools/call validation', () => {
    it('should return NO_CACHE error for overview when no cache and API disabled', async () => {
      // Server runs with --no-api-fallback, so overview with no pre-computed
      // cache returns a fast, deterministic NO_CACHE error (no API call).
      const result = await sendRequest('tools/call', {
        name: 'overview',
        arguments: {}
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBeDefined();
      expect(parsed.error.code).toBe('NO_CACHE');
    });

    it('should return validation error for missing symbol on symbol_context', async () => {
      const result = await sendRequest('tools/call', {
        name: 'symbol_context',
        arguments: { directory: '/tmp' }
      });

      expect(result.content).toBeDefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe('MISSING_SYMBOL');
    });
  });
});
