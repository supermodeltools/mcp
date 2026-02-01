import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import featureRequestTool, { tool, metadata, handler } from './feature-request';
import { ClientContext } from '../types';

describe('feature-request', () => {
  let mockClient: ClientContext;
  const originalEnv = process.env;

  beforeEach(() => {
    mockClient = {
      graphs: {} as any,
    };
    process.env = { ...originalEnv };
    // @ts-ignore - mock global fetch
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('tool definition', () => {
    it('should have correct tool name', () => {
      expect(tool.name).toBe('request_feature');
    });

    it('should require title and description', () => {
      expect(tool.inputSchema.required).toEqual(['title', 'description']);
    });

    it('should have title, description, and labels properties', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.title).toBeDefined();
      expect(props.title.type).toBe('string');
      expect(props.description).toBeDefined();
      expect(props.description.type).toBe('string');
      expect(props.labels).toBeDefined();
      expect(props.labels.type).toBe('array');
    });

    it('should include repo name in description', () => {
      expect(tool.description).toContain('supermodeltools/mcp');
    });

    it('should mention GITHUB_TOKEN in description', () => {
      expect(tool.description).toContain('GITHUB_TOKEN');
    });

    it('should not have unexpected properties in schema', () => {
      const props = Object.keys(tool.inputSchema.properties as Record<string, any>);
      expect(props).toEqual(['title', 'description', 'labels']);
    });
  });

  describe('tool metadata', () => {
    it('should have correct resource', () => {
      expect(metadata.resource).toBe('issues');
    });

    it('should have write operation', () => {
      expect(metadata.operation).toBe('write');
    });

    it('should have correct operationId', () => {
      expect(metadata.operationId).toBe('createFeatureRequest');
    });

    it('should include feature-request tag', () => {
      expect(metadata.tags).toContain('feature-request');
    });

    it('should include github tag', () => {
      expect(metadata.tags).toContain('github');
    });

    it('should use POST method', () => {
      expect(metadata.httpMethod).toBe('post');
    });
  });

  describe('default export', () => {
    it('should export metadata, tool, and handler', () => {
      expect(featureRequestTool.metadata).toBe(metadata);
      expect(featureRequestTool.tool).toBe(tool);
      expect(featureRequestTool.handler).toBe(handler);
    });
  });

  describe('authentication', () => {
    it('should return MISSING_GITHUB_TOKEN when token is not set', async () => {
      delete process.env.GITHUB_TOKEN;

      const result = await handler(mockClient, {
        title: 'Test',
        description: 'Test description',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('MISSING_GITHUB_TOKEN');
      expect(error.error.type).toBe('authentication_error');
    });

    it('should return MISSING_GITHUB_TOKEN when token is empty', async () => {
      process.env.GITHUB_TOKEN = '';

      const result = await handler(mockClient, {
        title: 'Test',
        description: 'Test description',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('MISSING_GITHUB_TOKEN');
    });
  });

  describe('parameter validation', () => {
    beforeEach(() => {
      process.env.GITHUB_TOKEN = 'test-token';
    });

    it('should return MISSING_PARAMETERS when args is undefined', async () => {
      const result = await handler(mockClient, undefined);

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('MISSING_PARAMETERS');
    });

    it('should return INVALID_TITLE when title is missing', async () => {
      const result = await handler(mockClient, { description: 'desc' });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_TITLE');
    });

    it('should return INVALID_TITLE when title is not a string', async () => {
      const result = await handler(mockClient, { title: 123, description: 'desc' });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_TITLE');
    });

    it('should return INVALID_TITLE when title is empty string', async () => {
      const result = await handler(mockClient, { title: '', description: 'desc' });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_TITLE');
    });

    it('should return INVALID_DESCRIPTION when description is missing', async () => {
      const result = await handler(mockClient, { title: 'Test' });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_DESCRIPTION');
    });

    it('should return INVALID_DESCRIPTION when description is not a string', async () => {
      const result = await handler(mockClient, { title: 'Test', description: 42 });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_DESCRIPTION');
    });

    it('should return INVALID_DESCRIPTION when description is empty string', async () => {
      const result = await handler(mockClient, { title: 'Test', description: '' });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_DESCRIPTION');
    });

    it('should return INVALID_LABELS when labels is not an array', async () => {
      const result = await handler(mockClient, {
        title: 'Test',
        description: 'desc',
        labels: 'not-an-array',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_LABELS');
    });

    it('should return INVALID_LABELS when labels contains non-strings', async () => {
      const result = await handler(mockClient, {
        title: 'Test',
        description: 'desc',
        labels: ['valid', 123],
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_LABELS');
    });

    it('should validate title before description (early exit)', async () => {
      const result = await handler(mockClient, { title: 123, description: 456 });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_TITLE');
    });

    it('should validate description before labels (early exit)', async () => {
      const result = await handler(mockClient, {
        title: 'Test',
        description: 123,
        labels: 'bad',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_DESCRIPTION');
    });
  });

  describe('GitHub API interaction', () => {
    beforeEach(() => {
      process.env.GITHUB_TOKEN = 'test-token';
    });

    it('should create issue successfully', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({
          html_url: 'https://github.com/supermodeltools/mcp/issues/99',
          number: 99,
          title: 'New feature',
        }),
      } as Response);

      const result = await handler(mockClient, {
        title: 'New feature',
        description: 'Please add this feature',
      });

      expect(result.isError).toBeFalsy();
      const content = JSON.parse((result.content[0] as any).text);
      expect(content.message).toBe('Feature request created successfully.');
      expect(content.issue_url).toBe('https://github.com/supermodeltools/mcp/issues/99');
      expect(content.issue_number).toBe(99);
    });

    it('should pass description as issue body', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({
          html_url: 'https://github.com/supermodeltools/mcp/issues/100',
          number: 100,
          title: 'Test',
        }),
      } as Response);

      await handler(mockClient, {
        title: 'Test',
        description: 'My detailed description',
      });

      const fetchCall = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.body).toBe('My detailed description');
    });

    it('should include labels when provided', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({
          html_url: 'https://github.com/supermodeltools/mcp/issues/100',
          number: 100,
          title: 'Test',
        }),
      } as Response);

      await handler(mockClient, {
        title: 'Test',
        description: 'desc',
        labels: ['enhancement', 'priority'],
      });

      const fetchCall = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.labels).toEqual(['enhancement', 'priority']);
    });

    it('should not include labels key when labels are empty', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({
          html_url: 'https://github.com/supermodeltools/mcp/issues/101',
          number: 101,
          title: 'Test',
        }),
      } as Response);

      await handler(mockClient, {
        title: 'Test',
        description: 'Test description',
        labels: [],
      });

      const fetchCall = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.labels).toBeUndefined();
    });

    it('should handle 401 response', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Bad credentials',
      } as Response);

      const result = await handler(mockClient, {
        title: 'Test',
        description: 'Test',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_GITHUB_TOKEN');
    });

    it('should handle 403 response', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      } as Response);

      const result = await handler(mockClient, {
        title: 'Test',
        description: 'Test',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('GITHUB_FORBIDDEN');
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockRejectedValue(
        new Error('getaddrinfo ENOTFOUND api.github.com'),
      );

      const result = await handler(mockClient, {
        title: 'Test',
        description: 'Test',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('GITHUB_NETWORK_ERROR');
      expect(error.error.recoverable).toBe(true);
    });
  });

  describe('handler ignores unused parameters', () => {
    beforeEach(() => {
      process.env.GITHUB_TOKEN = 'test-token';
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: '', number: 1, title: '' }),
      } as Response);
    });

    it('should succeed even with extra unknown parameters', async () => {
      const result = await handler(mockClient, {
        title: 'Test',
        description: 'desc',
        unknown_param: 'value',
        another: 42,
      });

      expect(result.isError).toBeFalsy();
    });
  });
});
