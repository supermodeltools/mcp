#!/usr/bin/env node
import { Server } from './server';
import * as logger from './utils/logger';

async function main() {
  // Parse command-line arguments to get optional default workdir
  // Usage: node dist/index.js [workdir]
  const args = process.argv.slice(2);
  const defaultWorkdir = args.length > 0 ? args[0] : undefined;

  if (defaultWorkdir) {
    logger.debug('Default workdir:', defaultWorkdir);
  }

  const server = new Server(defaultWorkdir);
  await server.start();
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});

