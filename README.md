# Supermodel MCP Server

[![npm](https://img.shields.io/npm/v/@supermodeltools/mcp-server)](https://www.npmjs.com/package/@supermodeltools/mcp-server)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![CI](https://github.com/supermodeltools/mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/supermodeltools/mcp/actions/workflows/ci.yml)

MCP server that provides deep codebase analysis to AI agents via the [Supermodel API](https://docs.supermodeltools.com). Enables Claude to understand code structure, dependencies, and relationships by generating comprehensive graphs from any repository. Use this to help AI agents explore unfamiliar code, plan refactorings, assess change impact, and understand system architecture.

## Install

```bash
npm install -g @supermodeltools/mcp-server
```

Or run directly:

```bash
npx @supermodeltools/mcp-server
```

## Configuration

Get your API key from the [Supermodel Dashboard](https://dashboard.supermodeltools.com).

| Variable | Description |
|----------|-------------|
| `SUPERMODEL_API_KEY` | Your Supermodel API key (required) |
| `SUPERMODEL_BASE_URL` | Override API base URL (optional) |

### Global Setup (Recommended)

Instead of adding your API key to each MCP config file, you can set it globally in your shell profile. This keeps your key in one place and automatically makes it available to all MCP clients.

**For Zsh (macOS default):**

Add to `~/.zshrc`:

```bash
export SUPERMODEL_API_KEY="your-api-key"
```

**For Bash:**

Add to `~/.bashrc` or `~/.bash_profile`:

```bash
export SUPERMODEL_API_KEY="your-api-key"
```

Then reload your shell:

```bash
source ~/.zshrc  # or ~/.bashrc
```

With the API key set globally, you can omit the `env` block from your MCP configs:

```json
{
  "mcpServers": {
    "supermodel": {
      "command": "npx",
      "args": ["-y", "@supermodeltools/mcp-server"]
    }
  }
}
```

### Default Working Directory (Optional)

For automated benchmarking tools (like mcpbr) or batch processing, you can specify a default working directory as a command-line argument. When provided, the `explore_codebase` tool will use this directory automatically if no explicit `directory` parameter is given.

**Command-line usage:**

```bash
npx @supermodeltools/mcp-server /path/to/repository
```

or with Node.js:

```bash
node dist/index.js /path/to/repository
```

**Example with benchmarking tools:**

```yaml
mcp_server:
  command: "npx"
  args: ["-y", "@supermodeltools/mcp-server", "{workdir}"]
  env:
    SUPERMODEL_API_KEY: "${SUPERMODEL_API_KEY}"
```

This allows the agent to call `explore_codebase()` without specifying a directory parameter, automatically using the configured default workdir. You can still override it by explicitly passing a `directory` parameter in individual tool calls.

## Usage

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "supermodel": {
      "command": "npx",
      "args": ["-y", "@supermodeltools/mcp-server"],
      "env": {
        "SUPERMODEL_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "supermodel": {
      "command": "npx",
      "args": ["-y", "@supermodeltools/mcp-server"],
      "env": {
        "SUPERMODEL_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Code

Add the MCP server with your API key:

```bash
claude mcp add supermodel --env SUPERMODEL_API_KEY=your-api-key -- npx -y @supermodeltools/mcp-server
```

Or if `SUPERMODEL_API_KEY` is already set in your shell environment:

```bash
claude mcp add supermodel -- npx -y @supermodeltools/mcp-server
```

Verify installation:

```bash
claude mcp list
```

## Tools

### `explore_codebase`

Analyzes code structure, dependencies, and relationships across a repository. Use this to understand unfamiliar codebases, plan refactorings, assess change impact, or map system architecture.

**When to use:**
- Exploring new codebases
- Planning refactors or architectural changes
- Understanding dependencies between modules
- Mapping call relationships and code flow
- Assessing the impact of proposed changes

**What you get:**
- Dependency graphs (module/package relationships)
- Call graphs (function-level call hierarchies)
- Domain classifications (architectural patterns)
- AST relationships (structural analysis)
- Summary statistics (languages, complexity, file counts)

**Parameters:**

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `directory` | string | Yes* | Path to repository directory (automatic zipping) |
| `file` | string | Yes* | Path to pre-zipped archive (deprecated) |
| `query` | string | No | Query type (summary, search, list_nodes, etc.) |
| `jq_filter` | string | No | jq filter for custom data extraction |

\* Either `directory` (recommended) or `file` must be provided

**Example prompts:**
- "Analyze the codebase at . to understand its architecture"
- "Before I refactor the authentication module, analyze this repo to show me what depends on it"
- "What's the structure of the codebase in /Users/me/project?"

**Automatic features:**
- Respects `.gitignore` patterns automatically
- Excludes sensitive files (`.env`, `*.pem`, credentials, etc.)
- Skips dependencies (`node_modules`, `venv`, `vendor`)
- Removes build outputs (`dist`, `build`, `out`)
- Cleans up temporary files automatically
- Cross-platform compatible

## Troubleshooting

### Timeout Errors

#### "Request timeout after 60 seconds"

**Cause:** The analysis is taking longer than the default MCP client timeout (typically 60 seconds). Large repositories or complex codebases may require more time to analyze.

**Solutions:**

1. **Analyze a subdirectory instead** - Target specific parts of your codebase:
   ```bash
   # Instead of analyzing the entire repo
   explore_codebase(directory="/path/to/repo")

   # Analyze just the core module
   explore_codebase(directory="/path/to/repo/src/core")
   ```

2. **Increase your MCP client timeout** - For Claude Code CLI, set the `MCP_TOOL_TIMEOUT` environment variable:

   ```bash
   # Set timeout to 15 minutes (900000ms) for large codebase analysis
   export MCP_TOOL_TIMEOUT=900000
   ```

   Then reload your shell or start a new terminal session. This timeout applies to all MCP tool executions.

   **Note:** Timeout configuration is currently only supported in Claude Code CLI.

3. **Verify `.gitignore` excludes build artifacts** - Ensure your repository excludes:
   - `node_modules/`, `vendor/`, `venv/`
   - `dist/`, `build/`, `out/`
   - `.next/`, `.nuxt/`, `.cache/`

   These are automatically excluded by the MCP server, but large repos may still hit timeouts.

#### "Analysis interrupted mid-way"

**Cause:** Network interruption or the MCP server process was terminated before completion.

**Solutions:**

1. **Check MCP server logs** - Logs location varies by client:

   **Claude Desktop (macOS):**
   ```bash
   tail -f ~/Library/Logs/Claude/mcp-server-supermodel.log
   ```

   **Claude Desktop (Windows):**
   ```powershell
   Get-Content "$env:APPDATA\Claude\Logs\mcp-server-supermodel.log" -Wait
   ```

   **Claude Desktop (Linux):**
   ```bash
   tail -f ~/.config/Claude/logs/mcp-server-supermodel.log
   ```

   **Cursor:**
   ```bash
   # Check the Cursor logs directory
   tail -f ~/Library/Application\ Support/Cursor/logs/mcp-server-supermodel.log
   ```

   **Claude Code:**
   ```bash
   # Logs are shown in the terminal when running with verbose mode
   claude --verbose
   ```

2. **Retry the analysis** - Temporary network issues often resolve on retry

3. **Check your internet connection** - The analysis requires a stable connection to the Supermodel API

4. **Verify the API is accessible:**
   ```bash
   curl -H "Authorization: Bearer YOUR_API_KEY" https://api.supermodeltools.com/health
   ```

#### "ERROR Request failed. Check the MCP server logs"

**Multiple possible causes:**

**1. Missing or invalid API key**

Check if your API key is set:
```bash
echo $SUPERMODEL_API_KEY
```

Verify it's valid at [Supermodel Dashboard](https://dashboard.supermodeltools.com).

**Solution:**
```bash
# Set in your shell profile (~/.zshrc or ~/.bashrc)
export SUPERMODEL_API_KEY="your-api-key"
source ~/.zshrc

# Or update your MCP client config with the correct key
```

**2. API service outage or rate limiting**

Check the error details in logs (see log locations above).

**Solution:**
- Visit [Supermodel Status](https://status.supermodeltools.com) for service status
- If rate limited, wait a few minutes before retrying
- Consider upgrading your API plan if hitting rate limits frequently

**3. Repository too large**

The API has size limits for analysis (typically 100MB compressed).

**Solution:**
```bash
# Check your repo size
du -sh /path/to/repo

# If too large, analyze subdirectories instead
explore_codebase(directory="/path/to/repo/src")
```

**4. Network or firewall issues**

Corporate firewalls may block outbound requests to the Supermodel API.

**Solution:**
- Test connectivity: `curl https://api.supermodeltools.com/health`
- Check firewall rules allow HTTPS to `api.supermodeltools.com`
- Contact your IT department if behind a corporate proxy

### Debug Logging

Debug logs go to stderr and include:

- `[DEBUG] Server configuration:` - Startup config
- `[DEBUG] Auto-zipping directory:` - Starting zip creation
- `[DEBUG] Auto-zip complete:` - Zip stats (file count, size)
- `[DEBUG] Making API request` - Request details
- `[ERROR] API call failed:` - Error details with HTTP status

To enable verbose logging, set the `DEBUG` environment variable:

```bash
# In your MCP config
{
  "mcpServers": {
    "supermodel": {
      "command": "npx",
      "args": ["-y", "@supermodeltools/mcp-server"],
      "env": {
        "SUPERMODEL_API_KEY": "your-api-key",
        "DEBUG": "supermodel:*"
      }
    }
  }
}
```

### Common Issues

- **401 Unauthorized:** Check `SUPERMODEL_API_KEY` is set correctly
- **ZIP too large:** Directory contains too many files/dependencies. Ensure `.gitignore` is configured properly
- **Permission denied:** Check read permissions on the directory
- **Insufficient disk space:** Free up space in your system's temp directory
- **Directory does not exist:** Verify the path is correct and absolute
- **ENOTFOUND or connection errors:** Check your internet connection and firewall settings

## Benchmarking

Benchmark this MCP server using [mcpbr](https://github.com/caspianmoon/mcpbr-benchmark-caching) with the provided [`mcpbr-config.yaml`](./mcpbr-config.yaml) configuration.

## Links

- [API Documentation](https://docs.supermodeltools.com)
- [Supermodel SDK](https://www.npmjs.com/package/@supermodeltools/sdk)
