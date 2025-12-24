# Supermodel MCP Server

A standalone Model Context Protocol (MCP) server for the Supermodel API, built using the `@supermodeltools/sdk`. This server allows AI agents (like Cursor, Claude Desktop, etc.) to interact directly with Supermodel's graph generation capabilities.

## Features

- **Standalone Package:** No workspace dependencies on the main repo.
- **Supermodel SDK:** Uses the official `@supermodeltools/sdk`.
- **Graph Generation:** Exposes the `create_supermodel_graph_graphs` tool to generate Supermodel Intermediate Representation (SIR) from code repositories.
- **Smart Filtering:** Supports `jq` filtering to reduce context usage for large responses.

## Installation

1.  **Build the project:**

    ```bash
    cd packages/mcp-server
    npm install
    npm run build
    ```

## Configuration

The server requires API credentials to be provided via environment variables.

| Variable | Description |
| :--- | :--- |
| `SUPERMODEL_API_KEY` | Your Supermodel API Key. |
| `SUPERMODEL_BEARER_TOKEN` | Bearer token for authentication. |
| `SUPERMODEL_AUTH_TOKEN` | Alternative bearer token (fallback if `SUPERMODEL_BEARER_TOKEN` is not set). |
| `SUPERMODEL_BASE_URL` | (Optional) Override the API base URL. Defaults to `https://api.supermodeltools.com`. |

**Note:** The server will use `SUPERMODEL_BEARER_TOKEN` if available, otherwise falls back to `SUPERMODEL_AUTH_TOKEN`. At least one authentication token must be provided.

## Usage with MCP Clients

### Cursor / VS Code

Add the following configuration to your `config.json` (usually found in `~/.cursor/mcp.json` or similar):

```json
{
  "mcpServers": {
    "supermodel": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-server/dist/index.js"],
      "env": {
        "SUPERMODEL_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "supermodel": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-server/dist/index.js"],
      "env": {
        "SUPERMODEL_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Claude Code

To add this server to Claude Code, run the following command:

```bash
claude mcp add supermodel -- node /absolute/path/to/packages/mcp-server/dist/index.js
```

Note: You will need to ensure the `SUPERMODEL_API_KEY` is set in your environment where you run `claude`, or passed explicitly if supported.


## Available Tools

### `create_supermodel_graph_graphs`

Uploads a zipped repository snapshot to generate the Supermodel Intermediate Representation (SIR).

**Arguments:**
- `file` (string, required): Path to the ZIP file containing the code.
- `Idempotency-Key` (string, required): Unique key for the request to ensure idempotency.
- `jq_filter` (string, optional): A `jq` filter string to extract specific parts of the response (highly recommended to save context).

**Example Usage (by AI):**
> "Generate a supermodel graph for the code in `/tmp/my-repo.zip`."

## Troubleshooting

### Debug Logging

The server outputs debug logs to `stderr` to help diagnose issues:

- `[DEBUG] Server configuration:` - Shows base URL and whether credentials are set at startup
- `[DEBUG] Making API request` - Logs idempotency key and file path when making API calls
- `[DEBUG] Received response:` - Shows the full API response when successful
- `[ERROR] API call failed:` - Detailed error information including HTTP status codes, headers, and response data

### Common Issues

**Authentication Errors:**
- Ensure `SUPERMODEL_API_KEY` is set in your environment
- Verify at least one bearer token (`SUPERMODEL_BEARER_TOKEN` or `SUPERMODEL_AUTH_TOKEN`) is configured
- Check the debug logs at startup to confirm credentials are detected

**API Request Failures:**
- Check error logs for HTTP status codes (401 = authentication, 404 = endpoint not found, 500 = server error)
- Verify the ZIP file exists at the specified path
- Ensure the ZIP file is under 50MB and excludes dependencies (node_modules, etc.)

## Development

```bash
# Install dependencies
npm install

# Watch mode for development
npm run build -- --watch
```

