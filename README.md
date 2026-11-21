# tavaranpaikka
## Access

| Who | Can |
| --- | --- |
| Anonymous | Only the QR code views (/c/:code): scan, report, vote, lease/return |
| member (generic signed-in user) | + browse storages and their contents (read-only); no management, no label printing |
| keeper | + manage storages/places/items, print labels, handle reports |
| dmin | + privacy settings, leases overview, cleanup |

## Label printing

The print view has sliders for QR code size and text size, and a logo selector: inside the QR code,
as a separate logo left of the QR code, or as a separate logo right of the text.
The same options (`qrScale`, `fontScale`, `logoPlacement`) are accepted by `POST /api/labels/pdf`.

## OpenAPI Specification & Documentation

The API contract is defined in OpenAPI 3.1:
- Specification document: [`docs/openapi.yaml`](docs/openapi.yaml) and `server/src/openapi.json`
- Served dynamically by the API:
  - `GET /api/openapi.json` (OpenAPI 3.1 JSON)
  - `GET /api/openapi.yaml` (OpenAPI 3.1 YAML)
  - `GET /api/docs` (Interactive documentation via Scalar)
- Rebuilding the specification: `npm run openapi:build`

## Model Context Protocol (MCP)

Tavaranpaikka includes a Model Context Protocol (MCP) server enabling AI agents to search inventory, manage storages/places/items, scan and issue QR codes, and record inspections.

### Transports

1. **Streamable HTTP** (recommended for remote AI agents and connectors):
   - Endpoint: `POST /mcp` (or `POST /api/mcp`)
   - Healthcheck: `HEAD /mcp`
2. **Stdio Transport** (for local agents, Claude Desktop, Cursor, and Antigravity):
   - Run: `npm run mcp` (or `node server/src/mcp/cli.js`)

### ImageHost MCP Support

Tavaranpaikka seamlessly integrates with **ImageHost MCP** (and any HTTP/HTTPS photo source). AI agents can obtain a presigned download URL from ImageHost MCP (via `get_image_download_url`) and pass it directly to Tavaranpaikka tools:
- `tavaranpaikka_create_item`: Accepts `photoUrl` to download and attach an initial photo.
- `tavaranpaikka_add_item_photo`: Takes `itemId` and `photoUrl` to download and attach gallery photos.
- `tavaranpaikka_create_storage`: Accepts `photoUrl` to set the storage photo/map.
- `tavaranpaikka_add_storage_photo`: Takes `storageId` and `photoUrl`.

Tavaranpaikka downloads the image directly, strips EXIF data, normalizes orientation, optimizes it into WebP with Sharp, stores it in object storage, and links it to the item or storage.

### MCP Resources

- `tavara://storages`: Overview of all storages in the tenant.
- `tavara://storages/{storage_id}`: Detailed storage layout, photos, and places.
- `tavara://items/{item_id}`: Item details, photos, and active QR code.
- `tavara://codes/{code}`: Resolved target for a QR code.

