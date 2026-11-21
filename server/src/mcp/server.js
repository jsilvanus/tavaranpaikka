import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { issueCode } from '../repositories/codesRepo.js';
import { resolvePublicCode } from '../repositories/codesRepo.js';
import {
  createItem,
  getItemById,
  listItems,
  moveItem,
  updateItem,
} from '../repositories/itemsRepo.js';
import {
  createPlace,
  getPlaceById,
  listPlaces,
} from '../repositories/placesRepo.js';
import {
  createPublicReport,
  listReports,
} from '../repositories/reportsRepo.js';
import {
  createStorage,
  getStorageDetail,
  listStorageSummaries,
  recordInspection,
  updateStorageImage,
} from '../repositories/storagesRepo.js';
import { downloadAndAttachImage } from './downloadImage.js';

/**
 * Format standard tool result object for MCP.
 * @param {unknown} value
 * @returns {{ content: Array<{ type: 'text', text: string }> }}
 */
function jsonResult(value) {
  return {
    content: [
      {
        type: /** @type {const} */ ('text'),
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

/**
 * Format error result for MCP tool call.
 * @param {unknown} error
 * @returns {{ isError: true, content: Array<{ type: 'text', text: string }> }}
 */
function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: /** @type {const} */ ('text'),
        text: `Error: ${message}`,
      },
    ],
  };
}

/**
 * Create a configured MCP Server instance for Tavaranpaikka.
 *
 * @param {{
 *   db: import('../db.js').DbClient,
 *   storage: import('../storage.js').ObjectStorage,
 *   config?: import('../config.js').AppConfig,
 *   defaultOrgId: string,
 *   defaultLocale?: string
 * }} deps
 * @returns {McpServer}
 */
export function createMcpServer({ db, storage, config: _config, defaultOrgId, defaultLocale = 'fi' }) {
  const server = new McpServer(
    {
      name: 'tavaranpaikka',
      version: '0.10.2',
    },
    {
      capabilities: {
        tools: {},
        resources: {
          listChanged: true,
        },
      },
    }
  );

  /**
   * Helper to construct RequestContext for repository calls.
   * @param {string | undefined} orgId
   * @returns {import('../types.js').RequestContext}
   */
  function getCtx(orgId) {
    return {
      organizationId: orgId || defaultOrgId,
      locale: defaultLocale,
    };
  }

  // =========================================================================
  // RESOURCES
  // =========================================================================

  server.resource(
    'storages',
    'tavara://storages',
    {
      description: 'List of all storage rooms, first-aid kits, and cabinets in the organization',
      mimeType: 'application/json',
    },
    async (uri) => {
      const storages = await listStorageSummaries(db, getCtx(defaultOrgId));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(storages, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    'storage-detail',
    new ResourceTemplate('tavara://storages/{storageId}', { list: undefined }),
    {
      description: 'Detailed view of a storage room, including places, photo gallery, and inventory summary',
      mimeType: 'application/json',
    },
    async (uri, { storageId }) => {
      const detail = await getStorageDetail(db, getCtx(defaultOrgId), String(storageId));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(detail, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    'item-detail',
    new ResourceTemplate('tavara://items/{itemId}', { list: undefined }),
    {
      description: 'Detailed view of an inventory item including location, status, photos, and QR code',
      mimeType: 'application/json',
    },
    async (uri, { itemId }) => {
      const item = await getItemById(db, getCtx(defaultOrgId), String(itemId));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(item, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    'code-detail',
    new ResourceTemplate('tavara://codes/{code}', { list: undefined }),
    {
      description: 'Resolved target of a QR / Crockford base32 code',
      mimeType: 'application/json',
    },
    async (uri, { code }) => {
      const resolution = await resolvePublicCode(db, getCtx(defaultOrgId), String(code));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(resolution, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // TOOLS
  // =========================================================================

  // 1. List storages
  server.tool(
    'tavaranpaikka_list_storages',
    'List all storages (rooms, kits, cabinets, vehicles) with item/place summary counts and inspection status.',
    {
      kind: z
        .enum(['room', 'kit', 'cabinet', 'vehicle', 'other', 'first_aid'])
        .optional()
        .describe('Optional filter by storage kind'),
      q: z.string().optional().describe('Optional search query to filter by storage name or description'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const storages = await listStorageSummaries(db, getCtx(args.organizationId), {
          kind: args.kind,
          q: args.q,
        });
        return jsonResult(storages);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 2. Get storage detail
  server.tool(
    'tavaranpaikka_get_storage',
    'Get full storage details including child places, photos, inspection interval, and open reports.',
    {
      storageId: z.string().describe('UUID of the storage'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const storageDetail = await getStorageDetail(db, getCtx(args.organizationId), args.storageId);
        return jsonResult(storageDetail);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 3. Create storage
  server.tool(
    'tavaranpaikka_create_storage',
    'Create a new storage room, kit, or cabinet. Can optionally download and attach a photo from a URL (e.g. from ImageHost MCP).',
    {
      name: z.string().min(1).max(200).describe('Storage name (e.g. "Päävarasto" or "Ensiapulaukku 1")'),
      kind: z
        .enum(['room', 'kit', 'cabinet', 'vehicle', 'other', 'first_aid'])
        .default('room')
        .describe('Kind of storage'),
      description: z.string().max(2000).optional().describe('Description of the storage location'),
      publicListed: z.boolean().default(true).describe('Whether this storage appears in public lists'),
      inspectionIntervalDays: z.number().int().positive().nullable().optional().describe('Periodic inspection interval in days'),
      notifyBeforeDays: z.number().int().min(1).max(365).nullable().optional().describe('Days before inspection to notify'),
      responsiblePersonName: z.string().max(200).optional().describe('Name of the responsible person'),
      responsiblePersonEmail: z.string().email().max(320).optional().describe('Email of the responsible person'),
      photoUrl: z
        .string()
        .url()
        .optional()
        .describe('Optional image URL (e.g. from ImageHost MCP) to download and attach to this storage immediately'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const ctx = getCtx(args.organizationId);
        const created = await createStorage(db, ctx, {
          name: args.name,
          kind: args.kind,
          description: args.description || '',
          publicListed: args.publicListed,
          inspectionIntervalDays: args.inspectionIntervalDays ?? null,
          notifyBeforeDays: args.notifyBeforeDays ?? null,
          responsiblePersonType: args.responsiblePersonName ? 'external' : null,
          responsiblePersonName: args.responsiblePersonName || null,
          responsiblePersonEmail: args.responsiblePersonEmail || null,
        });

        if (args.photoUrl) {
          const imageRecord = await downloadAndAttachImage({
            db,
            storage,
            ctx,
            ownerKind: 'storage',
            ownerId: created.id,
            url: args.photoUrl,
            caption: args.name,
          });

          await updateStorageImage(db, ctx, created.id, {
            imageKey: imageRecord.url.replace(/^\/api\/files\//, ''),
            imageWidth: imageRecord.width,
            imageHeight: imageRecord.height,
          });

          const updated = await getStorageDetail(db, ctx, created.id);
          return jsonResult({ storage: updated, photoAttached: true, image: imageRecord });
        }

        return jsonResult(created);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 4. List places
  server.tool(
    'tavaranpaikka_list_places',
    'List places (shelves, cabinets, sections) optionally filtered by storage ID.',
    {
      storageId: z.string().optional().describe('UUID of the storage to filter by'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const places = await listPlaces(db, getCtx(args.organizationId), {
          storageId: args.storageId,
        });
        return jsonResult(places);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 5. Get place detail
  server.tool(
    'tavaranpaikka_get_place',
    'Get details of a place including its tracked items, place entries, and location breadcrumb path.',
    {
      placeId: z.string().describe('UUID of the place'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const place = await getPlaceById(db, getCtx(args.organizationId), args.placeId);
        return jsonResult(place);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 6. Create place
  server.tool(
    'tavaranpaikka_create_place',
    'Create a new place (shelf, cabinet, bin) within a storage.',
    {
      storageId: z.string().describe('UUID of the storage room containing this place'),
      name: z.string().min(1).max(200).describe('Place name (e.g. "Hylly 3B" or "Laatikko A")'),
      description: z.string().max(2000).optional().describe('Description of the place'),
      parentPlaceId: z.string().optional().nullable().describe('UUID of the parent place if nested'),
      pinX: z.number().optional().nullable().describe('X coordinate percentage on storage image (0-100)'),
      pinY: z.number().optional().nullable().describe('Y coordinate percentage on storage image (0-100)'),
      pinLabel: z.string().optional().describe('Label shown next to map pin'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const created = await createPlace(db, getCtx(args.organizationId), {
          storageId: args.storageId,
          name: args.name,
          description: args.description || '',
          parentPlaceId: args.parentPlaceId ?? null,
          pinX: args.pinX ?? null,
          pinY: args.pinY ?? null,
          pinLabel: args.pinLabel || '',
        });
        return jsonResult(created);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 7. List items
  server.tool(
    'tavaranpaikka_list_items',
    'Search and list items by query keyword, place ID, storage ID, or status.',
    {
      q: z.string().optional().describe('Search query matching item name, description, or category'),
      placeId: z.string().optional().describe('Filter items by place UUID'),
      storageId: z.string().optional().describe('Filter items by storage UUID'),
      status: z.enum(['ok', 'depleted', 'broken', 'retired']).optional().describe('Filter items by status'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const items = await listItems(db, getCtx(args.organizationId), {
          q: args.q,
          placeId: args.placeId,
          storageId: args.storageId,
          status: args.status,
        });
        return jsonResult(items);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 8. Get item detail
  server.tool(
    'tavaranpaikka_get_item',
    'Get full item details with its photos, active QR code, lease status, and expiry.',
    {
      itemId: z.string().describe('UUID of the item'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const item = await getItemById(db, getCtx(args.organizationId), args.itemId);
        return jsonResult(item);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 9. Create item (with ImageHost MCP photo support)
  server.tool(
    'tavaranpaikka_create_item',
    'Create a new tracked inventory item. Supports ImageHost MCP by accepting a photo URL (e.g. presigned download URL); Tavaranpaikka downloads and stores the photo automatically.',
    {
      name: z.string().min(1).max(200).describe('Item name (e.g. "Kuumaliimapistooli" or "Ensiapupakkaus")'),
      placeId: z.string().optional().nullable().describe('UUID of the place where item is kept'),
      description: z.string().max(2000).optional().describe('Description or specifications of the item'),
      category: z.string().max(100).optional().describe('Category classification (e.g. "Työkalut", "Askartelu", "Ensiapu")'),
      status: z.enum(['ok', 'depleted', 'broken', 'retired']).default('ok').describe('Current condition status'),
      expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().describe('Expiration date in YYYY-MM-DD format (for first-aid supplies etc.)'),
      minQuantity: z.number().int().min(0).optional().nullable().describe('Minimum required quantity threshold'),
      leaseable: z.boolean().default(false).describe('Whether this item can be borrowed / leased out'),
      photoUrl: z
        .string()
        .url()
        .optional()
        .describe(
          'Photo URL (e.g. issued by ImageHost MCP via get_image_download_url). Tavaranpaikka will download and attach the photo directly.'
        ),
      photoCaption: z.string().max(200).optional().describe('Optional caption for the attached photo'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const ctx = getCtx(args.organizationId);
        const item = await createItem(db, ctx, {
          name: args.name,
          placeId: args.placeId ?? null,
          description: args.description || '',
          category: args.category || '',
          status: args.status,
          expiresOn: args.expiresOn ?? null,
          minQuantity: args.minQuantity ?? null,
          leaseable: args.leaseable,
        });

        if (args.photoUrl) {
          const imageRecord = await downloadAndAttachImage({
            db,
            storage,
            ctx,
            ownerKind: 'item',
            ownerId: item.id,
            url: args.photoUrl,
            caption: args.photoCaption || args.name,
          });

          const reloadedItem = await getItemById(db, ctx, item.id);
          return jsonResult({ item: reloadedItem, photoAttached: true, image: imageRecord });
        }

        return jsonResult(item);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 10. Update item
  server.tool(
    'tavaranpaikka_update_item',
    'Update existing item details, condition status, expiration date, or category.',
    {
      itemId: z.string().describe('UUID of the item to update'),
      name: z.string().min(1).max(200).optional().describe('Updated name'),
      placeId: z.string().nullable().optional().describe('Updated place UUID'),
      description: z.string().max(2000).optional().describe('Updated description'),
      category: z.string().max(100).optional().describe('Updated category'),
      status: z.enum(['ok', 'depleted', 'broken', 'retired']).optional().describe('Updated status'),
      expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe('Updated expiration date (YYYY-MM-DD)'),
      minQuantity: z.number().int().min(0).nullable().optional().describe('Updated minimum quantity threshold'),
      leaseable: z.boolean().optional().describe('Updated leaseable flag'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const { itemId, organizationId, ...data } = args;
        const updated = await updateItem(db, getCtx(organizationId), itemId, data);
        return jsonResult(updated);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 11. Move item
  server.tool(
    'tavaranpaikka_move_item',
    'Move an item to a different place or storage location.',
    {
      itemId: z.string().describe('UUID of the item to move'),
      placeId: z.string().nullable().describe('UUID of destination place, or null to unassign'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const moved = await moveItem(db, getCtx(args.organizationId), args.itemId, args.placeId);
        return jsonResult(moved);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 12. Add photo to item from URL (ImageHost MCP support)
  server.tool(
    'tavaranpaikka_add_item_photo',
    'Download and attach a photo to an item using a photo URL (e.g. 1-hour presigned URL from ImageHost MCP get_image_download_url). Tavaranpaikka fetches the image directly, optimizes it into WebP, and stores it.',
    {
      itemId: z.string().describe('UUID of the item to attach the photo to'),
      photoUrl: z
        .string()
        .url()
        .describe(
          'HTTP/HTTPS URL of the photo (e.g. from ImageHost MCP get_image_download_url). Tavaranpaikka downloads the image itself.'
        ),
      caption: z.string().max(200).optional().describe('Optional caption for this photo'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const ctx = getCtx(args.organizationId);
        // Ensure item exists
        await getItemById(db, ctx, args.itemId);

        const imageRecord = await downloadAndAttachImage({
          db,
          storage,
          ctx,
          ownerKind: 'item',
          ownerId: args.itemId,
          url: args.photoUrl,
          caption: args.caption || '',
        });

        const reloadedItem = await getItemById(db, ctx, args.itemId);
        return jsonResult({
          success: true,
          image: imageRecord,
          item: reloadedItem,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 13. Add photo to storage from URL (ImageHost MCP support)
  server.tool(
    'tavaranpaikka_add_storage_photo',
    'Download and attach a photo or floorplan map to a storage room/kit using an image URL.',
    {
      storageId: z.string().describe('UUID of the storage'),
      photoUrl: z
        .string()
        .url()
        .describe('HTTP/HTTPS URL of the photo to download and attach to the storage'),
      caption: z.string().max(200).optional().describe('Optional caption for the photo'),
      setAsPrimaryMap: z.boolean().default(false).describe('Set this image as the primary map for placing pins'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const ctx = getCtx(args.organizationId);
        const detail = await getStorageDetail(db, ctx, args.storageId);

        const imageRecord = await downloadAndAttachImage({
          db,
          storage,
          ctx,
          ownerKind: 'storage',
          ownerId: args.storageId,
          url: args.photoUrl,
          caption: args.caption || '',
        });

        if (args.setAsPrimaryMap || !detail.hasImage) {
          await updateStorageImage(db, ctx, args.storageId, {
            imageKey: imageRecord.url.replace(/^\/api\/files\//, ''),
            imageWidth: imageRecord.width,
            imageHeight: imageRecord.height,
          });
        }

        const updatedDetail = await getStorageDetail(db, ctx, args.storageId);
        return jsonResult({
          success: true,
          image: imageRecord,
          storage: updatedDetail,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 14. Resolve code (scan QR)
  server.tool(
    'tavaranpaikka_resolve_code',
    'Look up and resolve a QR / Crockford base32 code to its target item, place, or storage.',
    {
      code: z.string().describe('The code text printed on sticker or scanned (e.g. "4K7N9M2P")'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const resolution = await resolvePublicCode(db, getCtx(args.organizationId), args.code);
        return jsonResult(resolution);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 15. Issue code
  server.tool(
    'tavaranpaikka_issue_code',
    'Issue a new unique Crockford base32 code with check character for an item, place, or storage.',
    {
      kind: z.enum(['item', 'place', 'storage']).describe('Target entity kind'),
      targetId: z.string().describe('UUID of the item, place, or storage'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const codeRecord = await issueCode(db, getCtx(args.organizationId), args.kind, args.targetId);
        return jsonResult(codeRecord);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 16. Record inspection
  server.tool(
    'tavaranpaikka_record_inspection',
    'Record an inspection for a first-aid kit or storage room, resetting its inspection due date.',
    {
      storageId: z.string().describe('UUID of the storage'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const updated = await recordInspection(db, getCtx(args.organizationId), args.storageId, 'mcp-agent');
        return jsonResult(updated);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 17. List reports
  server.tool(
    'tavaranpaikka_list_reports',
    'List issue reports (depleted supplies, broken tools, expired first-aid items).',
    {
      status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']).optional().describe('Filter by report status'),
      storageId: z.string().optional().describe('Filter by storage UUID'),
      kind: z.enum(['depleted', 'broken', 'expired', 'other']).optional().describe('Filter by report kind'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const reports = await listReports(db, getCtx(args.organizationId), {
          status: args.status,
          storageId: args.storageId,
          kind: args.kind,
        });
        return jsonResult(reports);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 18. Create report
  server.tool(
    'tavaranpaikka_create_report',
    'Submit an issue report about a depleted, broken, or expired item in a place.',
    {
      placeId: z.string().describe('UUID of the place where issue is located'),
      kind: z.enum(['depleted', 'broken', 'expired', 'other']).describe('Type of problem'),
      itemId: z.string().optional().nullable().describe('UUID of affected item if specific'),
      note: z.string().max(500).optional().describe('Detailed description of the issue'),
      reporterName: z.string().max(120).optional().describe('Name of the person reporting'),
      organizationId: z.string().optional().describe('Optional organization ID override'),
    },
    async (args) => {
      try {
        const ctx = getCtx(args.organizationId);
        const report = await createPublicReport(
          db,
          ctx,
          args.placeId,
          {
            kind: args.kind,
            itemId: args.itemId ?? null,
            note: args.note || '',
            name: args.reporterName || 'MCP Agent',
          },
          'mcp-agent-hash',
          null
        );
        return jsonResult(report);
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  return server;
}
