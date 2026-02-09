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

// generate subcommand limits (Supermodel.md renderer)
export const MAX_GENERATE_HUB_FUNCTIONS = 20;
export const MAX_GENERATE_SYMBOL_CLASSES = 50;
export const MAX_GENERATE_SYMBOL_FUNCTIONS = 100;
export const MAX_GENERATE_HOTSPOTS = 20;
export const MAX_GENERATE_HOTSPOT_EDGES = 10;
export const MAX_GENERATE_FILE_MAP_FILES = 200;
export const MAX_GENERATE_IMPORT_FILES = 50;
export const MAX_GENERATE_TEST_MAP = 100;

// get_related tool limits
export const MAX_RELATED_TARGETS = 5; // Max number of targets in a get_related query
export const MAX_RELATED_DEPTH = 3; // Max BFS depth for connecting paths
export const DEFAULT_RELATED_DEPTH = 2; // Default BFS depth
export const MAX_BRIDGE_SOURCE_LINES = 30; // Max source lines for bridge node snippets
