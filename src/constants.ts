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

// Query defaults
export const DEFAULT_QUERY_LIMIT = 200; // Default result limit for queries
export const MAX_NEIGHBORHOOD_DEPTH = 3; // Maximum traversal depth for neighborhood queries
