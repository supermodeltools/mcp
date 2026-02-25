# Supermodel MCP Server

[![npm](https://img.shields.io/npm/v/@supermodeltools/mcp-server)](https://www.npmjs.com/package/@supermodeltools/mcp-server)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![CI](https://github.com/supermodeltools/mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/supermodeltools/mcp/actions/workflows/ci.yml)

MCP server that gives AI agents instant codebase understanding via the [Supermodel API](https://docs.supermodeltools.com). Pre-computed code graphs enable sub-second responses for symbol lookups, call-graph traversal, and cross-subsystem analysis.

## Install

### Quick Setup (Recommended)

```bash
curl -sSL https://raw.githubusercontent.com/supermodeltools/mcp/main/setup.sh | bash
```

<details>
<summary>Prefer to inspect before running? (Click to expand)</summary>

Download, review, then execute:

```bash
curl -sSL https://raw.githubusercontent.com/supermodeltools/mcp/main/setup.sh -o setup.sh
cat setup.sh
chmod +x setup.sh
./setup.sh
```

Or clone the entire repo:

```bash
git clone https://github.com/supermodeltools/mcp.git
cd mcp
./setup.sh
```

</details>

### Manual Install

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
| `SUPERMODEL_CACHE_DIR` | Directory for pre-computed graph cache files (optional) |
| `SUPERMODEL_TIMEOUT_MS` | API request timeout in ms (default: 900000 / 15 min) |
| `SUPERMODEL_NO_API_FALLBACK` | Set to disable on-demand API calls; cache-only mode (optional) |
| `SUPERMODEL_EXPERIMENT` | Experiment mode. Set to `graphrag` to enable GraphRAG tools (optional) |

### Global Setup (Recommended)

Set your API key globally in your shell profile so it's available to all MCP clients:

```bash
# Add to ~/.zshrc (macOS) or ~/.bashrc (Linux)
export SUPERMODEL_API_KEY="your-api-key"
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

## Usage

### Claude Code CLI

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

### Default Working Directory

For benchmarking tools or batch processing, pass a default working directory as a CLI argument:

```bash
npx @supermodeltools/mcp-server /path/to/repository
```

Tools will use this directory automatically if no explicit `directory` parameter is given.

## Tools

### `symbol_context` (Default Mode)

Deep dive on a specific function, class, or method. Given a symbol name, instantly returns its definition location, source code, all callers, all callees, domain membership, and related symbols in the same file.

**Output includes:**
- Definition location (file, line range) and source code
- Callers (who calls this symbol)
- Callees (what this symbol calls)
- Architectural domain membership
- Related symbols in the same file
- File import statistics

**Parameters:**

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `symbol` | string | No* | Name of the function, class, or method. Supports `ClassName.method` syntax and partial matching. |
| `symbols` | string[] | No* | Array of symbol names for batch lookup. More efficient than multiple calls. |
| `directory` | string | No | Path to repository directory. Omit if server was started with a default workdir. |
| `brief` | boolean | No | Return compact output (no source code). Recommended for 3+ symbols. |

\* Either `symbol` or `symbols` must be provided.

**Example prompts:**
- "Look up the symbol `filter_queryset` in this codebase"
- "What calls `QuerySet.filter` and what does it call?"

### GraphRAG Mode (Experimental)

Activate with `SUPERMODEL_EXPERIMENT=graphrag`. Replaces `symbol_context` with two graph-oriented tools for call-graph traversal and cross-subsystem analysis.

#### `explore_function`

BFS traversal of a function, class, or method call graph. Shows source code, callers, callees, and cross-subsystem boundaries with `← DIFFERENT SUBSYSTEM` markers.

**Parameters:**

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `symbol` | string | Yes | Function, class, or method name to explore. Supports partial matching and `ClassName.method` syntax. |
| `direction` | string | No | `downstream` (callees), `upstream` (callers), or `both` (default). |
| `depth` | number | No | Hops to follow: 1–3 (default: 2). |
| `directory` | string | No | Repository path. |

**Output:** Readable narrative showing upstream/downstream neighbors with domain context at each hop.

#### `find_connections`

Find how two subsystems or domains connect via function call relationships.

**Parameters:**

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `domain_a` | string | Yes | First domain or subdomain name. Fuzzy matching supported. |
| `domain_b` | string | Yes | Second domain or subdomain name. Fuzzy matching supported. |
| `directory` | string | No | Repository path. |

**Output:** List of bridge functions with file locations showing calls in both directions between the two domains.

### Recommended Workflow

**Default mode:**
1. Identify symbols from the issue and call `symbol_context` to explore them (batch via `symbols` array or parallel calls)
2. Use Read/Grep to examine source code at identified locations
3. Start editing by turn 3. Max 3 MCP calls total.

**GraphRAG mode:**
1. Identify key symbols from the issue, call `explore_function` to understand their call-graph context. Issue multiple calls in parallel (read-only, safe).
2. Use the cross-subsystem markers and source code from the response to start editing. Max 2 MCP calls total.

## Pre-computed Graphs

For fastest performance, pre-compute graphs ahead of time using the `precache` CLI subcommand. This calls the Supermodel API once and saves the result to disk, enabling sub-second tool responses with no API calls at runtime.

### Pre-compute a graph

```bash
npx @supermodeltools/mcp-server precache /path/to/repo --output-dir ./supermodel-cache
```

Options:
- `--output-dir <dir>` — Directory to save the cache file (default: `./supermodel-cache` or `SUPERMODEL_CACHE_DIR`)
- `--name <name>` — Repository name for the cache key (default: auto-detected from git remote + commit hash)

### Use cached graphs at runtime

```bash
SUPERMODEL_CACHE_DIR=./supermodel-cache npx @supermodeltools/mcp-server
```

The server loads all cached graphs from `SUPERMODEL_CACHE_DIR` at startup. If no cache exists for a given repository, the server falls back to an on-demand API call (which takes 5-15 minutes for large repos).

### Startup precaching

Use the `--precache` flag to automatically generate and cache the graph for the default workdir on server startup:

```bash
npx @supermodeltools/mcp-server /path/to/repo --precache
```

This is useful in automated environments (e.g., Docker containers for benchmarking) where you want the graph ready before any tool calls.

## Benchmarking

Benchmark this MCP server using [mcpbr](https://github.com/greynewell/mcpbr) with the provided [`mcpbr-config.yaml`](./mcpbr-config.yaml) configuration.

## Local Development

### Building from Source

```bash
git clone https://github.com/supermodeltools/mcp.git
cd mcp
npm install
npm run build
```

### Running Locally

```bash
node dist/index.js                    # Start MCP server
node dist/index.js /path/to/repo      # With default workdir
node dist/index.js precache /path/to/repo  # Pre-compute graph
```

### Running Tests

```bash
npm test              # Run all tests
npm run test:coverage # Run with coverage
npm run typecheck     # Type checking
```

### Using MCP Inspector

For interactive testing, use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Troubleshooting

### Timeout Errors

The first analysis of a repository requires an API call that can take 5-15 minutes. If your MCP client times out:

1. **Pre-compute the graph** — Use `precache` to generate the graph ahead of time (see [Pre-computed Graphs](#pre-computed-graphs))
2. **Increase your MCP client timeout** — For Claude Code CLI, set `MCP_TOOL_TIMEOUT=900000` in your shell profile
3. **Analyze a subdirectory** — Target specific parts of your codebase to reduce analysis time

### Common Issues

- **401 Unauthorized:** Check `SUPERMODEL_API_KEY` is set correctly
- **Permission denied:** Check read permissions on the directory
- **ENOTFOUND or connection errors:** Check your internet connection and firewall settings

### Debug Logging

Set the `DEBUG` environment variable for verbose logging:

```json
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

## Links

- [API Documentation](https://docs.supermodeltools.com)
- [Supermodel SDK](https://www.npmjs.com/package/@supermodeltools/sdk)
