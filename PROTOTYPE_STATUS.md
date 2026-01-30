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

## What's Complete

### ✅ Implemented Tools
- [x] `find_call_sites`: Find where a function is called (COMPLETE)
- [x] `trace_call_chain`: Find path from function A to function B (COMPLETE)
- [x] `find_definition`: Quick lookup of where something is defined (COMPLETE)
- [x] `trace_data_flow`: Follow parameter through call chain (COMPLETE)

### ✅ Integration
- [x] Register tools with MCP server (`src/server.ts`)
- [x] Add to tool list in system prompt
- [x] Cache system supports efficient lookups (nameIndex, callAdj, etc.)

### ✅ Testing
- [x] Unit tests for `find_call_sites`
- [x] Unit tests for `trace_call_chain`
- [x] Unit tests for `find_definition`
- [x] Unit tests for `trace_data_flow`
- [x] Tests use mock graphs for isolation
- [x] Tests cover error cases (not found, multiple matches)

## What's Next

### TODO: Additional Tools (Future)
- [ ] `find_implementations`: What implements an interface/base class
- [ ] `find_error_handlers`: Where are errors caught for this function
- [ ] `find_dependencies`: What does this file/function depend on

### TODO: Performance Validation
- [ ] Benchmark query time (<5 seconds target)
- [ ] Measure output size (<10KB target)
- [ ] Test on large graphs (>10k functions)

### TODO: Real-World Testing
- [ ] Test on actual repositories
- [ ] Integration tests with real API calls
- [ ] SWE-bench task validation

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
