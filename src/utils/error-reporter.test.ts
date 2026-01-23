import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { StructuredError } from '../types';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

let reportError: (error: StructuredError) => Promise<void>;
let mockExecFile: jest.Mock;

beforeEach(async () => {
  jest.resetModules();
  jest.mock('child_process', () => ({
    execFile: jest.fn(),
  }));
  const mod = await import('./error-reporter');
  reportError = mod.reportError;
  const cp = await import('child_process');
  mockExecFile = cp.execFile as unknown as jest.Mock;
});

describe('error-reporter', () => {
  it('should not report non-internal_error types', async () => {
    await reportError({
      type: 'validation_error',
      message: 'Bad input',
      code: 'MISSING_DIRECTORY',
      recoverable: false,
    });

    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('should call gh to search for existing issues before creating', async () => {
    mockExecFile.mockImplementation((...args: any[]) => {
      const ghArgs = args[1] as string[];
      const cb = args[3] as (err: any, stdout: string, stderr: string) => void;
      if (ghArgs.includes('list')) {
        cb(null, '[]', '');
      } else if (ghArgs.includes('create')) {
        cb(null, 'https://github.com/supermodeltools/mcp/issues/99', '');
      }
    });

    await reportError({
      type: 'internal_error',
      message: 'Something broke',
      code: 'UNKNOWN_ERROR',
      recoverable: false,
      details: { errorType: 'Error' },
    });

    expect(mockExecFile).toHaveBeenCalledTimes(2);

    const searchCall = mockExecFile.mock.calls[0] as any[];
    expect(searchCall[0]).toBe('gh');
    expect(searchCall[1]).toContain('list');
    expect(searchCall[1]).toContain('--search');

    const createCall = mockExecFile.mock.calls[1] as any[];
    expect(createCall[0]).toBe('gh');
    expect(createCall[1]).toContain('create');
    expect(createCall[1]).toContain('--title');
  });

  it('should not create issue if one already exists', async () => {
    mockExecFile.mockImplementation((...args: any[]) => {
      const ghArgs = args[1] as string[];
      const cb = args[3] as (err: any, stdout: string, stderr: string) => void;
      if (ghArgs.includes('list')) {
        cb(null, '[{"number": 42}]', '');
      }
    });

    await reportError({
      type: 'internal_error',
      message: 'Server error',
      code: 'SERVER_ERROR',
      recoverable: true,
    });

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect((mockExecFile.mock.calls[0] as any[])[1]).toContain('list');
  });

  it('should deduplicate by error code within a session', async () => {
    mockExecFile.mockImplementation((...args: any[]) => {
      const ghArgs = args[1] as string[];
      const cb = args[3] as (err: any, stdout: string, stderr: string) => void;
      if (ghArgs.includes('list')) cb(null, '[]', '');
      else cb(null, '', '');
    });

    const error: StructuredError = {
      type: 'internal_error',
      message: 'Broke again',
      code: 'ZIP_CREATION_FAILED',
      recoverable: false,
    };

    await reportError(error);
    await reportError(error);

    // Only 2 calls (list + create) for the first invocation, none for the second
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it('should not throw if gh CLI fails', async () => {
    mockExecFile.mockImplementation((...args: any[]) => {
      const cb = args[3] as (err: any, stdout: string, stderr: string) => void;
      cb(new Error('gh not found'), '', 'command not found: gh');
    });

    await expect(reportError({
      type: 'internal_error',
      message: 'Error',
      code: 'API_ERROR',
      recoverable: false,
    })).resolves.toBeUndefined();
  });

  it('should include error details in issue body', async () => {
    mockExecFile.mockImplementation((...args: any[]) => {
      const ghArgs = args[1] as string[];
      const cb = args[3] as (err: any, stdout: string, stderr: string) => void;
      if (ghArgs.includes('list')) cb(null, '[]', '');
      else cb(null, '', '');
    });

    await reportError({
      type: 'internal_error',
      message: 'API request failed with HTTP 418.',
      code: 'API_ERROR_2',
      recoverable: false,
      details: { httpStatus: 418 },
    });

    const createCall = mockExecFile.mock.calls[1] as any[];
    const ghArgs = createCall[1] as string[];
    const bodyIdx = ghArgs.indexOf('--body');
    const body = ghArgs[bodyIdx + 1];
    expect(body).toContain('API_ERROR_2');
    expect(body).toContain('API request failed with HTTP 418');
    expect(body).toContain('418');
    expect(body).toContain('@supermodeltools/mcp-server');
  });
});
