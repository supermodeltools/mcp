import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { zipRepository, cleanupOldZips, ZipOptions } from './zip-repository';
import { randomBytes } from 'crypto';

describe('zip-repository', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `test-zip-${randomBytes(8).toString('hex')}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('zipRepository', () => {
    describe('basic functionality', () => {
      it('should create a ZIP file for a valid directory', async () => {
        // Create a simple file structure
        await fs.writeFile(join(testDir, 'test.txt'), 'Hello World');
        await fs.writeFile(join(testDir, 'test2.txt'), 'Hello Again');

        const result = await zipRepository(testDir);

        expect(result.path).toBeTruthy();
        expect(result.fileCount).toBeGreaterThan(0);
        expect(result.sizeBytes).toBeGreaterThan(0);
        expect(typeof result.cleanup).toBe('function');

        // Verify ZIP file exists
        const stats = await fs.stat(result.path);
        expect(stats.isFile()).toBe(true);

        // Cleanup
        await result.cleanup();
      });

      it('should include file count in results', async () => {
        // Create 3 files
        await fs.writeFile(join(testDir, 'file1.txt'), 'content1');
        await fs.writeFile(join(testDir, 'file2.txt'), 'content2');
        await fs.writeFile(join(testDir, 'file3.txt'), 'content3');

        const result = await zipRepository(testDir);

        expect(result.fileCount).toBe(3);

        await result.cleanup();
      });

      it('should cleanup the ZIP file when cleanup is called', async () => {
        await fs.writeFile(join(testDir, 'test.txt'), 'content');

        const result = await zipRepository(testDir);
        const zipPath = result.path;

        // Verify file exists
        await fs.stat(zipPath);

        // Cleanup
        await result.cleanup();

        // Verify file is deleted
        await expect(fs.stat(zipPath)).rejects.toThrow();
      });
    });

    describe('error handling', () => {
      it('should throw error for non-existent directory', async () => {
        const nonExistentDir = join(testDir, 'does-not-exist');

        await expect(zipRepository(nonExistentDir)).rejects.toThrow(
          'Directory does not exist'
        );
      });

      it('should throw error when path is not a directory', async () => {
        // Create a file instead of directory
        const filePath = join(testDir, 'not-a-dir.txt');
        await fs.writeFile(filePath, 'content');

        await expect(zipRepository(filePath)).rejects.toThrow(
          'Path is not a directory'
        );
      });

      it('should handle size limit exceeded', async () => {
        // Create a file
        await fs.writeFile(join(testDir, 'test.txt'), 'content');

        const options: ZipOptions = {
          maxSizeBytes: 1, // Very small limit (1 byte)
        };

        await expect(zipRepository(testDir, options)).rejects.toThrow(
          /exceeds maximum allowed size|exceeds limit/
        );
      });
    });

    describe('gitignore parsing', () => {
      it('should respect .gitignore patterns', async () => {
        // Create files
        await fs.writeFile(join(testDir, 'included.txt'), 'include me');
        await fs.writeFile(join(testDir, 'excluded.txt'), 'exclude me');

        // Create .gitignore
        await fs.writeFile(join(testDir, '.gitignore'), 'excluded.txt\n');

        const result = await zipRepository(testDir);

        // Should only include 1 file (included.txt)
        // Note: .gitignore itself might be included, so checking for at least 1
        expect(result.fileCount).toBeGreaterThan(0);
        expect(result.fileCount).toBeLessThan(3); // Not all 3 files

        await result.cleanup();
      });

      it('should apply standard exclusions (node_modules)', async () => {
        // Create node_modules
        const nodeModulesDir = join(testDir, 'node_modules');
        await fs.mkdir(nodeModulesDir, { recursive: true });
        await fs.writeFile(join(nodeModulesDir, 'package.json'), '{}');
        await fs.writeFile(join(testDir, 'index.js'), 'content');

        const result = await zipRepository(testDir);

        // Should not include node_modules content
        expect(result.fileCount).toBe(1); // Only index.js

        await result.cleanup();
      });

      it('should exclude .git directory', async () => {
        // Create .git directory
        const gitDir = join(testDir, '.git');
        await fs.mkdir(gitDir, { recursive: true });
        await fs.writeFile(join(gitDir, 'config'), 'git config');
        await fs.writeFile(join(testDir, 'index.js'), 'content');

        const result = await zipRepository(testDir);

        // Should not include .git content
        expect(result.fileCount).toBe(1); // Only index.js

        await result.cleanup();
      });

      it('should support additional exclusions', async () => {
        await fs.writeFile(join(testDir, 'keep.txt'), 'keep');
        await fs.writeFile(join(testDir, 'exclude.txt'), 'exclude');

        const options: ZipOptions = {
          additionalExclusions: ['exclude.txt'],
        };

        const result = await zipRepository(testDir, options);

        expect(result.fileCount).toBe(1); // Only keep.txt

        await result.cleanup();
      });

      it('should handle nested .gitignore files', async () => {
        // Create subdirectory with its own .gitignore
        const subDir = join(testDir, 'subdir');
        await fs.mkdir(subDir, { recursive: true });
        await fs.writeFile(join(testDir, 'root.txt'), 'root');
        await fs.writeFile(join(subDir, 'keep.txt'), 'keep');
        await fs.writeFile(join(subDir, 'ignore.txt'), 'ignore');
        await fs.writeFile(join(subDir, '.gitignore'), 'ignore.txt\n');

        const result = await zipRepository(testDir);

        // Should include root.txt and subdir/keep.txt (and .gitignore files)
        expect(result.fileCount).toBeGreaterThanOrEqual(2);

        await result.cleanup();
      });
    });

    describe('symlink handling', () => {
      it('should skip symlinks', async () => {
        await fs.writeFile(join(testDir, 'real.txt'), 'real file');

        try {
          // Create symlink (may fail on Windows without admin)
          await fs.symlink(
            join(testDir, 'real.txt'),
            join(testDir, 'link.txt'),
            'file'
          );

          const result = await zipRepository(testDir);

          // Should only include the real file, not the symlink
          expect(result.fileCount).toBe(1);

          await result.cleanup();
        } catch (error: any) {
          // Skip test if symlinks not supported (Windows without admin)
          if (error.code === 'EPERM') {
            console.log('Skipping symlink test - insufficient permissions');
          } else {
            throw error;
          }
        }
      });
    });

    describe('path handling', () => {
      it('should handle directories with spaces', async () => {
        const spacedDir = join(testDir, 'dir with spaces');
        await fs.mkdir(spacedDir, { recursive: true });
        await fs.writeFile(join(spacedDir, 'file.txt'), 'content');

        const result = await zipRepository(spacedDir);

        expect(result.fileCount).toBe(1);

        await result.cleanup();
      });

      it('should handle nested directory structures', async () => {
        const nestedDir = join(testDir, 'a', 'b', 'c');
        await fs.mkdir(nestedDir, { recursive: true });
        await fs.writeFile(join(nestedDir, 'deep.txt'), 'deep content');

        const result = await zipRepository(testDir);

        expect(result.fileCount).toBe(1);

        await result.cleanup();
      });
    });

    describe('sensitive file exclusion', () => {
      it('should exclude .env files', async () => {
        await fs.writeFile(join(testDir, '.env'), 'SECRET=123');
        await fs.writeFile(join(testDir, 'index.js'), 'content');

        const result = await zipRepository(testDir);

        // Should only include index.js
        expect(result.fileCount).toBe(1);

        await result.cleanup();
      });

      it('should exclude credential files', async () => {
        await fs.writeFile(join(testDir, 'credentials.json'), '{}');
        await fs.writeFile(join(testDir, 'serviceaccount.json'), '{}');
        await fs.writeFile(join(testDir, 'index.js'), 'content');

        const result = await zipRepository(testDir);

        // Should only include index.js
        expect(result.fileCount).toBe(1);

        await result.cleanup();
      });

      it('should exclude .pem and .key files', async () => {
        await fs.writeFile(join(testDir, 'private.pem'), 'KEY');
        await fs.writeFile(join(testDir, 'private.key'), 'KEY');
        await fs.writeFile(join(testDir, 'index.js'), 'content');

        const result = await zipRepository(testDir);

        // Should only include index.js
        expect(result.fileCount).toBe(1);

        await result.cleanup();
      });
    });
  });

  describe('cleanupOldZips', () => {
    it('should remove old ZIP files from temp directory', async () => {
      const tempDir = tmpdir();
      const oldZipName = `supermodel-${randomBytes(8).toString('hex')}.zip`;
      const oldZipPath = join(tempDir, oldZipName);

      // Create an old ZIP file
      await fs.writeFile(oldZipPath, 'fake zip content');

      // Set modification time to 2 days ago
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await fs.utimes(oldZipPath, twoDaysAgo, twoDaysAgo);

      // Run cleanup (default is 24 hours)
      await cleanupOldZips();

      // Verify file was deleted
      await expect(fs.stat(oldZipPath)).rejects.toThrow();
    });

    it('should not remove recent ZIP files', async () => {
      const tempDir = tmpdir();
      const recentZipName = `supermodel-${randomBytes(8).toString('hex')}.zip`;
      const recentZipPath = join(tempDir, recentZipName);

      // Create a recent ZIP file
      await fs.writeFile(recentZipPath, 'fake zip content');

      // Run cleanup
      await cleanupOldZips();

      // Verify file still exists
      const stats = await fs.stat(recentZipPath);
      expect(stats.isFile()).toBe(true);

      // Cleanup
      await fs.unlink(recentZipPath);
    });

    it('should only remove supermodel ZIP files', async () => {
      const tempDir = tmpdir();
      const otherZipName = `other-${randomBytes(8).toString('hex')}.zip`;
      const otherZipPath = join(tempDir, otherZipName);

      // Create a non-supermodel ZIP file
      await fs.writeFile(otherZipPath, 'fake zip content');

      // Set modification time to 2 days ago
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await fs.utimes(otherZipPath, twoDaysAgo, twoDaysAgo);

      // Run cleanup
      await cleanupOldZips();

      // Verify file still exists (not a supermodel ZIP)
      const stats = await fs.stat(otherZipPath);
      expect(stats.isFile()).toBe(true);

      // Cleanup
      await fs.unlink(otherZipPath);
    });
  });
});
