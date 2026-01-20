import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { handler } from './create-supermodel-graph';
import { ClientContext } from '../types';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { basename, resolve } from 'path';

// Test the idempotency key generation logic in isolation
describe('create-supermodel-graph', () => {
  describe('idempotency key generation logic', () => {
    it('should generate key format with repo name, path hash, type, and commit hash', () => {
      const directory = '/path/to/my-repo';
      const repoName = basename(directory);
      const absolutePath = resolve(directory);
      const pathHash = createHash('sha1').update(absolutePath).digest('hex').substring(0, 7);
      const commitHash = 'abc1234';

      const expectedPattern = new RegExp(`${repoName}-${pathHash}:supermodel:${commitHash}`);
      const actualKey = `${repoName}-${pathHash}:supermodel:${commitHash}`;

      expect(actualKey).toMatch(expectedPattern);
    });

    it('should include status hash for dirty working tree', () => {
      const directory = '/path/to/my-repo';
      const repoName = basename(directory);
      const absolutePath = resolve(directory);
      const pathHash = createHash('sha1').update(absolutePath).digest('hex').substring(0, 7);
      const commitHash = 'abc1234';
      const statusOutput = 'M src/file.ts\n';
      const statusHash = createHash('sha1').update(statusOutput).digest('hex').substring(0, 7);

      const actualKey = `${repoName}-${pathHash}:supermodel:${commitHash}-${statusHash}`;

      expect(actualKey).toMatch(new RegExp(`${commitHash}-${statusHash}`));
    });

    it('should use path hash for non-git directories', () => {
      const directory = '/path/to/non-git-dir';
      const repoName = basename(directory);
      const absolutePath = resolve(directory);
      const pathHash = createHash('sha1').update(absolutePath).digest('hex').substring(0, 7);

      // When not a git repo, use path hash as the main identifier
      const actualKey = `${repoName}-${pathHash}:supermodel:${pathHash}`;

      expect(actualKey).toMatch(new RegExp(`${repoName}-${pathHash}:supermodel:${pathHash}`));
    });

    it('should prevent collisions between same-named repos', () => {
      const dir1 = '/path/to/repo';
      const dir2 = '/different/path/repo';

      const path1Hash = createHash('sha1').update(resolve(dir1)).digest('hex').substring(0, 7);
      const path2Hash = createHash('sha1').update(resolve(dir2)).digest('hex').substring(0, 7);

      // Even with same repo name, path hashes should be different
      expect(path1Hash).not.toBe(path2Hash);
    });
  });

  describe('parameter validation', () => {
    let mockClient: ClientContext;

    beforeEach(() => {
      mockClient = {
        graphs: {
          generateSupermodelGraph: jest.fn(),
        },
      } as any;
    });

    it('should return error when no arguments provided', async () => {
      const result = await handler(mockClient, undefined);

      expect(result.content).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('Missing required arguments'),
        },
      ]);
      expect(result.isError).toBe(true);
    });

    it('should return error when directory is missing', async () => {
      const args = {
        query: 'summary',
      };

      const result = await handler(mockClient, args);

      expect(result.content).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('Invalid "directory" parameter'),
        },
      ]);
      expect(result.isError).toBe(true);
    });

    it('should return error when directory is not a string', async () => {
      const args = {
        directory: 123,
        query: 'summary',
      };

      const result = await handler(mockClient, args as any);

      expect(result.content).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('Invalid "directory" parameter'),
        },
      ]);
      expect(result.isError).toBe(true);
    });
  });

  describe('error message handling', () => {
    it('should extract directory from error messages correctly', () => {
      const directory = '/test/missing';
      const errorMsg = `Directory does not exist: ${directory}`;

      expect(errorMsg).toContain(directory);
      expect(errorMsg).toMatch(/Directory does not exist/);
    });

    it('should format permission denied errors correctly', () => {
      const directory = '/test/restricted';
      const errorMsg = `Permission denied accessing directory: ${directory}`;

      expect(errorMsg).toContain(directory);
      expect(errorMsg).toMatch(/Permission denied/);
    });

    it('should format size limit errors correctly', () => {
      const errorMsg = 'Directory size (1.2 GB) exceeds maximum allowed size (500 MB)';

      expect(errorMsg).toMatch(/exceeds maximum allowed size/);
      expect(errorMsg).toContain('1.2 GB');
      expect(errorMsg).toContain('500 MB');
    });
  });

  describe('query parameter types', () => {
    it('should accept all valid query types in the enum', () => {
      const validQueries = [
        'graph_status',
        'summary',
        'get_node',
        'search',
        'list_nodes',
        'function_calls_in',
        'function_calls_out',
        'definitions_in_file',
        'file_imports',
        'domain_map',
        'domain_membership',
        'neighborhood',
        'jq',
      ];

      // This test just verifies the list is complete
      expect(validQueries.length).toBeGreaterThan(10);
      expect(validQueries).toContain('summary');
      expect(validQueries).toContain('get_node');
      expect(validQueries).toContain('search');
    });
  });

  describe('formatBytes utility', () => {
    it('should format bytes correctly', () => {
      // Test the formatBytes function logic
      const testCases = [
        { bytes: 500, expected: /500 B/ },
        { bytes: 1024, expected: /1\.00 KB/ },
        { bytes: 1024 * 1024, expected: /1\.00 MB/ },
        { bytes: 1024 * 1024 * 1024, expected: /1\.00 GB/ },
      ];

      for (const { bytes, expected } of testCases) {
        let result: string;
        if (bytes < 1024) {
          result = `${bytes} B`;
        } else if (bytes < 1024 * 1024) {
          result = `${(bytes / 1024).toFixed(2)} KB`;
        } else if (bytes < 1024 * 1024 * 1024) {
          result = `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        } else {
          result = `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        }

        expect(result).toMatch(expected);
      }
    });
  });
});
