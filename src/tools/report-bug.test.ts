import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import bugReportTool, { tool, metadata, handler, formatBugReportBody } from './report-bug';
import { ClientContext } from '../types';

describe('report-bug', () => {
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
      expect(tool.name).toBe('report_bug');
    });

    it('should require title and description', () => {
      expect(tool.inputSchema.required).toEqual(['title', 'description']);
    });

    it('should have all expected properties', () => {
      const props = tool.inputSchema.properties as Record<string, any>;
      expect(props.title).toBeDefined();
      expect(props.title.type).toBe('string');
      expect(props.description).toBeDefined();
      expect(props.description.type).toBe('string');
      expect(props.steps_to_reproduce).toBeDefined();
      expect(props.steps_to_reproduce.type).toBe('string');
      expect(props.expected_behavior).toBeDefined();
      expect(props.expected_behavior.type).toBe('string');
      expect(props.actual_behavior).toBeDefined();
      expect(props.actual_behavior.type).toBe('string');
      expect(props.labels).toBeDefined();
      expect(props.labels.type).toBe('array');
    });

    it('should not have unexpected properties in schema', () => {
      const props = Object.keys(tool.inputSchema.properties as Record<string, any>);
      expect(props).toEqual([
        'title',
        'description',
        'steps_to_reproduce',
        'expected_behavior',
        'actual_behavior',
        'labels',
      ]);
    });

    it('should include repo name in description', () => {
      expect(tool.description).toContain('supermodeltools/mcp');
    });

    it('should mention GITHUB_TOKEN in description', () => {
      expect(tool.description).toContain('GITHUB_TOKEN');
    });

    it('should mention bug-related use cases', () => {
      expect(tool.description).toContain('error');
      expect(tool.description).toContain('crash');
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
      expect(metadata.operationId).toBe('createBugReport');
    });

    it('should include bug-report tag', () => {
      expect(metadata.tags).toContain('bug-report');
    });

    it('should include github tag', () => {
      expect(metadata.tags).toContain('github');
    });

    it('should use POST method', () => {
      expect(metadata.httpMethod).toBe('post');
    });

    it('should have correct httpPath', () => {
      expect(metadata.httpPath).toBe('/repos/supermodeltools/mcp/issues');
    });
  });

  describe('default export', () => {
    it('should export metadata, tool, and handler', () => {
      expect(bugReportTool.metadata).toBe(metadata);
      expect(bugReportTool.tool).toBe(tool);
      expect(bugReportTool.handler).toBe(handler);
    });
  });

  describe('formatBugReportBody', () => {
    it('should format description only', () => {
      const body = formatBugReportBody({
        description: 'Something is broken',
      });
      expect(body).toBe('## Description\n\nSomething is broken');
    });

    it('should format all fields', () => {
      const body = formatBugReportBody({
        description: 'The tool fails',
        steps_to_reproduce: '1. Call tool\n2. Observe error',
        expected_behavior: 'Tool should return a graph',
        actual_behavior: 'Tool returns timeout error',
      });

      expect(body).toContain('## Description\n\nThe tool fails');
      expect(body).toContain('## Steps to Reproduce\n\n1. Call tool\n2. Observe error');
      expect(body).toContain('## Expected Behavior\n\nTool should return a graph');
      expect(body).toContain('## Actual Behavior\n\nTool returns timeout error');
    });

    it('should include description and steps_to_reproduce only', () => {
      const body = formatBugReportBody({
        description: 'Bug description',
        steps_to_reproduce: 'Step 1',
      });

      expect(body).toContain('## Description');
      expect(body).toContain('## Steps to Reproduce');
      expect(body).not.toContain('## Expected Behavior');
      expect(body).not.toContain('## Actual Behavior');
    });

    it('should include description and expected_behavior only', () => {
      const body = formatBugReportBody({
        description: 'Bug description',
        expected_behavior: 'Expected output',
      });

      expect(body).toContain('## Description');
      expect(body).not.toContain('## Steps to Reproduce');
      expect(body).toContain('## Expected Behavior');
      expect(body).not.toContain('## Actual Behavior');
    });

    it('should include description and actual_behavior only', () => {
      const body = formatBugReportBody({
        description: 'Bug description',
        actual_behavior: 'Actual output',
      });

      expect(body).toContain('## Description');
      expect(body).not.toContain('## Steps to Reproduce');
      expect(body).not.toContain('## Expected Behavior');
      expect(body).toContain('## Actual Behavior');
    });

    it('should separate sections with double newlines', () => {
      const body = formatBugReportBody({
        description: 'Desc',
        steps_to_reproduce: 'Steps',
        expected_behavior: 'Expected',
        actual_behavior: 'Actual',
      });

      const sections = body.split('\n\n');
      // Should have: "## Description", "Desc", "## Steps to Reproduce", "Steps",
      // "## Expected Behavior", "Expected", "## Actual Behavior", "Actual"
      expect(sections.length).toBeGreaterThanOrEqual(4);
    });

    it('should handle multiline descriptions', () => {
      const body = formatBugReportBody({
        description: 'Line 1\nLine 2\nLine 3',
      });

      expect(body).toContain('Line 1\nLine 2\nLine 3');
    });

    it('should handle descriptions with markdown', () => {
      const body = formatBugReportBody({
        description: 'Error in `get_call_graph`:\n```\nError: timeout\n```',
      });

      expect(body).toContain('```\nError: timeout\n```');
    });

    it('should not include undefined optional fields', () => {
      const body = formatBugReportBody({
        description: 'desc',
        steps_to_reproduce: undefined,
        expected_behavior: undefined,
        actual_behavior: undefined,
      });

      expect(body).toBe('## Description\n\ndesc');
    });
  });

  describe('authentication', () => {
    it('should return MISSING_GITHUB_TOKEN when token is not set', async () => {
      delete process.env.GITHUB_TOKEN;

      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'Something is broken',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('MISSING_GITHUB_TOKEN');
      expect(error.error.type).toBe('authentication_error');
    });

    it('should return MISSING_GITHUB_TOKEN when token is empty', async () => {
      process.env.GITHUB_TOKEN = '';

      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'Something is broken',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('MISSING_GITHUB_TOKEN');
    });
  });

  describe('parameter validation - required fields', () => {
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

    it('should return INVALID_TITLE when title is boolean', async () => {
      const result = await handler(mockClient, { title: true, description: 'desc' });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_TITLE');
    });

    it('should return INVALID_DESCRIPTION when description is missing', async () => {
      const result = await handler(mockClient, { title: 'Bug' });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_DESCRIPTION');
    });

    it('should return INVALID_DESCRIPTION when description is not a string', async () => {
      const result = await handler(mockClient, { title: 'Bug', description: 42 });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_DESCRIPTION');
    });

    it('should return INVALID_DESCRIPTION when description is empty string', async () => {
      const result = await handler(mockClient, { title: 'Bug', description: '' });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_DESCRIPTION');
    });

    it('should return INVALID_DESCRIPTION when description is null', async () => {
      const result = await handler(mockClient, { title: 'Bug', description: null });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_DESCRIPTION');
    });
  });

  describe('parameter validation - optional fields', () => {
    beforeEach(() => {
      process.env.GITHUB_TOKEN = 'test-token';
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: '', number: 1, title: '' }),
      } as Response);
    });

    it('should succeed without optional fields', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
      });

      expect(result.isError).toBeFalsy();
    });

    it('should succeed with all optional fields', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        steps_to_reproduce: 'Step 1',
        expected_behavior: 'Expected',
        actual_behavior: 'Actual',
        labels: ['bug'],
      });

      expect(result.isError).toBeFalsy();
    });

    it('should return INVALID_STEPS when steps_to_reproduce is not a string', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        steps_to_reproduce: 123,
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_STEPS');
    });

    it('should return INVALID_STEPS when steps_to_reproduce is empty string', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        steps_to_reproduce: '',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_STEPS');
    });

    it('should return INVALID_STEPS when steps_to_reproduce is boolean', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        steps_to_reproduce: true,
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_STEPS');
    });

    it('should return INVALID_STEPS when steps_to_reproduce is array', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        steps_to_reproduce: ['step 1', 'step 2'],
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_STEPS');
    });

    it('should return INVALID_EXPECTED_BEHAVIOR when expected_behavior is not a string', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        expected_behavior: { behavior: 'expected' },
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_EXPECTED_BEHAVIOR');
    });

    it('should return INVALID_EXPECTED_BEHAVIOR when expected_behavior is empty string', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        expected_behavior: '',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_EXPECTED_BEHAVIOR');
    });

    it('should return INVALID_ACTUAL_BEHAVIOR when actual_behavior is not a string', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        actual_behavior: 42,
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_ACTUAL_BEHAVIOR');
    });

    it('should return INVALID_ACTUAL_BEHAVIOR when actual_behavior is empty string', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        actual_behavior: '',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_ACTUAL_BEHAVIOR');
    });

    it('should return INVALID_LABELS when labels is not an array', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        labels: 'bug',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_LABELS');
    });

    it('should return INVALID_LABELS when labels contains non-strings', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        labels: ['valid', 123],
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_LABELS');
    });
  });

  describe('parameter validation - ordering', () => {
    beforeEach(() => {
      process.env.GITHUB_TOKEN = 'test-token';
    });

    it('should validate title before description', async () => {
      const result = await handler(mockClient, { title: 123, description: 456 });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_TITLE');
    });

    it('should validate description before steps_to_reproduce', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 123,
        steps_to_reproduce: 456,
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_DESCRIPTION');
    });

    it('should validate steps_to_reproduce before expected_behavior', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        steps_to_reproduce: 123,
        expected_behavior: 456,
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_STEPS');
    });

    it('should validate expected_behavior before actual_behavior', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        expected_behavior: 123,
        actual_behavior: 456,
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_EXPECTED_BEHAVIOR');
    });

    it('should validate actual_behavior before labels', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        actual_behavior: 123,
        labels: 'bad',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_ACTUAL_BEHAVIOR');
    });

    it('should check auth before any validation', async () => {
      delete process.env.GITHUB_TOKEN;

      const result = await handler(mockClient, { title: 123 });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('MISSING_GITHUB_TOKEN');
    });
  });

  describe('GitHub API interaction', () => {
    beforeEach(() => {
      process.env.GITHUB_TOKEN = 'test-token';
    });

    it('should create bug report successfully with all fields', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({
          html_url: 'https://github.com/supermodeltools/mcp/issues/50',
          number: 50,
          title: 'get_call_graph timeout',
        }),
      } as Response);

      const result = await handler(mockClient, {
        title: 'get_call_graph timeout',
        description: 'Tool times out on large repos',
        steps_to_reproduce: '1. Run get_call_graph on monorepo',
        expected_behavior: 'Graph returns within timeout',
        actual_behavior: 'Timeout after 15 minutes',
        labels: ['bug'],
      });

      expect(result.isError).toBeFalsy();
      const content = JSON.parse((result.content[0] as any).text);
      expect(content.message).toBe('Bug report created successfully.');
      expect(content.issue_url).toBe('https://github.com/supermodeltools/mcp/issues/50');
      expect(content.issue_number).toBe(50);
    });

    it('should format the issue body with markdown sections', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: '', number: 1, title: '' }),
      } as Response);

      await handler(mockClient, {
        title: 'Bug',
        description: 'The description',
        steps_to_reproduce: 'The steps',
        expected_behavior: 'The expected',
        actual_behavior: 'The actual',
      });

      const fetchCall = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.body).toContain('## Description\n\nThe description');
      expect(body.body).toContain('## Steps to Reproduce\n\nThe steps');
      expect(body.body).toContain('## Expected Behavior\n\nThe expected');
      expect(body.body).toContain('## Actual Behavior\n\nThe actual');
    });

    it('should format body without optional sections when not provided', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: '', number: 1, title: '' }),
      } as Response);

      await handler(mockClient, {
        title: 'Bug',
        description: 'Only the description',
      });

      const fetchCall = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);

      expect(body.body).toBe('## Description\n\nOnly the description');
      expect(body.body).not.toContain('## Steps to Reproduce');
      expect(body.body).not.toContain('## Expected Behavior');
      expect(body.body).not.toContain('## Actual Behavior');
    });

    it('should include labels when provided', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: '', number: 1, title: '' }),
      } as Response);

      await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        labels: ['bug', 'crash'],
      });

      const fetchCall = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.labels).toEqual(['bug', 'crash']);
    });

    it('should not include labels when empty', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: '', number: 1, title: '' }),
      } as Response);

      await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
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
        title: 'Bug',
        description: 'desc',
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
        title: 'Bug',
        description: 'desc',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('GITHUB_FORBIDDEN');
    });

    it('should handle 404 response', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      } as Response);

      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('REPO_NOT_FOUND');
    });

    it('should handle 422 response', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => 'Validation Failed',
      } as Response);

      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('GITHUB_VALIDATION_ERROR');
    });

    it('should handle 429 rate limit response', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      } as Response);

      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('GITHUB_RATE_LIMITED');
      expect(error.error.recoverable).toBe(true);
    });

    it('should handle 500 server error', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('GITHUB_API_ERROR');
      expect(error.error.recoverable).toBe(true);
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock<typeof fetch>).mockRejectedValue(
        new Error('getaddrinfo ENOTFOUND api.github.com'),
      );

      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
      });

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('GITHUB_NETWORK_ERROR');
      expect(error.error.type).toBe('network_error');
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

    it('should succeed with extra unknown parameters', async () => {
      const result = await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        unknown_param: 'value',
        severity: 'high',
      });

      expect(result.isError).toBeFalsy();
    });
  });

  describe('integration with formatBugReportBody', () => {
    beforeEach(() => {
      process.env.GITHUB_TOKEN = 'test-token';
      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: '', number: 1, title: '' }),
      } as Response);
    });

    it('should produce valid markdown for description only', async () => {
      await handler(mockClient, {
        title: 'Bug',
        description: 'Simple bug',
      });

      const fetchCall = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.body).toBe('## Description\n\nSimple bug');
    });

    it('should produce valid markdown with partial optional fields', async () => {
      await handler(mockClient, {
        title: 'Bug',
        description: 'desc',
        actual_behavior: 'It crashed',
      });

      const fetchCall = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.body).toContain('## Description\n\ndesc');
      expect(body.body).toContain('## Actual Behavior\n\nIt crashed');
      expect(body.body).not.toContain('## Steps to Reproduce');
      expect(body.body).not.toContain('## Expected Behavior');
    });
  });
});
