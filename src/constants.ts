/**
 * Application-wide constants
 * Single source of truth for configuration values
 */

// HTTP timeout configuration
export const DEFAULT_API_TIMEOUT_MS = 900_000; // 15 minutes (complex repos can take 10+ min)
export const CONNECTION_TIMEOUT_MS = 30_000; // 30 seconds to establish connection

// ZIP configuration
export const ZIP_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
export const MAX_ZIP_SIZE_BYTES = 500 * 1024 * 1024; // 500MB default

// Cache configuration
export const DEFAULT_MAX_GRAPHS = 20; // Maximum number of graphs to cache
export const DEFAULT_MAX_NODES = 1_000_000; // Maximum total nodes across all cached graphs
export const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour - time-to-live for cached graphs

// Overview tool output limits
export const MAX_OVERVIEW_DOMAINS = 10; // Top N domains to show in overview
export const MAX_OVERVIEW_HUB_FUNCTIONS = 10; // Top N hub functions to show

// Symbol context tool output limits
export const MAX_SYMBOL_CALLERS = 10; // Top N callers to show
export const MAX_SYMBOL_CALLEES = 10; // Top N callees to show
export const MAX_SYMBOL_RELATED = 8; // Related symbols in same file
export const MAX_SOURCE_LINES = 50; // Max lines of source code to include inline
