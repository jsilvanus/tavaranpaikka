#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config.js';
import { createDb } from '../db.js';
import { createStorage } from '../storage.js';
import { createMcpServer } from './server.js';

async function runStdioMcp() {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);

  const orgRes = await db.query('SELECT id FROM organizations WHERE slug = $1', [
    config.defaultOrganizationSlug,
  ]);
  const defaultOrgId = orgRes.rows[0]?.id;
  if (!defaultOrgId) {
    throw new Error(`Default organization slug "${config.defaultOrganizationSlug}" not found in database.`);
  }

  const storage = createStorage({
    driver: config.storageDriver,
    localDir: config.localStorageDir,
    s3Endpoint: config.s3Endpoint,
    s3Region: config.s3Region,
    s3Bucket: config.s3Bucket,
    s3AccessKey: config.s3AccessKey,
    s3SecretKey: config.s3SecretKey,
    s3ForcePathStyle: config.s3ForcePathStyle,
  });

  const server = createMcpServer({
    db,
    storage,
    config,
    defaultOrgId,
    defaultLocale: config.defaultLocale,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runStdioMcp().catch((err) => {
  // Use stderr so we do not pollute stdio JSON-RPC transport on stdout
  process.stderr.write(`Tavaranpaikka MCP error: ${err.message}\n`);
  process.exit(1);
});
