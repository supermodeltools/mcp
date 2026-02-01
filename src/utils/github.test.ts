import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  GITHUB_REPO,
  GITHUB_API_URL,
  validateGitHubToken,
  validateRequiredString,
  validateOptionalString,
  validateLabels,
  classifyGitHubHttpError,
  createGitHubIssue,
} from './github';

describe('github utils', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // @ts-ignore - mock global fetch
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('constants', () => {
    it('should export the correct repository name', () => {
      expect(GITHUB_REPO).toBe('supermodeltools/mcp');
    });

    it('should export the correct API URL', () => {
      expect(GITHUB_API_URL).toBe('https://api.github.com/repos/supermodeltools/mcp/issues');
    });
  });

  describe('validateGitHubToken', () => {
    it('should return null when GITHUB_TOKEN is set', () => {
      process.env.GITHUB_TOKEN = 'ghp_test123';
      expect(validateGitHubToken()).toBeNull();
    });

    it('should return error when GITHUB_TOKEN is not set', () => {
      delete process.env.GITHUB_TOKEN;
      const error = validateGitHubToken();
      expect(error).not.toBeNull();
      expect(error!.type).toBe('authentication_error');
      expect(error!.code).toBe('MISSING_GITHUB_TOKEN');
      expect(error!.recoverable).toBe(false);
    });

    it('should return error when GITHUB_TOKEN is empty string', () => {
      process.env.GITHUB_TOKEN = '';
      const error = validateGitHubToken();
      expect(error).not.toBeNull();
      expect(error!.code).toBe('MISSING_GITHUB_TOKEN');
    });
  });

  describe('validateRequiredString', () => {
    it('should return null for valid non-empty string', () => {
      const error = validateRequiredString('hello', 'title', 'INVALID_TITLE', 'Fix it');
      expect(error).toBeNull();
    });

    it('should return error for undefined', () => {
      const error = validateRequiredString(undefined, 'title', 'INVALID_TITLE', 'Fix it');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_TITLE');
      expect(error!.type).toBe('validation_error');
      expect(error!.recoverable).toBe(false);
    });

    it('should return error for null', () => {
      const error = validateRequiredString(null, 'title', 'INVALID_TITLE', 'Fix it');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_TITLE');
    });

    it('should return error for empty string', () => {
      const error = validateRequiredString('', 'title', 'INVALID_TITLE', 'Fix it');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_TITLE');
    });

    it('should return error for number', () => {
      const error = validateRequiredString(123, 'title', 'INVALID_TITLE', 'Fix it');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_TITLE');
    });

    it('should return error for boolean', () => {
      const error = validateRequiredString(true, 'title', 'INVALID_TITLE', 'Fix it');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_TITLE');
    });

    it('should return error for object', () => {
      const error = validateRequiredString({}, 'title', 'INVALID_TITLE', 'Fix it');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_TITLE');
    });

    it('should return error for array', () => {
      const error = validateRequiredString(['a'], 'title', 'INVALID_TITLE', 'Fix it');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_TITLE');
    });

    it('should include the parameter name in the message', () => {
      const error = validateRequiredString(undefined, 'description', 'CODE', 'Fix it');
      expect(error!.message).toContain('description');
    });

    it('should include the provided suggestion', () => {
      const error = validateRequiredString(undefined, 'title', 'CODE', 'My suggestion');
      expect(error!.suggestion).toBe('My suggestion');
    });

    it('should use the provided error code', () => {
      const error = validateRequiredString(undefined, 'title', 'MY_CODE', 'Fix it');
      expect(error!.code).toBe('MY_CODE');
    });
  });

  describe('validateOptionalString', () => {
    it('should return null for undefined (not provided)', () => {
      const error = validateOptionalString(undefined, 'steps', 'INVALID_STEPS', 'Fix it');
      expect(error).toBeNull();
    });

    it('should return null for valid non-empty string', () => {
      const error = validateOptionalString('step 1', 'steps', 'INVALID_STEPS', 'Fix it');
      expect(error).toBeNull();
    });

    it('should return error for empty string', () => {
      const error = validateOptionalString('', 'steps', 'INVALID_STEPS', 'Fix it');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_STEPS');
      expect(error!.type).toBe('validation_error');
    });

    it('should return error for number', () => {
      const error = validateOptionalString(42, 'steps', 'INVALID_STEPS', 'Fix it');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_STEPS');
    });

    it('should return error for boolean', () => {
      const error = validateOptionalString(true, 'steps', 'INVALID_STEPS', 'Fix it');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_STEPS');
    });

    it('should return error for null', () => {
      const error = validateOptionalString(null, 'steps', 'INVALID_STEPS', 'Fix it');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_STEPS');
    });

    it('should return error for object', () => {
      const error = validateOptionalString({}, 'steps', 'INVALID_STEPS', 'Fix it');
      expect(error).not.toBeNull();
    });

    it('should return error for array', () => {
      const error = validateOptionalString(['a', 'b'], 'steps', 'INVALID_STEPS', 'Fix it');
      expect(error).not.toBeNull();
    });

    it('should include the parameter name in the message', () => {
      const error = validateOptionalString(42, 'expected_behavior', 'CODE', 'Fix it');
      expect(error!.message).toContain('expected_behavior');
    });

    it('should include the provided suggestion', () => {
      const error = validateOptionalString(42, 'steps', 'CODE', 'My suggestion');
      expect(error!.suggestion).toBe('My suggestion');
    });
  });

  describe('validateLabels', () => {
    it('should return null for undefined', () => {
      expect(validateLabels(undefined)).toBeNull();
    });

    it('should return null for valid string array', () => {
      expect(validateLabels(['bug', 'enhancement'])).toBeNull();
    });

    it('should return null for empty array', () => {
      expect(validateLabels([])).toBeNull();
    });

    it('should return null for single-item array', () => {
      expect(validateLabels(['bug'])).toBeNull();
    });

    it('should return error for string instead of array', () => {
      const error = validateLabels('bug');
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_LABELS');
      expect(error!.type).toBe('validation_error');
    });

    it('should return error for number', () => {
      const error = validateLabels(42);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_LABELS');
    });

    it('should return error for object', () => {
      const error = validateLabels({ bug: true });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_LABELS');
    });

    it('should return error for boolean', () => {
      const error = validateLabels(true);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_LABELS');
    });

    it('should return error for array with numbers', () => {
      const error = validateLabels([1, 2, 3]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_LABELS');
    });

    it('should return error for array with mixed types', () => {
      const error = validateLabels(['valid', 123]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_LABELS');
    });

    it('should return error for array with null', () => {
      const error = validateLabels(['valid', null]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_LABELS');
    });

    it('should return error for array with objects', () => {
      const error = validateLabels(['valid', { label: 'bug' }]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_LABELS');
    });

    it('should return error for array with booleans', () => {
      const error = validateLabels(['valid', true]);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('INVALID_LABELS');
    });
  });

  describe('classifyGitHubHttpError', () => {
    it('should classify 401 as authentication_error', () => {
      const error = classifyGitHubHttpError(401, 'Bad credentials');
      expect(error.type).toBe('authentication_error');
      expect(error.code).toBe('INVALID_GITHUB_TOKEN');
      expect(error.recoverable).toBe(false);
    });

    it('should classify 403 as authorization_error', () => {
      const error = classifyGitHubHttpError(403, 'Forbidden');
      expect(error.type).toBe('authorization_error');
      expect(error.code).toBe('GITHUB_FORBIDDEN');
      expect(error.recoverable).toBe(false);
    });

    it('should classify 404 as not_found_error', () => {
      const error = classifyGitHubHttpError(404, 'Not Found');
      expect(error.type).toBe('not_found_error');
      expect(error.code).toBe('REPO_NOT_FOUND');
      expect(error.recoverable).toBe(false);
      expect(error.message).toContain(GITHUB_REPO);
    });

    it('should classify 422 as validation_error with error body', () => {
      const error = classifyGitHubHttpError(422, 'Validation Failed: title is too long');
      expect(error.type).toBe('validation_error');
      expect(error.code).toBe('GITHUB_VALIDATION_ERROR');
      expect(error.recoverable).toBe(false);
      expect(error.message).toContain('title is too long');
    });

    it('should classify 429 as rate_limit_error and recoverable', () => {
      const error = classifyGitHubHttpError(429, 'Rate limit exceeded');
      expect(error.type).toBe('rate_limit_error');
      expect(error.code).toBe('GITHUB_RATE_LIMITED');
      expect(error.recoverable).toBe(true);
    });

    it('should classify 500 as internal_error and recoverable', () => {
      const error = classifyGitHubHttpError(500, 'Internal Server Error');
      expect(error.type).toBe('internal_error');
      expect(error.code).toBe('GITHUB_API_ERROR');
      expect(error.recoverable).toBe(true);
    });

    it('should classify 502 as recoverable', () => {
      const error = classifyGitHubHttpError(502, 'Bad Gateway');
      expect(error.recoverable).toBe(true);
    });

    it('should classify 503 as recoverable', () => {
      const error = classifyGitHubHttpError(503, 'Service Unavailable');
      expect(error.recoverable).toBe(true);
    });

    it('should classify 400 as non-recoverable', () => {
      const error = classifyGitHubHttpError(400, 'Bad Request');
      expect(error.type).toBe('internal_error');
      expect(error.code).toBe('GITHUB_API_ERROR');
      expect(error.recoverable).toBe(false);
    });

    it('should classify 418 as non-recoverable', () => {
      const error = classifyGitHubHttpError(418, "I'm a teapot");
      expect(error.recoverable).toBe(false);
    });

    it('should include error body in message for default cases', () => {
      const error = classifyGitHubHttpError(400, 'Bad Request body');
      expect(error.message).toContain('400');
      expect(error.message).toContain('Bad Request body');
    });
  });

  describe('createGitHubIssue', () => {
    it('should return auth error when GITHUB_TOKEN is not set', async () => {
      delete process.env.GITHUB_TOKEN;

      const result = await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Test body',
      }, 'Success');

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('MISSING_GITHUB_TOKEN');
    });

    it('should create issue successfully and return result', async () => {
      process.env.GITHUB_TOKEN = 'test-token';

      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({
          html_url: 'https://github.com/supermodeltools/mcp/issues/42',
          number: 42,
          title: 'My Issue',
        }),
      } as Response);

      const result = await createGitHubIssue('test_tool', {
        title: 'My Issue',
        body: 'Issue body',
      }, 'Created successfully.');

      expect(result.isError).toBeFalsy();
      const content = JSON.parse((result.content[0] as any).text);
      expect(content.message).toBe('Created successfully.');
      expect(content.issue_url).toBe('https://github.com/supermodeltools/mcp/issues/42');
      expect(content.issue_number).toBe(42);
      expect(content.title).toBe('My Issue');
    });

    it('should send correct headers including auth token', async () => {
      process.env.GITHUB_TOKEN = 'ghp_mytoken';

      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: '', number: 1, title: '' }),
      } as Response);

      await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Body',
      }, 'Success');

      expect(global.fetch).toHaveBeenCalledWith(
        GITHUB_API_URL,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer ghp_mytoken',
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          }),
        }),
      );
    });

    it('should include labels in request body when provided', async () => {
      process.env.GITHUB_TOKEN = 'test-token';

      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: '', number: 1, title: '' }),
      } as Response);

      await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Body',
        labels: ['bug', 'urgent'],
      }, 'Success');

      const callArgs = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
      const body = JSON.parse(callArgs[1]!.body as string);
      expect(body.title).toBe('Test');
      expect(body.body).toBe('Body');
      expect(body.labels).toEqual(['bug', 'urgent']);
    });

    it('should omit labels from request body when labels is empty', async () => {
      process.env.GITHUB_TOKEN = 'test-token';

      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: '', number: 1, title: '' }),
      } as Response);

      await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Body',
        labels: [],
      }, 'Success');

      const callArgs = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
      const body = JSON.parse(callArgs[1]!.body as string);
      expect(body.labels).toBeUndefined();
    });

    it('should omit labels from request body when labels is undefined', async () => {
      process.env.GITHUB_TOKEN = 'test-token';

      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: '', number: 1, title: '' }),
      } as Response);

      await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Body',
      }, 'Success');

      const callArgs = (global.fetch as jest.Mock<typeof fetch>).mock.calls[0];
      const body = JSON.parse(callArgs[1]!.body as string);
      expect(body.labels).toBeUndefined();
    });

    it('should return classified error for HTTP 401', async () => {
      process.env.GITHUB_TOKEN = 'bad-token';

      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Bad credentials',
      } as Response);

      const result = await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Body',
      }, 'Success');

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('INVALID_GITHUB_TOKEN');
    });

    it('should return classified error for HTTP 403', async () => {
      process.env.GITHUB_TOKEN = 'limited-token';

      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      } as Response);

      const result = await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Body',
      }, 'Success');

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('GITHUB_FORBIDDEN');
    });

    it('should return classified error for HTTP 404', async () => {
      process.env.GITHUB_TOKEN = 'test-token';

      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      } as Response);

      const result = await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Body',
      }, 'Success');

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('REPO_NOT_FOUND');
    });

    it('should return classified error for HTTP 422', async () => {
      process.env.GITHUB_TOKEN = 'test-token';

      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => '{"message":"Validation Failed"}',
      } as Response);

      const result = await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Body',
      }, 'Success');

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('GITHUB_VALIDATION_ERROR');
    });

    it('should return classified error for HTTP 429', async () => {
      process.env.GITHUB_TOKEN = 'test-token';

      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      } as Response);

      const result = await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Body',
      }, 'Success');

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('GITHUB_RATE_LIMITED');
      expect(error.error.recoverable).toBe(true);
    });

    it('should return classified error for HTTP 500', async () => {
      process.env.GITHUB_TOKEN = 'test-token';

      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

      const result = await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Body',
      }, 'Success');

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('GITHUB_API_ERROR');
      expect(error.error.recoverable).toBe(true);
    });

    it('should return network error when fetch throws', async () => {
      process.env.GITHUB_TOKEN = 'test-token';

      (global.fetch as jest.Mock<typeof fetch>).mockRejectedValue(
        new Error('getaddrinfo ENOTFOUND api.github.com'),
      );

      const result = await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Body',
      }, 'Success');

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('GITHUB_NETWORK_ERROR');
      expect(error.error.type).toBe('network_error');
      expect(error.error.recoverable).toBe(true);
      expect(error.error.message).toContain('ENOTFOUND');
    });

    it('should return network error for timeout', async () => {
      process.env.GITHUB_TOKEN = 'test-token';

      (global.fetch as jest.Mock<typeof fetch>).mockRejectedValue(
        new Error('request timed out'),
      );

      const result = await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Body',
      }, 'Success');

      expect(result.isError).toBe(true);
      const error = JSON.parse((result.content[0] as any).text);
      expect(error.error.code).toBe('GITHUB_NETWORK_ERROR');
      expect(error.error.message).toContain('timed out');
    });

    it('should use the correct API URL', async () => {
      process.env.GITHUB_TOKEN = 'test-token';

      (global.fetch as jest.Mock<typeof fetch>).mockResolvedValue({
        ok: true,
        json: async () => ({ html_url: '', number: 1, title: '' }),
      } as Response);

      await createGitHubIssue('test_tool', {
        title: 'Test',
        body: 'Body',
      }, 'Success');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/supermodeltools/mcp/issues',
        expect.any(Object),
      );
    });
  });
});
