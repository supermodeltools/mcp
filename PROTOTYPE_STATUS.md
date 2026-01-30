# Task-Specific Query Tools - Prototype Status

## Branch: `experiment/task-specific-queries`

## What's Implemented

### 1. Find Call Sites Tool (`src/tools/find-call-sites.ts`)

Lightweight tool that answers: "Where is this function called?"

**Features:**
- Finds function by name (case-insensitive)
- Returns all call sites with line numbers
- Includes caller information
- Optional code context snippets
- Natural language summary
- Max results limit to control output size

**Input:**
```typescript
{
  path: "/workspace",
  function_name: "_cstack",
  include_context: true,
  max_results: 10
}
```

**Output:**
```typescript
{
  function_name: "_cstack",
  total_call_sites: 3,
  call_sites: [
    {
      caller: {name: "_separable", file: "src/separable.py", line: 115},
      call_site: {line: 123, column: 12, context: "inside_loop"}
    }
  ],
  summary: "Function '_cstack' is called by 3 function(s) in 2 file(s)..."
}
```

## What's Next

### TODO: Additional Tools
- [ ] `trace_call_chain`: Find path from function A to function B
- [ ] `find_definition`: Quick lookup of where something is defined
- [ ] `find_implementations`: What implements an interface/base class
- [ ] `trace_data_flow`: Follow parameter through call chain
- [ ] `find_error_handlers`: Where are errors caught for this function

### TODO: Integration
- [ ] Register tools with MCP server (`src/server.ts`)
- [ ] Add to tool list in system prompt
- [ ] Update cache to support efficient lookups
- [ ] Add caching layer for repeated queries

### TODO: Performance
- [ ] Benchmark query time (<5 seconds target)
- [ ] Measure output size (<10KB target)
- [ ] Test on large graphs (>10k functions)

### TODO: Testing
- [ ] Unit tests for each tool
- [ ] Integration tests with mock graphs
- [ ] Real-world testing on SWE-bench tasks

## Tools Planned

### 1. `find_call_sites` ✅ (Implemented)
"Where is function X called?"

### 2. `trace_call_chain` (Next)
```typescript
{
  from_function: "separability_matrix",
  to_function: "_cstack"
}
// Returns: [step1, step2, step3] with narrative
```

### 3. `find_definition` (Planned)
```typescript
{
  name: "_cstack",
  type: "function"  // or "class", "variable"
}
// Returns: Single result with file and line
```

### 4. `trace_data_flow` (Planned)
```typescript
{
  variable: "right_matrix",
  function: "_cstack"
}
// Returns: How parameter flows through function
```

## Benefits for Agents

**Current approach (heavyweight):**
- Call `explore_codebase` → 50MB graph, 2 minutes
- Parse JSON manually to find answer
- Used only 24% of time

**New approach (lightweight):**
- Call `find_call_sites("_cstack")` → 5KB, 3 seconds
- Direct answer: "Called by _separable at line 123"
- Expected usage: >50% of tasks

## Success Criteria
- [ ] Query time < 5 seconds (vs minutes)
- [ ] Response size < 10KB (vs MB)
- [ ] Agent adoption > 50% (vs 24%)
- [ ] Used proactively (early in task, not late)
