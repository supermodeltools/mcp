import { execFile } from 'child_process';
import { StructuredError } from '../types';
import * as logger from './logger';

const REPO = 'supermodeltools/mcp';

// In-memory set of error codes already reported this session to avoid duplicates
const reportedThisSession = new Set<string>();

/**
 * Auto-file a GitHub issue for an internal error.
 * Uses `gh` CLI. Non-blocking — failures are silently logged.
 * Deduplicates by error code per session and by searching existing open issues.
 */
export async function reportError(error: StructuredError): Promise<void> {
  // Only report internal errors
  if (error.type !== 'internal_error') return;

  // Session-level dedup: don't file the same error code twice per process lifetime
  if (reportedThisSession.has(error.code)) return;
  reportedThisSession.add(error.code);

  const code = error.code.toLowerCase().replace(/_/g, '-');
  const title = `[auto-report] ${code}: ${error.message}`;

  try {
    // Check if an open issue with this error code already exists
    const existing = await ghExec(['issue', 'list', '--repo', REPO, '--state', 'open', '--search', `[auto-report] ${code}`, '--limit', '1', '--json', 'number']);
    const issues = JSON.parse(existing);
    if (issues.length > 0) {
      logger.debug(`Issue already exists for ${error.code}: #${issues[0].number}`);
      return;
    }

    // Build issue body with reproduction context
    const body = buildIssueBody(error);

    await ghExec(['issue', 'create', '--repo', REPO, '--title', title, '--body', body, '--label', 'auto-report,bug']);
    logger.debug(`Filed issue for ${error.code}`);
  } catch (err: any) {
    // Don't let reporting failures affect the user
    logger.debug(`Failed to auto-report error: ${err.message || err}`);
  }
}

function buildIssueBody(error: StructuredError): string {
  const detailsBlock = error.details
    ? `\n\n### Details\n\n\`\`\`json\n${JSON.stringify(error.details, null, 2)}\n\`\`\``
    : '';

  return `## Auto-reported internal error

This issue was automatically filed by the MCP server when it encountered an unrecoverable internal error.

### Error

| Field | Value |
|-------|-------|
| **Type** | \`${error.type}\` |
| **Code** | \`${error.code}\` |
| **Message** | ${error.message} |
| **Recoverable** | ${error.recoverable} |
${detailsBlock}

### Context

- **Package**: \`@supermodeltools/mcp-server\`
- **Timestamp**: ${new Date().toISOString()}
- **Node version**: ${process.version}
- **Platform**: ${process.platform} ${process.arch}
`;
}

function ghExec(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
