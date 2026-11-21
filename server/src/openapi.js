import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENAPI_JSON_PATH = path.resolve(__dirname, 'openapi.json');
const OPENAPI_YAML_PATH = path.resolve(__dirname, '../../docs/openapi.yaml');

/** @type {Record<string, any>} */
export const openapiSpec = JSON.parse(fs.readFileSync(OPENAPI_JSON_PATH, 'utf8'));

/**
 * Generate a standalone HTML document rendering the API specification with Scalar.
 * @param {string} specUrl
 * @returns {string}
 */
export function renderApiDocsHtml(specUrl = './openapi.json') {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tavaranpaikka API Reference</title>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📦</text></svg>" />
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      type="application/json"
      data-url="${specUrl}"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
}

/**
 * Create OpenAPI documentation router.
 * Mounted under /api.
 * @returns {import('express').Router}
 */
export function createOpenApiRouter() {
  const router = express.Router();
  let cachedYaml = '';

  router.get('/openapi.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json(openapiSpec);
  });

  router.get('/openapi.yaml', (_req, res) => {
    try {
      if (!cachedYaml && fs.existsSync(OPENAPI_YAML_PATH)) {
        cachedYaml = fs.readFileSync(OPENAPI_YAML_PATH, 'utf8');
      }
      res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
      res.send(cachedYaml);
    } catch {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'YAML specification not found' } });
    }
  });

  router.get('/docs', (req, res) => {
    const specUrl = `${req.baseUrl || '/api'}/openapi.json`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderApiDocsHtml(specUrl));
  });

  return router;
}
