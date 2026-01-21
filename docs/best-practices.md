---
faq:
  - q: "What are the best practices for running mcpbr evaluations?"
    a: "Start with small sample sizes (n=5-10) to validate your setup, use templates for common scenarios, monitor costs by tracking token usage, and save results to compare different configurations. Always test your MCP server standalone before benchmarking."
  - q: "How can I optimize mcpbr evaluation costs?"
    a: "Use faster/cheaper models like Haiku for development, start with small samples, reduce max_iterations for initial testing, use --mcp-only to skip baseline runs during development, and enable verbose logging to catch issues early."
  - q: "What's the recommended workflow for testing a new MCP server?"
    a: "1) Test server standalone, 2) Run quick-test template with n=1, 3) Scale to n=5-10, 4) Analyze tool usage in results, 5) Optimize based on findings, 6) Run full evaluation with n=25-50+."
  - q: "How do I avoid common mcpbr pitfalls?"
    a: "Test Docker setup first, verify API keys are set, use pre-built images when available, set appropriate timeouts for your tasks, start with small samples, and always save results to enable comparisons and regression detection."
---

# Best Practices Guide

This guide helps you get the most value from mcpbr while avoiding common pitfalls. Whether you're testing a new MCP server, optimizing costs, or setting up CI/CD pipelines, these practices will help you work effectively.

## Quick Reference

| Scenario | Recommended Approach |
|----------|---------------------|
| First-time setup | Use `quick-test` template, verify with n=1 |
| MCP server testing | Standalone test → quick-test → scale gradually |
| Cost optimization | Use Haiku model, small samples, --mcp-only flag |
| Production evaluation | Use `production` template, save all outputs |
| CI/CD integration | Use regression detection, JUnit XML, notifications |
| Security testing | Start with cybergym-basic, progress to advanced |
| Debugging failures | Enable -vv, use --log-dir, analyze tool usage |

## Benchmark Selection Guidelines

### Choosing the Right Benchmark

**Use SWE-bench when:**
- Testing code exploration and bug-fixing capabilities
- Evaluating Python-focused MCP servers
- Need proven, standardized benchmarks
- Want fast evaluation with pre-built images

**Use CyberGym when:**
- Testing security analysis capabilities
- Evaluating C/C++ code understanding
- Need vulnerability detection benchmarks
- Want to test different difficulty levels

### SWE-bench Best Practices

**Start Small, Scale Gradually**
```bash
# Step 1: Single task smoke test
mcpbr run -c config.yaml -n 1 -v

# Step 2: Small sample
mcpbr run -c config.yaml -n 5 -o results-5.json

# Step 3: Medium sample
mcpbr run -c config.yaml -n 25 -o results-25.json

# Step 4: Full evaluation (if needed)
mcpbr run -c config.yaml -o results-full.json
```

**Use Pre-built Images**
```yaml
use_prebuilt_images: true  # Much faster and more reliable
```

Pre-built images provide:
- Validated dependency installation
- Consistent evaluation environment
- Faster startup (no package installation)
- Working Python imports inside containers

**Anti-pattern:** Disabling pre-built images without good reason
```bash
# Avoid this unless debugging dependency issues
mcpbr run -c config.yaml --no-prebuilt
```

### CyberGym Best Practices

**Choose Appropriate Difficulty Level**

| Level | Context | Use Case | Typical Success Rate |
|-------|---------|----------|---------------------|
| 0 | Minimal | Test discovery abilities | Low (10-20%) |
| 1 | Type only | Balanced challenge | Medium (20-40%) |
| 2 | Description | Practical testing | Higher (40-60%) |
| 3 | Full context | Maximum guidance | Highest (60-80%) |

**Start with Level 2 for Most Use Cases**
```bash
# Level 2 provides good balance of challenge and success
mcpbr run -c config.yaml --benchmark cybergym --level 2 -n 5
```

**Increase Timeouts for Compilation**
```yaml
benchmark: cybergym
timeout_seconds: 600  # CyberGym needs more time for builds
max_iterations: 15
```

**Anti-pattern:** Using level 3 for all testing
```bash
# Level 3 is too easy for meaningful evaluation
mcpbr run -c config.yaml --benchmark cybergym --level 3  # Not recommended
```

## MCP Server Configuration Best Practices

### Selecting MCP Servers

**Match Server Capabilities to Benchmark Needs**

For **SWE-bench** (bug fixing):
- Filesystem access (read/write)
- Code search capabilities
- Test execution tools
- Git operations

For **CyberGym** (security):
- Code analysis tools
- AST parsing
- Vulnerability pattern detection
- Build system integration

### Configuration Patterns

**Good: Clear, Minimal Configuration**
```yaml
mcp_server:
  name: "mcpbr"
  command: "npx"
  args: ["-y", "@modelcontextprotocol/server-filesystem", "{workdir}"]
  env: {}
```

**Better: With Environment Variables**
```yaml
mcp_server:
  name: "codebase"
  command: "npx"
  args: ["-y", "@supermodeltools/mcp-server"]
  env:
    SUPERMODEL_API_KEY: "${SUPERMODEL_API_KEY}"
    LOG_LEVEL: "info"
```

**Anti-pattern: Hardcoded Secrets**
```yaml
mcp_server:
  env:
    API_KEY: "sk-1234..."  # NEVER hardcode secrets!
```

### Testing Your MCP Server

**Step 1: Standalone Verification**
```bash
# Test server starts correctly
npx -y @modelcontextprotocol/server-filesystem /tmp/test

# For custom servers
python -m my_mcp_server --workspace /tmp/test
```

**Step 2: Quick Smoke Test**
```bash
# Single task with MCP only
mcpbr run -c config.yaml -n 1 -v -M
```

**Step 3: Analyze Tool Usage**
```bash
# Check if MCP tools are being used
mcpbr run -c config.yaml -n 5 -o results.json
cat results.json | jq '.tasks[0].mcp.tool_usage'
```

**Step 4: Compare Against Baseline**
```bash
# Full comparison
mcpbr run -c config.yaml -n 10 -o results.json
```

**Red Flags:**
- MCP tools never appear in tool_usage
- Tool usage is always 0 or very low
- Similar results between MCP and baseline
- Server startup warnings in logs

## Performance Optimization Tips

### Docker Resource Management

**Set Appropriate Concurrency**
```yaml
# For most systems
max_concurrent: 4

# For powerful machines (16+ GB RAM, 8+ cores)
max_concurrent: 8

# For limited resources or API rate limits
max_concurrent: 2

# For debugging
max_concurrent: 1
```

**Monitor Resource Usage**
```bash
# Check Docker resource consumption
docker stats

# Check running containers
docker ps | grep mcpbr
```

**Clean Up Orphaned Containers**
```bash
# Preview what will be removed
mcpbr cleanup --dry-run

# Remove orphaned containers
mcpbr cleanup -f
```

### Apple Silicon Optimization

**Expected Performance:**
- Tasks take 2-3x longer than native x86_64
- This is normal due to emulation
- Pre-built images help reduce overhead

**Recommended Settings:**
```yaml
max_concurrent: 2        # Reduce concurrency
timeout_seconds: 600     # Increase timeouts
use_prebuilt_images: true  # Essential for performance
```

**Install Rosetta 2** (if not already installed)
```bash
softwareupdate --install-rosetta
```

### Timeout Tuning

**Default Timeouts by Benchmark**

| Benchmark | Recommended Timeout | Max Iterations |
|-----------|-------------------|----------------|
| SWE-bench | 300-600s | 10-30 |
| CyberGym | 600-900s | 15-30 |

**Adjust Based on Task Complexity**
```yaml
# Simple tasks
timeout_seconds: 300
max_iterations: 10

# Complex tasks or slow hardware
timeout_seconds: 600
max_iterations: 30
```

**Anti-pattern: Extremely Long Timeouts**
```yaml
timeout_seconds: 3600  # 1 hour - probably too long
max_iterations: 100    # Too many iterations
```

### Model Selection

**Development/Testing:**
```yaml
model: "haiku"  # Fast, cheap, good for iteration
```

**Production/Benchmarking:**
```yaml
model: "sonnet"  # Best balance of performance and cost
```

**Maximum Performance:**
```yaml
model: "opus"  # Most capable, highest cost
```

## Cost Management Strategies

### Understanding Costs

**Token Usage Factors:**
- Model choice (Haiku < Sonnet < Opus)
- Number of iterations (more turns = more tokens)
- Task complexity (complex bugs require more exploration)
- Sample size (most obvious cost driver)

**Typical Costs (per task, Sonnet model):**
- Simple task: $0.10-0.30 (5-10K output tokens)
- Medium task: $0.30-0.80 (10-20K output tokens)
- Complex task: $0.80-2.00 (20-50K output tokens)

### Cost Optimization Strategies

**1. Start Small**
```bash
# Test with 1 task first
mcpbr run -c config.yaml -n 1

# Scale to 5 tasks to validate
mcpbr run -c config.yaml -n 5

# Only run full evaluation when confident
mcpbr run -c config.yaml -n 50
```

**2. Use Faster Models for Development**
```yaml
# Development config
model: "haiku"
sample_size: 5
max_iterations: 5
timeout_seconds: 180
```

**3. Skip Baseline During Iteration**
```bash
# Only run MCP agent while developing
mcpbr run -c config.yaml -M -n 5
```

**4. Reduce Iterations**
```yaml
max_iterations: 10  # Instead of 30
```

**5. Monitor Token Usage**
```bash
# Save results and check token consumption
mcpbr run -c config.yaml -n 5 -o results.json

# Analyze token usage
cat results.json | jq '.tasks[] | {id: .instance_id, tokens: .mcp.tokens}'
```

**Anti-pattern: Running Full Evaluations Repeatedly**
```bash
# Bad: Running 300 tasks multiple times during development
mcpbr run -c config.yaml  # Default: full dataset
mcpbr run -c config.yaml  # Oops, again...
# Result: Hundreds of dollars in API costs
```

**Good Pattern: Incremental Testing**
```bash
# Development cycle
mcpbr run -c config.yaml -n 1 -M  # $0.20
mcpbr run -c config.yaml -n 5 -M  # $1-2
mcpbr run -c config.yaml -n 10    # $5-10
# Only when ready:
mcpbr run -c config.yaml -n 50 -o final.json  # $50-100
```

### Cost Tracking

**Track Costs Per Run**
```python
import json

with open("results.json") as f:
    results = json.load(f)

# Calculate approximate costs (Sonnet pricing as of 2026)
INPUT_COST = 3.00 / 1_000_000   # $3 per 1M tokens
OUTPUT_COST = 15.00 / 1_000_000  # $15 per 1M tokens

total_cost = 0
for task in results["tasks"]:
    mcp = task.get("mcp", {})
    tokens = mcp.get("tokens", {})
    input_tokens = tokens.get("input", 0)
    output_tokens = tokens.get("output", 0)

    task_cost = (input_tokens * INPUT_COST) + (output_tokens * OUTPUT_COST)
    total_cost += task_cost

print(f"Total cost: ${total_cost:.2f}")
print(f"Average per task: ${total_cost / len(results['tasks']):.2f}")
```

## Result Interpretation Guidelines

### Understanding Resolution Rates

**What "Resolved" Means:**
1. Patch was generated
2. Patch applied cleanly
3. All FAIL_TO_PASS tests now pass
4. All PASS_TO_PASS tests still pass

**Interpreting Improvement:**
```text
MCP: 32% resolved (8/25)
Baseline: 20% resolved (5/25)
Improvement: +60%
```

This means:
- MCP agent is 60% better than baseline
- Your MCP server helped on 3 additional tasks
- Both agents struggled (absolute rates are low)

### Success Rate Benchmarks

**Typical Resolution Rates (SWE-bench Lite):**

| Configuration | Expected Range | Interpretation |
|--------------|----------------|----------------|
| Baseline (Sonnet) | 15-25% | Normal for single-shot |
| Basic filesystem MCP | 20-30% | Modest improvement |
| Advanced MCP server | 30-45% | Significant value |
| State-of-the-art | 45-60% | Excellent performance |

**Low Rates (Both < 15%):**
- Tasks may be inherently difficult
- Sample may include hard tasks
- Timeouts may be too short
- Model may need more iterations

**High Baseline (> 25%):**
- Sample may include easier tasks
- Good task selection
- Model is performing well

**Low Improvement (< 10%):**
- MCP tools not providing value
- Tools not being used effectively
- Baseline already sufficient

### Analyzing Tool Usage

**Extract Tool Statistics**
```bash
cat results.json | jq '.tasks[0].mcp.tool_usage'
```

**Healthy Tool Distribution:**
```json
{
  "Grep": 15,        // Searching code
  "Read": 20,        // Reading files
  "Bash": 25,        // Running tests
  "Edit": 5,         // Making changes
  "mcp__read": 10    // MCP tools being used
}
```

**Red Flags:**
```json
{
  "TodoWrite": 50,   // Too much planning, not enough action
  "mcp__search": 0   // MCP tools not being used at all
}
```

### Comparing Configurations

**Save Results with Descriptive Names**
```bash
mcpbr run -c filesystem.yaml -o results-filesystem.json
mcpbr run -c supermodel.yaml -o results-supermodel.json
```

**Compare Resolution Rates**
```python
import json

def compare_results(file1, file2):
    with open(file1) as f1, open(file2) as f2:
        r1 = json.load(f1)
        r2 = json.load(f2)

    rate1 = r1["summary"]["mcp"]["rate"]
    rate2 = r2["summary"]["mcp"]["rate"]

    print(f"{file1}: {rate1:.1%}")
    print(f"{file2}: {rate2:.1%}")
    print(f"Difference: {(rate2 - rate1):.1%}")

compare_results("results-filesystem.json", "results-supermodel.json")
```

## Security Considerations

### API Key Management

**Good: Environment Variables**
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
mcpbr run -c config.yaml
```

**Better: Shell Profile**
```bash
# Add to ~/.bashrc or ~/.zshrc
export ANTHROPIC_API_KEY="sk-ant-..."
```

**Best: Secret Management**
```bash
# Using 1Password CLI
export ANTHROPIC_API_KEY=$(op read "op://vault/mcpbr/api_key")

# Using AWS Secrets Manager
export ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \
  --secret-id mcpbr/anthropic-key --query SecretString --output text)
```

**Anti-pattern: Hardcoded in Config**
```yaml
# NEVER do this
env:
  ANTHROPIC_API_KEY: "sk-ant-..."  # Will be committed to git!
```

### Docker Security

**Network Isolation** (when external access not needed)
```yaml
# For most use cases, network access is required for API calls
# But if testing without MCP:
docker_network_mode: "none"
```

**Container Cleanup**
```bash
# Regularly clean up orphaned containers
mcpbr cleanup -f

# Check for running containers
docker ps | grep mcpbr
```

### Data Security

**Sensitive Repositories:**
- mcpbr runs on public datasets (SWE-bench, CyberGym)
- Do NOT use with proprietary code
- Task data is sent to Anthropic API
- Logs may contain code snippets

**Log Management:**
```bash
# Logs contain code and conversations
mcpbr run -c config.yaml --log-dir logs/

# Secure log files
chmod 700 logs/
```

## CI/CD Integration Patterns

### GitHub Actions

**Basic Workflow**
```yaml
name: MCP Benchmark

on:
  pull_request:
    paths:
      - 'mcp-server/**'

jobs:
  benchmark:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Install mcpbr
        run: pip install mcpbr

      - name: Run benchmark
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          mcpbr run -c config.yaml -n 10 -o results.json

      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: benchmark-results
          path: results.json
```

**With Regression Detection**
```yaml
- name: Download baseline
  run: |
    gh run download --name baseline-results --dir .

- name: Run with regression detection
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    mcpbr run -c config.yaml -n 25 \
      --baseline-results baseline.json \
      --regression-threshold 0.1 \
      --slack-webhook ${{ secrets.SLACK_WEBHOOK }} \
      -o current.json
```

**With JUnit XML**
```yaml
- name: Run benchmark
  run: mcpbr run -c config.yaml --output-junit junit.xml

- name: Publish test results
  uses: EnricoMi/publish-unit-test-result-action@v2
  if: always()
  with:
    files: junit.xml
```

### GitLab CI

```yaml
mcpbr-benchmark:
  image: python:3.11
  services:
    - docker:dind
  variables:
    DOCKER_HOST: tcp://docker:2375
  script:
    - pip install mcpbr
    - mcpbr run -c config.yaml -n 10 --output-junit junit.xml
  artifacts:
    reports:
      junit: junit.xml
    paths:
      - results.json
  only:
    - merge_requests
```

### Cost Control in CI/CD

**Sample Size Limits**
```yaml
# Don't run full benchmarks on every PR
mcpbr run -c config.yaml -n 10  # Small sample for PRs

# Full benchmarks on main branch only
mcpbr run -c config.yaml -n 50  # Larger sample for releases
```

**Conditional Execution**
```yaml
# Only run on MCP server changes
on:
  push:
    paths:
      - 'mcp-server/**'
      - 'config.yaml'
```

## Debugging and Troubleshooting

### Diagnostic Workflow

**Step 1: Verify Prerequisites**
```bash
# Check Docker
docker info

# Check API key
echo $ANTHROPIC_API_KEY | head -c 10

# Check Claude CLI
which claude
```

**Step 2: Test MCP Server Standalone**
```bash
# For filesystem server
npx -y @modelcontextprotocol/server-filesystem /tmp/test

# For custom servers
python -m my_mcp_server --workspace /tmp/test
```

**Step 3: Run Single Task with Verbose Logging**
```bash
mcpbr run -c config.yaml -n 1 -vv --log-dir debug/
```

**Step 4: Analyze Logs**
```bash
# Check system events
cat debug/*.json | jq '.events[] | select(.type == "system")'

# Check tool usage
cat debug/*.json | jq '.events[] | select(.type == "assistant") |
  .message.content[] | select(.type == "tool_use") | .name'
```

### Common Issues and Solutions

**MCP Server Not Starting**
```text
Warning: MCP server add failed (exit 1)
```

Solutions:
1. Test server command directly
2. Check environment variables are set
3. Verify command is in PATH
4. Check server logs for errors

**No Patch Generated**
```text
No changes made by Claude Code
```

Causes:
- Task too complex for iterations limit
- Agent couldn't find solution
- Agent made changes then reverted

Solutions:
```yaml
max_iterations: 30  # Increase from 10
timeout_seconds: 600  # Increase from 300
```

**Timeouts**
```text
Timeout after 300 seconds
```

Solutions:
```yaml
timeout_seconds: 600
max_concurrent: 2  # Reduce load
```

**Tests Failing**
```text
FAIL_TO_PASS: 0/2 passed
```

This means:
- Patch applied successfully
- But didn't fix the bug
- Agent made incorrect changes
- Not an mcpbr issue - agent behavior

### Debug Flags

**Verbose Output Levels**
```bash
# Standard output
mcpbr run -c config.yaml

# Verbose: summary + task progress
mcpbr run -c config.yaml -v

# Very verbose: detailed tool calls
mcpbr run -c config.yaml -vv
```

**Per-Instance Logs**
```bash
# Create detailed JSON logs for each task
mcpbr run -c config.yaml --log-dir logs/

# Logs are timestamped: instance_id_runtype_timestamp.json
ls logs/
# django__django-11099_mcp_20260120_143052.json
# django__django-11099_baseline_20260120_143156.json
```

**Single Log File**
```bash
# All events in one file
mcpbr run -c config.yaml --log-file full.log
```

## Iterative Development Workflow

### Phase 1: Quick Validation

**Goal:** Verify basic functionality

```bash
# 1. Test MCP server starts
npx -y @modelcontextprotocol/server-filesystem /tmp/test

# 2. Run single task
mcpbr init -t quick-test
mcpbr run -c mcpbr.yaml -v

# 3. Check if it worked
# - Did the server start? (check for warnings)
# - Were tools registered? (check verbose output)
# - Was a patch generated?
```

**Success Criteria:**
- No server startup errors
- Task completes without timeout
- Patch generated (even if incorrect)

### Phase 2: Small-Scale Testing

**Goal:** Validate at small scale

```bash
# 1. Run 5 tasks with MCP only
mcpbr run -c config.yaml -n 5 -M -o dev-mcp.json

# 2. Analyze tool usage
cat dev-mcp.json | jq '.tasks[].mcp.tool_usage'

# 3. Check if MCP tools are used
cat dev-mcp.json | jq '.tasks[].mcp.tool_usage |
  to_entries | map(select(.key | startswith("mcp")))'
```

**Success Criteria:**
- MCP tools appear in tool_usage
- At least 1-2 tasks resolved
- No consistent errors

### Phase 3: Baseline Comparison

**Goal:** Measure improvement

```bash
# 1. Run 10 tasks with MCP + baseline
mcpbr run -c config.yaml -n 10 -o comparison.json

# 2. Check improvement
cat comparison.json | jq '.summary'

# 3. Find MCP-only wins
cat comparison.json | jq '.tasks[] |
  select(.mcp.resolved == true and .baseline.resolved == false) |
  .instance_id'
```

**Success Criteria:**
- MCP rate > baseline rate
- At least 1-2 MCP-only wins
- Improvement > 10%

### Phase 4: Optimization

**Goal:** Improve performance based on findings

**Analyze Failures:**
```bash
# Find tasks where MCP failed
cat comparison.json | jq '.tasks[] |
  select(.mcp.resolved == false) |
  {id: .instance_id, error: .mcp.error, iterations: .mcp.iterations}'
```

**Common Optimizations:**
- Increase iterations if hitting limits
- Adjust timeout if tasks timeout
- Modify MCP server configuration
- Update agent prompt

### Phase 5: Production Evaluation

**Goal:** Final comprehensive benchmark

```bash
# 1. Run larger sample
mcpbr run -c config.yaml -n 50 -o production.json -r report.md

# 2. Save for regression detection
cp production.json baseline.json

# 3. Generate all outputs
mcpbr run -c config.yaml -n 50 \
  -o results.json \
  -y results.yaml \
  -r report.md \
  --output-junit junit.xml \
  --log-dir logs/
```

**Success Criteria:**
- Statistically significant sample (n >= 25)
- Results saved for future comparison
- Improvement is consistent
- Documentation completed

## Templates and Configuration

### Using Templates Effectively

**Start with Templates**
```bash
# List all templates
mcpbr templates

# Use appropriate template
mcpbr init -t quick-test      # For testing
mcpbr init -t filesystem      # For development
mcpbr init -t production      # For final evaluation
```

**Customize After Generation**
```bash
# Generate from template
mcpbr init -t filesystem

# Edit to customize
vim mcpbr.yaml

# Test your changes
mcpbr run -c mcpbr.yaml -n 1 -v
```

### Configuration Patterns

**Development Configuration**
```yaml
mcp_server:
  command: "npx"
  args: ["-y", "@modelcontextprotocol/server-filesystem", "{workdir}"]

model: "haiku"              # Fast and cheap
sample_size: 5              # Small sample
max_concurrent: 1           # Serial execution for debugging
timeout_seconds: 180        # Shorter timeout
max_iterations: 5           # Fewer iterations
use_prebuilt_images: true
```

**Production Configuration**
```yaml
mcp_server:
  command: "npx"
  args: ["-y", "@modelcontextprotocol/server-filesystem", "{workdir}"]

model: "sonnet"             # Best balance
sample_size: 50             # Meaningful sample
max_concurrent: 4           # Parallel execution
timeout_seconds: 600        # Generous timeout
max_iterations: 30          # More iterations
use_prebuilt_images: true
```

**CI/CD Configuration**
```yaml
mcp_server:
  command: "npx"
  args: ["-y", "@modelcontextprotocol/server-filesystem", "{workdir}"]

model: "sonnet"
sample_size: 10             # Quick feedback
max_concurrent: 2           # Don't overload
timeout_seconds: 300
max_iterations: 15          # Balanced
use_prebuilt_images: true
```

## Examples and Use Cases

### Use Case 1: Testing a New MCP Server

**Scenario:** You've built a custom MCP server with advanced code search

**Workflow:**
```bash
# 1. Create config from template
mcpbr init -t custom-python -o my-server.yaml

# 2. Edit to point to your server
# Update args: ["-m", "my_mcp_server", "--workspace", "{workdir}"]

# 3. Test standalone
python -m my_mcp_server --workspace /tmp/test

# 4. Quick test
mcpbr run -c my-server.yaml -n 1 -v -M

# 5. Small comparison
mcpbr run -c my-server.yaml -n 10 -o results.json

# 6. Analyze tool usage
cat results.json | jq '.tasks[0].mcp.tool_usage'

# 7. Full evaluation if promising
mcpbr run -c my-server.yaml -n 50 -o final.json -r report.md
```

### Use Case 2: Comparing Two MCP Servers

**Scenario:** Evaluating filesystem vs. Supermodel

**Workflow:**
```bash
# 1. Create configurations
mcpbr init -t filesystem -o filesystem.yaml
mcpbr init -t supermodel -o supermodel.yaml

# 2. Set API key for Supermodel
export SUPERMODEL_API_KEY="your-key"

# 3. Run identical samples
mcpbr run -c filesystem.yaml -n 25 -o fs-results.json
mcpbr run -c supermodel.yaml -n 25 -o sm-results.json

# 4. Compare results
python compare.py fs-results.json sm-results.json

# 5. Analyze differences
# Check which tasks each solved
# Compare tool usage patterns
# Analyze token consumption
```

### Use Case 3: Cost-Optimized Development

**Scenario:** Limited budget, need to test iteratively

**Workflow:**
```bash
# Phase 1: Ultra-cheap validation (< $1)
mcpbr init -t quick-test
# Edit: model: "haiku", sample_size: 1, max_iterations: 3
mcpbr run -c mcpbr.yaml -M  # MCP only, ~$0.10

# Phase 2: Small test (< $5)
# Edit: sample_size: 5, max_iterations: 5
mcpbr run -c mcpbr.yaml -M  # ~$2-3

# Phase 3: Baseline comparison (< $20)
# Edit: sample_size: 10, max_iterations: 10
mcpbr run -c mcpbr.yaml -o results.json  # ~$10-15

# Phase 4: Production (budgeted)
# Switch to: model: "sonnet", sample_size: 50
mcpbr run -c mcpbr.yaml -o final.json  # ~$100-150
```

### Use Case 4: CI/CD Integration

**Scenario:** Automated regression testing on PR

**Workflow:**
```yaml
# .github/workflows/mcp-test.yml
name: MCP Regression Test

on:
  pull_request:
    paths: ['mcp-server/**']

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Download baseline
        run: gh run download --name baseline --dir .

      - name: Install mcpbr
        run: pip install mcpbr

      - name: Run regression test
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          mcpbr run -c config.yaml -n 10 \
            --baseline-results baseline.json \
            --regression-threshold 0.1 \
            --slack-webhook ${{ secrets.SLACK_WEBHOOK }} \
            -o current.json \
            --output-junit junit.xml

      - name: Publish results
        uses: EnricoMi/publish-unit-test-result-action@v2
        if: always()
        with:
          files: junit.xml
```

### Use Case 5: Security Research

**Scenario:** Evaluating vulnerability detection capabilities

**Workflow:**
```bash
# 1. Start with basic level
mcpbr init -t cybergym-basic

# 2. Test single vulnerability
mcpbr run -c mcpbr.yaml -n 1 -v --log-dir logs/

# 3. Check PoC generation
# Look for poc.c, poc.py in logs
cat logs/*.json | jq '.events[] | select(.type == "assistant") |
  .message.content[] | select(.type == "text") | .text' | grep -i poc

# 4. Scale up
mcpbr run -c mcpbr.yaml -n 5 -o level1.json

# 5. Try higher level
mcpbr init -t cybergym-advanced -o level3.yaml
mcpbr run -c level3.yaml -n 5 -o level3.json

# 6. Compare difficulty levels
python compare.py level1.json level3.json
```

## Anti-Patterns to Avoid

### Configuration Anti-Patterns

**Bad: Hardcoded secrets**
```yaml
mcp_server:
  env:
    API_KEY: "sk-1234..."  # Will be committed!
```

**Bad: Unrealistic timeouts**
```yaml
timeout_seconds: 3600  # 1 hour
max_iterations: 100
```

**Bad: Excessive concurrency**
```yaml
max_concurrent: 20  # Will hit rate limits
```

### Workflow Anti-Patterns

**Bad: Running full benchmark during development**
```bash
# Don't do this repeatedly during development
mcpbr run -c config.yaml  # Full dataset every time!
```

**Bad: Not saving results**
```bash
# No way to compare or track progress
mcpbr run -c config.yaml  # Results lost!
```

**Bad: Skipping standalone testing**
```bash
# MCP server fails, wasting API costs
mcpbr run -c broken-config.yaml -n 50
```

### Analysis Anti-Patterns

**Bad: Focusing only on resolution rate**
```python
# Missing important insights
rate = results["summary"]["mcp"]["rate"]
print(f"Rate: {rate}")  # That's it?
```

**Bad: Not checking tool usage**
```python
# MCP tools might not be used at all!
print(f"Resolved: {results['summary']['mcp']['resolved']}")
```

**Bad: Comparing different samples**
```bash
# Results not comparable
mcpbr run -c config-a.yaml -n 10  # Random 10
mcpbr run -c config-b.yaml -n 10  # Different random 10
```

## Quick Start Checklist

**Before First Run:**
- [ ] Docker installed and running
- [ ] ANTHROPIC_API_KEY set
- [ ] Claude CLI installed (`which claude`)
- [ ] mcpbr installed (`mcpbr --version`)

**For New MCP Server:**
- [ ] Test server standalone
- [ ] Create config from template
- [ ] Run single task test (n=1)
- [ ] Check tool registration
- [ ] Verify MCP tools used
- [ ] Scale to 5-10 tasks
- [ ] Save results
- [ ] Compare vs baseline

**For Production Run:**
- [ ] Config validated
- [ ] Sample size determined
- [ ] Timeout appropriate
- [ ] Output paths specified
- [ ] Baseline results saved
- [ ] Budget confirmed
- [ ] Results will be saved

## Additional Resources

- [Configuration Guide](configuration.md) - Detailed configuration reference
- [Troubleshooting](troubleshooting.md) - Common issues and solutions
- [CLI Reference](cli.md) - All command options
- [Benchmarks Guide](benchmarks.md) - Benchmark details
- [Evaluation Results](evaluation-results.md) - Understanding output
- [Templates](templates.md) - Configuration templates
- [MCP Integration](mcp-integration.md) - MCP server testing

## Getting Help

**Before Asking for Help:**
1. Check [troubleshooting guide](troubleshooting.md)
2. Run with `-vv --log-dir debug/`
3. Test MCP server standalone
4. Verify prerequisites

**When Reporting Issues:**
- Include mcpbr version (`mcpbr --version`)
- Include Python version
- Include Docker version
- Include config file (redact secrets!)
- Include relevant logs
- Describe expected vs actual behavior

**Community:**
- [GitHub Issues](https://github.com/greynewell/mcpbr/issues) - Bug reports
- [GitHub Discussions](https://github.com/greynewell/mcpbr/discussions) - Questions
- [Documentation](https://greynewell.github.io/mcpbr/) - Comprehensive guides
