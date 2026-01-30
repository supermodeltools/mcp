# Experiment: Task-Specific Query Tools

## Hypothesis
The generic `explore_codebase` tool is too heavyweight. Agents need **focused, task-specific queries** that answer specific SWE questions directly.

## Current Problem
Agent needs: "What calls _cstack?"
Current approach:
1. Call explore_codebase with full codebase
2. Get back massive graph JSON
3. Parse through to find answer
4. Takes minutes, returns MB of data

## Proposed Solution
Add lightweight, purpose-built query tools:

```
find_call_sites(function_name) → "Where is this function called?"
trace_call_chain(from, to) → "How does control flow from A to B?"
find_definition(name) → "Where is this defined?"
find_implementations(interface) → "What implements this?"
trace_data_flow(variable, function) → "How does data flow?"
find_error_handlers(function) → "Where are errors caught?"
```

## Implementation Plan

### 1. New Tool: `find_call_sites`
```typescript
// MCP Tool
mcp__supermodel__find_call_sites

// Input
{
  path: "/workspace",
  function_name: "_cstack",
  include_context: true  // Include surrounding code
}

// Output (lightweight!)
{
  "function": "_cstack",
  "call_sites": [
    {
      "caller": "_separable",
      "file": "src/separable.py",
      "line": 123,
      "context": "Processing nested CompoundModel",
      "code_snippet": "result = _cstack(left_matrix, right_matrix)"
    }
  ],
  "total_calls": 3
}
```

### 2. New Tool: `trace_call_chain`
```typescript
// Input
{
  path: "/workspace",
  from_function: "separability_matrix",
  to_function: "_cstack"
}

// Output
{
  "path_exists": true,
  "call_chain": [
    {"function": "separability_matrix", "file": "src/separable.py", "line": 89},
    {"function": "_separable", "file": "src/separable.py", "line": 115},
    {"function": "_cstack", "file": "src/separable.py", "line": 123}
  ],
  "summary": "separability_matrix → _separable → _cstack"
}
```

### 3. New Tool: `find_definition`
Fast lookup without full graph analysis.

### 4. New Tool: `trace_data_flow`
Follow variable/parameter through call chain.

## Implementation Strategy

### Option A: Cache-First (Fast)
- Run full analysis once, cache results
- Query tools just lookup cached data
- Pro: Fast subsequent queries
- Con: Still requires initial full analysis

### Option B: Targeted Analysis (Efficient)
- Each tool runs minimal analysis for that specific query
- Use Supermodel API query filters
- Pro: No wasted computation
- Con: Multiple API calls

### Option C: Hybrid (Best)
- Cache full graph on first query
- Subsequent queries hit cache
- Tools abstract complexity

## Success Metrics
- Query response time < 5 seconds (vs minutes for full graph)
- Response size < 10KB (vs MB)
- Agents use tools proactively (early in task, not late)
- Higher tool usage rate (>50% of tasks vs 24%)

## Example Agent Flow
**Before (current):**
```
Agent: I need to understand _cstack
→ explore_codebase (returns 50MB graph, 2 min)
→ Parse JSON manually
→ Find answer buried in data
```

**After (proposed):**
```
Agent: I need to understand _cstack
→ find_call_sites("_cstack") (returns 5KB, 3 sec)
→ Get direct answer: "Called by _separable at line 123"
→ follow_call_chain if needed
```

## Files to Create
1. `src/tools/find-call-sites.ts` - New tool
2. `src/tools/trace-call-chain.ts` - New tool
3. `src/tools/find-definition.ts` - New tool
4. `src/tools/trace-data-flow.ts` - New tool
5. `src/queries/task-specific.ts` - Query handlers

## Files to Modify
1. `src/server.ts` - Register new tools
2. `src/cache/graph-cache.ts` - Add quick lookup indexes
