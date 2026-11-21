import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createStorage as createObjectStorage } from '../src/storage.js';
import { createMcpServer } from '../src/mcp/server.js';

describe('Tavaranpaikka MCP Server and ImageHost Integration', () => {
  let db;
  let app;
  let storage;
  let tmpDir;
  let organizationId;
  let samplePngBuffer;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tavaranpaikka-mcp-test-'));
    db = createDb('pg-mem');
    const migrated = await runMigrations(db);
    organizationId = migrated.organizationId;

    const config = loadConfig({
      NODE_ENV: 'test',
      AUTH_MODE: 'dev',
      LOCAL_STORAGE_DIR: tmpDir,
    });
    storage = createObjectStorage({ driver: 'local', localDir: tmpDir });
    app = createApp({ db, config, storage });

    // Generate a valid 20x20 red PNG image in memory for mock photo URL downloads
    samplePngBuffer = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('registers all MCP tools and resources', async () => {
    const server = createMcpServer({
      db,
      storage,
      defaultOrgId: organizationId,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: 'test-agent', version: '1.0' });
    await client.connect(clientTransport);

    const toolList = await client.listTools();
    const toolNames = toolList.tools.map((t) => t.name);

    expect(toolNames).toContain('tavaranpaikka_list_storages');
    expect(toolNames).toContain('tavaranpaikka_get_storage');
    expect(toolNames).toContain('tavaranpaikka_create_storage');
    expect(toolNames).toContain('tavaranpaikka_list_places');
    expect(toolNames).toContain('tavaranpaikka_get_place');
    expect(toolNames).toContain('tavaranpaikka_create_place');
    expect(toolNames).toContain('tavaranpaikka_list_items');
    expect(toolNames).toContain('tavaranpaikka_get_item');
    expect(toolNames).toContain('tavaranpaikka_create_item');
    expect(toolNames).toContain('tavaranpaikka_update_item');
    expect(toolNames).toContain('tavaranpaikka_move_item');
    expect(toolNames).toContain('tavaranpaikka_add_item_photo');
    expect(toolNames).toContain('tavaranpaikka_add_storage_photo');
    expect(toolNames).toContain('tavaranpaikka_resolve_code');
    expect(toolNames).toContain('tavaranpaikka_issue_code');
    expect(toolNames).toContain('tavaranpaikka_record_inspection');
    expect(toolNames).toContain('tavaranpaikka_list_reports');
    expect(toolNames).toContain('tavaranpaikka_create_report');

    const resourceList = await client.listResources();
    const resourceUris = resourceList.resources.map((r) => r.uri);
    expect(resourceUris).toContain('tavara://storages');

    await client.close();
    await server.close();
  });

  it('supports creating storages, places, items, and issuing/resolving QR codes via MCP tools', async () => {
    const server = createMcpServer({
      db,
      storage,
      defaultOrgId: organizationId,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-agent', version: '1.0' });
    await client.connect(clientTransport);

    // 1. Create storage
    const storageRes = await client.callTool({
      name: 'tavaranpaikka_create_storage',
      arguments: {
        name: 'Päävarasto A1',
        kind: 'room',
        description: 'Päärakennuksen varastotila',
      },
    });
    // @ts-ignore
    const storageData = JSON.parse(storageRes.content[0].text);
    expect(storageData.id).toBeDefined();
    expect(storageData.name).toBe('Päävarasto A1');

    // 2. Create place
    const placeRes = await client.callTool({
      name: 'tavaranpaikka_create_place',
      arguments: {
        storageId: storageData.id,
        name: 'Hylly 1',
        description: 'Ensimmäinen metallihylly',
      },
    });
    // @ts-ignore
    const placeData = JSON.parse(placeRes.content[0].text);
    expect(placeData.id).toBeDefined();
    expect(placeData.name).toBe('Hylly 1');

    // 3. Create item
    const itemRes = await client.callTool({
      name: 'tavaranpaikka_create_item',
      arguments: {
        name: 'Akkuporakone Makita',
        placeId: placeData.id,
        category: 'Työkalut',
        status: 'ok',
        leaseable: true,
      },
    });
    // @ts-ignore
    const itemData = JSON.parse(itemRes.content[0].text);
    expect(itemData.id).toBeDefined();
    expect(itemData.name).toBe('Akkuporakone Makita');
    expect(itemData.leaseable).toBe(true);

    // 4. Issue QR code
    const codeRes = await client.callTool({
      name: 'tavaranpaikka_issue_code',
      arguments: {
        kind: 'item',
        targetId: itemData.id,
      },
    });
    // @ts-ignore
    const codeData = JSON.parse(codeRes.content[0].text);
    expect(codeData.code).toBeDefined();

    // 5. Resolve QR code
    const resolveRes = await client.callTool({
      name: 'tavaranpaikka_resolve_code',
      arguments: {
        code: codeData.code,
      },
    });
    // @ts-ignore
    const resolvedData = JSON.parse(resolveRes.content[0].text);
    expect(resolvedData.kind).toBe('item');
    expect(resolvedData.item.id).toBe(itemData.id);

    // 6. Read resource
    const itemResource = await client.readResource({
      uri: `tavara://items/${itemData.id}`,
    });
    // @ts-ignore
    const resourceItem = JSON.parse(itemResource.contents[0].text);
    expect(resourceItem.id).toBe(itemData.id);
    expect(resourceItem.code).toBe(codeData.code);

    await client.close();
    await server.close();
  });

  it('supports ImageHost MCP by downloading photo from URL and attaching to item', async () => {
    const server = createMcpServer({
      db,
      storage,
      defaultOrgId: organizationId,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-agent', version: '1.0' });
    await client.connect(clientTransport);

    // Mock global fetch to return our sample image
    const mockPhotoUrl = 'https://kehitys.riihimaenseurakunta.fi/kuvarasto/v1/download/presigned-token-123';
    vi.stubGlobal('fetch', async (url) => {
      if (String(url) === mockPhotoUrl) {
        return new Response(samplePngBuffer, {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'content-length': String(samplePngBuffer.byteLength),
          },
        });
      }
      throw new Error(`Unexpected fetch call to ${url}`);
    });

    // Create item directly with photoUrl
    const createRes = await client.callTool({
      name: 'tavaranpaikka_create_item',
      arguments: {
        name: 'Kuvauskamera Sony',
        category: 'AV-laitteet',
        photoUrl: mockPhotoUrl,
        photoCaption: 'Sony a6400 kamerarunko',
      },
    });

    // @ts-ignore
    const createData = JSON.parse(createRes.content[0].text);
    expect(createData.photoAttached).toBe(true);
    expect(createData.item.images).toHaveLength(1);
    expect(createData.item.images[0].caption).toBe('Sony a6400 kamerarunko');
    expect(createData.item.images[0].url).toMatch(/^\/api\/files\/items\//);

    // Now test tavaranpaikka_add_item_photo on an existing item
    const addPhotoRes = await client.callTool({
      name: 'tavaranpaikka_add_item_photo',
      arguments: {
        itemId: createData.item.id,
        photoUrl: mockPhotoUrl,
        caption: 'Toinen kuva lisälaitteista',
      },
    });

    // @ts-ignore
    const addPhotoData = JSON.parse(addPhotoRes.content[0].text);
    expect(addPhotoData.success).toBe(true);
    expect(addPhotoData.item.images).toHaveLength(2);

    await client.close();
    await server.close();
  });

  it('exposes Streamable HTTP endpoint at /mcp and /api/mcp', async () => {
    // HEAD /mcp
    const headRes = await request(app).head('/mcp');
    expect(headRes.status).toBe(200);

    // GET /mcp -> 405 Method Not Allowed
    const getRes = await request(app).get('/mcp');
    expect(getRes.status).toBe(405);
    expect(getRes.body.error.code).toBe(-32000);

    // POST /mcp with JSON-RPC initialize
    const postRes = await request(app)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-agent', version: '1.0' },
        },
        id: 1,
      });

    expect(postRes.status).toBe(200);
    expect(postRes.headers['content-type']).toMatch(/text\/event-stream/);
    expect(postRes.text).toContain('"name":"tavaranpaikka"');
    expect(postRes.text).toContain('"jsonrpc":"2.0"');

    // Same via /api/mcp
    const apiHeadRes = await request(app).head('/api/mcp');
    expect(apiHeadRes.status).toBe(200);
  });
});
