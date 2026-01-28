#!/usr/bin/env node
/**
 * Local testing script for the Supermodel MCP server.
 *
 * Usage:
 *   node scripts/test-local.js [directory]
 *
 * Examples:
 *   node scripts/test-local.js                    # List available tools
 *   node scripts/test-local.js /path/to/repo      # Test with a repository
 *
 * Environment:
 *   SUPERMODEL_API_KEY - Required for API calls
 */

const { spawn } = require('child_process');
const readline = require('readline');

const testDir = process.argv[2];

// Start the MCP server
const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env }
});

let requestId = 0;

function sendRequest(method, params = {}) {
  const id = ++requestId;
  const request = {
    jsonrpc: '2.0',
    id,
    method,
    params
  };
  console.error(`\n>>> Sending: ${method}`);
  server.stdin.write(JSON.stringify(request) + '\n');
  return id;
}

// Parse JSON-RPC responses from stdout
const rl = readline.createInterface({
  input: server.stdout,
  crlfDelay: Infinity
});

const pendingRequests = new Map();

rl.on('line', (line) => {
  try {
    const response = JSON.parse(line);
    if (response.id) {
      console.error(`\n<<< Response (id=${response.id}):`);
      if (response.error) {
        console.error('Error:', JSON.stringify(response.error, null, 2));
      } else {
        console.log(JSON.stringify(response.result, null, 2));
      }
    }
  } catch (e) {
    // Not JSON, might be a notification
    console.error('Server:', line);
  }
});

// Run test sequence
async function runTests() {
  // Wait for server to start
  await new Promise(r => setTimeout(r, 500));

  console.error('\n=== Testing MCP Server ===\n');

  // 1. Initialize
  sendRequest('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' }
  });
  await new Promise(r => setTimeout(r, 500));

  // 2. List tools
  sendRequest('tools/list', {});
  await new Promise(r => setTimeout(r, 500));

  // 3. Ping health check
  sendRequest('ping', {});
  await new Promise(r => setTimeout(r, 500));

  if (testDir) {
    console.error(`\n=== Testing with directory: ${testDir} ===\n`);

    // 4. Test explore_codebase with graph_status query (fast, no API call)
    sendRequest('tools/call', {
      name: 'explore_codebase',
      arguments: {
        directory: testDir,
        query: 'graph_status'
      }
    });
    await new Promise(r => setTimeout(r, 1000));

    // 5. Test individual graph tools (these make API calls)
    console.error('\nTo test graph generation (requires API key and makes API calls):');
    console.error('  - get_call_graph');
    console.error('  - get_dependency_graph');
    console.error('  - get_domain_graph');
    console.error('  - get_parse_graph');
    console.error('\nUncomment the lines below to run full API tests.\n');

    // Uncomment to test individual graph tools:
    // sendRequest('tools/call', {
    //   name: 'get_call_graph',
    //   arguments: { directory: testDir }
    // });
    // await new Promise(r => setTimeout(r, 60000));
  }

  console.error('\n=== Tests complete ===\n');

  // Give time for final responses
  await new Promise(r => setTimeout(r, 1000));

  server.kill();
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  server.kill();
  process.exit(1);
});
