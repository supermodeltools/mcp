/**
 * Automatic repository zipping with gitignore and dockerignore support
 * Creates temporary ZIP files for codebase analysis
 */

import { createWriteStream, promises as fs } from 'fs';
import { join, relative, sep } from 'path';
import { tmpdir } from 'os';
import archiver from 'archiver';
import ignore, { Ignore } from 'ignore';
import { randomBytes } from 'crypto';
import { MAX_ZIP_SIZE_BYTES, ZIP_CLEANUP_AGE_MS } from '../constants';
import * as logger from './logger';

/**
 * Standard exclusions for security and size optimization
 * These patterns are applied in addition to .gitignore and .dockerignore
 */
const STANDARD_EXCLUSIONS = [
  // Version control
  '.git',
  '.svn',
  '.hg',

  // Dependencies
  'node_modules',
  'vendor',
  'venv',
  '.venv',
  'env',
  'virtualenv',
  'target', // Rust/Java

  // Build outputs
  'dist',
  'build',
  'out',
  '.next',
  '__pycache__',
  '*.pyc',
  '*.pyo',
  '*.so',
  '*.dylib',
  '*.dll',
  '*.class',

  // IDE files
  '.idea',
  '.vscode',
  '.vs',
  '*.swp',
  '*.swo',
  '*~',
  '.DS_Store',

  // Sensitive files (CRITICAL - prevent credential leaks)
  '.env',
  '.env.local',
  '.env.*.local',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  'secrets.yml',
  'secrets.yaml',
  'secrets.json',
  'credentials.json',
  'serviceaccount.json',
  '.aws/credentials',
  '.ssh/id_rsa',
  '.ssh/id_ed25519',

  // Large binary files
  '*.mp4',
  '*.avi',
  '*.mov',
  '*.zip',
  '*.tar',
  '*.gz',
  '*.rar',
  '*.7z',
  '*.iso',
  '*.dmg',
];

export interface ZipResult {
  /** Path to the created ZIP file */
  path: string;

  /** Cleanup function to delete the ZIP file */
  cleanup: () => Promise<void>;

  /** Number of files included in the ZIP */
  fileCount: number;

  /** Total size in bytes */
  sizeBytes: number;
}

export interface ZipOptions {
  /** Maximum ZIP size in bytes (default: 500MB) */
  maxSizeBytes?: number;

  /** Custom patterns to exclude (in addition to standard exclusions) */
  additionalExclusions?: string[];

  /**
   * Whether to include .gitignore files in the ZIP archive (default: true)
   *
   * Set to false to exclude all .gitignore files from the archive.
   * This can be useful for:
   * - Reducing archive size when .gitignore files are not needed for analysis
   * - Security: preventing exposure of ignore patterns that might reveal project structure
   *
   * Note: This only controls whether .gitignore files themselves are included.
   * The patterns defined in .gitignore files are always respected regardless of this setting.
   *
   * Default: true (maintains backward compatibility)
   */
  includeGitignore?: boolean;

  /**
   * Optional callback to track progress during ZIP creation.
   * Called approximately every 100 files (configurable via progressInterval).
   *
   * @param stats - Progress statistics
   * @param stats.filesProcessed - Number of files added to archive so far
   * @param stats.currentFile - Path of the current file being processed (relative to repository root)
   * @param stats.bytesProcessed - Total bytes processed across all files
   *
   * @example
   * ```typescript
   * await zipRepository('/path/to/repo', {
   *   onProgress: (stats) => {
   *     console.log(`Processed ${stats.filesProcessed} files (${formatBytes(stats.bytesProcessed)})`);
   *     console.log(`Current file: ${stats.currentFile}`);
   *   }
   * });
   * ```
   */
  onProgress?: (stats: {
    filesProcessed: number;
    currentFile: string;
    bytesProcessed: number;
  }) => void;

  /**
   * Number of files to process between progress callbacks (default: 100).
   * Lower values provide more frequent updates but with slight overhead.
   * Only used when onProgress is provided.
   */
  progressInterval?: number;
}

/**
 * Create a ZIP archive of a directory with gitignore and dockerignore support
 *
 * @param directoryPath - Path to the directory to archive
 * @param options - Configuration options for ZIP creation
 * @param options.maxSizeBytes - Maximum ZIP size in bytes (default: 500MB)
 * @param options.additionalExclusions - Custom patterns to exclude
 * @param options.includeGitignore - Whether to include .gitignore files (default: true)
 * @param options.onProgress - Optional callback to track progress
 * @param options.progressInterval - Files to process between progress callbacks (default: 100)
 * @returns Promise resolving to ZipResult with path, cleanup function, and metadata
 *
 * @example
 * // Create ZIP excluding .gitignore files with progress tracking
 * const result = await zipRepository('/path/to/repo', {
 *   includeGitignore: false,
 *   maxSizeBytes: 100 * 1024 * 1024, // 100MB
 *   onProgress: (stats) => console.log(`${stats.filesProcessed} files`)
 * });
 */
export async function zipRepository(
  directoryPath: string,
  options: ZipOptions = {}
): Promise<ZipResult> {
  const maxSizeBytes = options.maxSizeBytes || MAX_ZIP_SIZE_BYTES;

  // Validate directory exists
  try {
    const stats = await fs.stat(directoryPath);
    if (!stats.isDirectory()) {
      const errorMsg = `Path is not a directory: ${directoryPath}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const errorMsg = `Directory does not exist: ${directoryPath}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    if (error.code === 'EACCES') {
      const errorMsg = `Permission denied accessing directory: ${directoryPath}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    // Re-throw unknown errors with logging
    logger.error('Failed to validate directory:', directoryPath);
    logger.error('Error:', error.message);
    throw error;
  }

  // Parse gitignore files
  const ignoreFilter = await buildIgnoreFilter(
    directoryPath,
    options.additionalExclusions,
    options.includeGitignore
  );

  // Estimate directory size before starting ZIP creation
  logger.debug('Estimating directory size...');
  const estimatedSize = await estimateDirectorySize(directoryPath, ignoreFilter);
  logger.debug('Estimated size:', formatBytes(estimatedSize));

  // Check if estimated size exceeds limit
  if (estimatedSize > maxSizeBytes) {
    throw new Error(
      `Directory size (${formatBytes(estimatedSize)}) exceeds maximum allowed size (${formatBytes(maxSizeBytes)}). ` +
      `Consider excluding more directories or analyzing a subdirectory.`
    );
  }

  // Create temp file path
  const tempDir = tmpdir();
  const zipFileName = `supermodel-${randomBytes(8).toString('hex')}.zip`;
  const zipPath = join(tempDir, zipFileName);

  logger.debug('Creating ZIP:', zipPath);
  logger.debug('Source directory:', directoryPath);

  // Create ZIP archive
  let fileCount = 0;
  let totalSize = 0;

  const output = createWriteStream(zipPath);
  const archive = archiver('zip', {
    zlib: { level: 6 } // Balanced compression
  });

  // Track errors
  let archiveError: Error | null = null;

  archive.on('error', (err) => {
    logger.error('Archive error:', err.message);
    archiveError = err;
  });

  archive.on('warning', (err) => {
    if (err.code === 'ENOENT') {
      logger.warn('File not found (skipping):', err.message);
    } else {
      logger.warn('Archive warning:', err.message);
    }
  });

  // Track progress
  archive.on('entry', (entry) => {
    fileCount++;
    totalSize += entry.stats?.size || 0;

    // Check size limit
    if (totalSize > maxSizeBytes) {
      const errorMsg =
        `ZIP size exceeds limit (${formatBytes(maxSizeBytes)}). ` +
        `Current size: ${formatBytes(totalSize)}. ` +
        `Consider excluding more directories or analyzing a subdirectory.`;
      logger.error(errorMsg);
      archive.abort();
      archiveError = new Error(errorMsg);
    }
  });

  // Pipe to file
  archive.pipe(output);

  // Add files recursively with filtering
  // Initialize progress state if progress callback is provided
  const progressState: ProgressState | undefined = options.onProgress
    ? { filesProcessed: 0, bytesProcessed: 0, lastReportedCount: 0, lastFile: '' }
    : undefined;

  await addFilesRecursively(archive, directoryPath, directoryPath, ignoreFilter, options, progressState);

  // Finalize archive
  await archive.finalize();

  // Wait for output stream to finish
  await new Promise<void>((resolve, reject) => {
    output.on('close', () => {
      if (archiveError) {
        reject(archiveError);
      } else {
        resolve();
      }
    });
    output.on('error', (err) => {
      logger.error('Output stream error:', err.message);
      reject(err);
    });
  });

  // Check for errors during archiving
  if (archiveError) {
    logger.error('Archiving failed, cleaning up partial ZIP');
    // Clean up partial ZIP
    await fs.unlink(zipPath).catch(() => {});
    throw archiveError;
  }

  // Get final file size
  const zipStats = await fs.stat(zipPath);
  const zipSizeBytes = zipStats.size;

  logger.debug('ZIP created successfully');
  logger.debug('Files included:', fileCount);
  logger.debug('ZIP size:', formatBytes(zipSizeBytes));

  // Create cleanup function
  const cleanup = async () => {
    try {
      await fs.unlink(zipPath);
      logger.debug('Cleaned up ZIP:', zipPath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.warn('Failed to cleanup ZIP:', error.message);
      }
    }
  };

  return {
    path: zipPath,
    cleanup,
    fileCount,
    sizeBytes: zipSizeBytes,
  };
}

/**
 * Estimate total size of directory with ignore filters applied
 * Returns total size in bytes of files that would be included in the ZIP
 */
async function estimateDirectorySize(
  rootDir: string,
  ignoreFilter: Ignore
): Promise<number> {
  let totalSize = 0;

  async function walkDirectory(currentDir: string): Promise<void> {
    let entries: string[];

    try {
      entries = await fs.readdir(currentDir);
    } catch (error: any) {
      if (error.code === 'EACCES') {
        logger.warn('Permission denied:', currentDir);
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);
      const relativePath = relative(rootDir, fullPath);

      // Normalize path for ignore matching (use forward slashes)
      const normalizedRelativePath = relativePath.split(sep).join('/');

      // Check if ignored
      if (ignoreFilter.ignores(normalizedRelativePath)) {
        continue;
      }

      let stats;
      try {
        stats = await fs.lstat(fullPath);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          // File disappeared, skip
          continue;
        }
        logger.warn('Failed to stat:', fullPath, error.message);
        continue;
      }

      // Skip symlinks to prevent following links outside the repository
      if (stats.isSymbolicLink()) {
        continue;
      }

      if (stats.isDirectory()) {
        // Check if directory itself should be ignored
        const dirPath = normalizedRelativePath + '/';
        if (ignoreFilter.ignores(dirPath)) {
          continue;
        }

        // Recurse into directory
        await walkDirectory(fullPath);
      } else if (stats.isFile()) {
        // Add file size to total
        totalSize += stats.size;
      }
      // Skip other special files (sockets, FIFOs, etc.)
    }
  }

  await walkDirectory(rootDir);
  return totalSize;
}

/**
 * Build ignore filter from .gitignore, .dockerignore files and standard exclusions
 * Recursively finds and parses .gitignore files in subdirectories
 *
 * @param rootDir - Root directory to build filter for
 * @param additionalExclusions - Additional patterns to exclude
 * @param includeGitignore - Whether to include .gitignore files in the archive (default: true)
 */
async function buildIgnoreFilter(
  rootDir: string,
  additionalExclusions: string[] = [],
  includeGitignore: boolean = true
): Promise<Ignore> {
  const ig = ignore();

  // Add standard exclusions
  ig.add(STANDARD_EXCLUSIONS);

  // Add custom exclusions
  if (additionalExclusions.length > 0) {
    ig.add(additionalExclusions);
  }

  // Exclude .gitignore files if requested
  if (includeGitignore === false) {
    ig.add(['.gitignore', '**/.gitignore']);
    logger.debug('Excluding .gitignore files from archive');
  }

  // Recursively find and parse all .gitignore files
  const gitignoreFiles = await findGitignoreFiles(rootDir);

  for (const gitignorePath of gitignoreFiles) {
    try {
      const gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
      const patterns = gitignoreContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

      if (patterns.length > 0) {
        // Get the directory containing this .gitignore
        const gitignoreDir = gitignorePath.substring(0, gitignorePath.length - '.gitignore'.length);
        const relativeDir = relative(rootDir, gitignoreDir);

        // Scope patterns to their directory
        const scopedPatterns = patterns.map(pattern => {
          // If pattern starts with '/', it's relative to the .gitignore location
          if (pattern.startsWith('/')) {
            const patternWithoutSlash = pattern.substring(1);
            return relativeDir ? `${relativeDir}/${patternWithoutSlash}` : patternWithoutSlash;
          }
          // If pattern starts with '!', handle negation
          else if (pattern.startsWith('!')) {
            const negatedPattern = pattern.substring(1);
            if (negatedPattern.startsWith('/')) {
              const patternWithoutSlash = negatedPattern.substring(1);
              return relativeDir ? `!${relativeDir}/${patternWithoutSlash}` : `!${patternWithoutSlash}`;
            }
            // For non-rooted negation patterns, prefix with directory
            return relativeDir ? `!${relativeDir}/${negatedPattern}` : `!${negatedPattern}`;
          }
          // For non-rooted patterns, prefix with the directory path
          else {
            return relativeDir ? `${relativeDir}/${pattern}` : pattern;
          }
        });

        ig.add(scopedPatterns);

        const location = relativeDir ? `in ${relativeDir}/` : 'in root';
        logger.debug(`Loaded .gitignore ${location} with ${patterns.length} patterns`);
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.warn('Failed to read .gitignore at', gitignorePath, ':', error.message);
      }
    }
  }

  // Parse .dockerignore in root
  const dockerignorePath = join(rootDir, '.dockerignore');
  try {
    const dockerignoreContent = await fs.readFile(dockerignorePath, 'utf-8');
    const patterns = dockerignoreContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    if (patterns.length > 0) {
      ig.add(patterns);
      console.error('[DEBUG] Loaded .dockerignore with', patterns.length, 'patterns');
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      console.error('[WARN] Failed to read .dockerignore:', error.message);
    }
  }

  return ig;
}

/**
 * Recursively find all .gitignore files in a directory tree
 */
async function findGitignoreFiles(rootDir: string): Promise<string[]> {
  const gitignoreFiles: string[] = [];

  async function searchDirectory(dir: string): Promise<void> {
    let entries: string[];

    try {
      entries = await fs.readdir(dir);
    } catch (error: any) {
      if (error.code === 'EACCES') {
        logger.warn('Permission denied:', dir);
        return;
      }
      return;
    }

    for (const entry of entries) {
      // Skip .git directory and other version control directories
      if (entry === '.git' || entry === '.svn' || entry === '.hg') {
        continue;
      }

      const fullPath = join(dir, entry);

      // If this is a .gitignore file, add it to the list
      if (entry === '.gitignore') {
        gitignoreFiles.push(fullPath);
        continue;
      }

      // If it's a directory, recurse into it
      try {
        const stats = await fs.lstat(fullPath);
        if (stats.isDirectory() && !stats.isSymbolicLink()) {
          await searchDirectory(fullPath);
        }
      } catch (error: any) {
        // Skip files we can't access
        continue;
      }
    }
  }

  await searchDirectory(rootDir);

  // Sort so root .gitignore is processed first
  gitignoreFiles.sort((a, b) => {
    const aDepth = a.split(sep).length;
    const bDepth = b.split(sep).length;
    return aDepth - bDepth;
  });

  return gitignoreFiles;
}

/**
 * Progress tracking state for addFilesRecursively
 */
interface ProgressState {
  filesProcessed: number;
  bytesProcessed: number;
  lastReportedCount: number;
  lastFile: string;
}

/**
 * Recursively add files to archive with filtering
 */
async function addFilesRecursively(
  archive: archiver.Archiver,
  rootDir: string,
  currentDir: string,
  ignoreFilter: Ignore,
  options?: ZipOptions,
  progressState?: ProgressState
): Promise<void> {
  let entries: string[];

  try {
    entries = await fs.readdir(currentDir);
  } catch (error: any) {
    if (error.code === 'EACCES') {
      logger.warn('Permission denied:', currentDir);
      return;
    }
    logger.error('Failed to read directory:', currentDir);
    logger.error('Error:', error.message);
    throw error;
  }

  for (const entry of entries) {
    const fullPath = join(currentDir, entry);
    const relativePath = relative(rootDir, fullPath);

    // Normalize path for ignore matching (use forward slashes)
    const normalizedRelativePath = relativePath.split(sep).join('/');

    // Check if ignored
    if (ignoreFilter.ignores(normalizedRelativePath)) {
      continue;
    }

    let stats;
    try {
      stats = await fs.lstat(fullPath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File disappeared, skip
        continue;
      }
      console.error('[WARN] Failed to stat:', fullPath, error.message);
      continue;
    }

    // Skip symlinks to prevent following links outside the repository
    if (stats.isSymbolicLink()) {
      logger.warn('Skipping symlink:', fullPath);
      continue;
    }

    if (stats.isDirectory()) {
      // Check if directory itself should be ignored
      const dirPath = normalizedRelativePath + '/';
      if (ignoreFilter.ignores(dirPath)) {
        continue;
      }

      // Recurse into directory
      await addFilesRecursively(archive, rootDir, fullPath, ignoreFilter, options, progressState);
    } else if (stats.isFile()) {
      // Add file to archive
      try {
        archive.file(fullPath, { name: normalizedRelativePath });

        // Track progress if callback is provided
        if (progressState && options?.onProgress) {
          progressState.filesProcessed++;
          progressState.bytesProcessed += stats.size;
          progressState.lastFile = normalizedRelativePath;

          const progressInterval = options.progressInterval || 100;

          // Report progress every N files
          if (progressState.filesProcessed - progressState.lastReportedCount >= progressInterval) {
            logger.debug(
              `Progress: ${progressState.filesProcessed} files, ${formatBytes(progressState.bytesProcessed)}`
            );

            options.onProgress({
              filesProcessed: progressState.filesProcessed,
              currentFile: normalizedRelativePath,
              bytesProcessed: progressState.bytesProcessed,
            });

            progressState.lastReportedCount = progressState.filesProcessed;
          }
        }
      } catch (error: any) {
        logger.warn('Failed to add file:', fullPath, error.message);
      }
    }
    // Skip other special files (sockets, FIFOs, etc.)
  }

  // Report final progress if we have a callback and there are unreported files
  // Only report at the root level (when currentDir === rootDir)
  if (
    currentDir === rootDir &&
    progressState &&
    options?.onProgress &&
    progressState.filesProcessed > progressState.lastReportedCount
  ) {
    logger.debug(
      `Final progress: ${progressState.filesProcessed} files, ${formatBytes(progressState.bytesProcessed)}`
    );

    options.onProgress({
      filesProcessed: progressState.filesProcessed,
      currentFile: progressState.lastFile,
      bytesProcessed: progressState.bytesProcessed,
    });
  }
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Clean up old ZIP files from temp directory
 * Removes ZIPs older than the specified age
 */
export async function cleanupOldZips(maxAgeMs: number = ZIP_CLEANUP_AGE_MS): Promise<void> {
  const tempDir = tmpdir();
  const now = Date.now();

  try {
    const entries = await fs.readdir(tempDir);
    let removedCount = 0;

    for (const entry of entries) {
      // Only process our ZIP files
      if (!entry.startsWith('supermodel-') || !entry.endsWith('.zip')) {
        continue;
      }

      const fullPath = join(tempDir, entry);

      try {
        const stats = await fs.stat(fullPath);
        const ageMs = now - stats.mtimeMs;

        if (ageMs > maxAgeMs) {
          await fs.unlink(fullPath);
          removedCount++;
        }
      } catch (error: any) {
        // File might have been deleted already, ignore
        if (error.code !== 'ENOENT') {
          logger.warn('Failed to cleanup:', fullPath, error.message);
        }
      }
    }

    if (removedCount > 0) {
      logger.debug('Cleaned up', removedCount, 'old ZIP files');
    }
  } catch (error: any) {
    logger.warn('Failed to cleanup temp directory:', error.message);
  }
}
