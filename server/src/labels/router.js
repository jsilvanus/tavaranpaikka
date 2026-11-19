import { Router } from 'express';
import { z } from 'zod';
import { isValidCode, normalizeCode } from './codes.js';
import { getLayoutSpec } from './layouts.js';
import { generateLabelsPdf } from './pdf.js';
import { generateQrSvg } from './qr.js';

/**
 * @typedef {import('../types.js').RequestContext} RequestContext
 * @typedef {import('../types.js').LabelTarget} LabelTarget
 * @typedef {import('../types.js').LabelTargetRef} LabelTargetRef
 * @typedef {import('../types.js').LabelRequest} LabelRequest
 */

const labelTargetRefSchema = z.object({
  kind: z.enum(['item', 'place', 'storage']),
  id: z.string().min(1),
  show: z
    .object({
      name: z.boolean().optional(),
      place: z.boolean().optional(),
    })
    .optional(),
});

const labelRequestSchema = z.object({
  targets: z.array(labelTargetRefSchema).min(1),
  layout: z.enum(['a4-3x8', 'a4-5x13', 'a4-2x7', 'a4-1x1']),
  startPosition: z.number().int().min(1).optional(),
  copies: z.number().int().min(1).max(200).optional(),
  size: z.enum(['small', 'normal', 'large']).optional(),
  show: z.object({
    qr: z.boolean().optional(),
    code: z.boolean().optional(),
    name: z.boolean().optional(),
    place: z.boolean().optional(),
    note: z.boolean().optional(),
    logo: z.boolean().optional(),
  }),
  note: z.string().max(200).optional(),
});

/**
 * Extract RequestContext from an Express request.
 * @param {import('express').Request} req
 * @returns {RequestContext}
 */
function getCtx(req) {
  return /** @type {any} */ (req).ctx;
}

/**
 * Resolve base URL from callback or incoming request headers.
 * @param {((req: import('express').Request) => string) | undefined} getBaseUrl
 * @param {import('express').Request} req
 * @returns {string}
 */
function resolveBaseUrl(getBaseUrl, req) {
  if (getBaseUrl) {
    return getBaseUrl(req).replace(/\/+$/, '');
  }
  const host = req.get('host') || 'localhost';
  return `${req.protocol}://${host}`.replace(/\/+$/, '');
}

/**
 * @typedef {Object} LabelRouterDeps
 * @property {(ctx: RequestContext, query: Record<string, any>) => Promise<LabelTarget[]>} getTargets
 * @property {(ctx: RequestContext, refs: LabelTargetRef[]) => Promise<LabelTarget[]>} resolveTargets
 * @property {(ctx: RequestContext, targets: LabelTarget[]) => Promise<void>} [markPrinted]
 * @property {(req: import('express').Request) => string} [getBaseUrl]
 * @property {(ctx: RequestContext, target: LabelTarget) => Promise<Buffer | null>} [resolveLogoBuffer]
 * @property {(ctx: RequestContext, code: string) => Promise<Buffer | null>} [resolveCodeLogoBuffer]
 */

/**
 * Create an Express router for label targets, PDF generation, and QR SVGs.
 * @param {LabelRouterDeps} deps
 * @returns {import('express').Router}
 */
export function createLabelRouter({
  getTargets,
  resolveTargets,
  markPrinted,
  getBaseUrl,
  resolveLogoBuffer,
  resolveCodeLogoBuffer,
}) {
  const router = Router();

  router.get('/targets', async (req, res, next) => {
    try {
      const targets = await getTargets(getCtx(req), req.query);
      res.json(targets);
    } catch (err) {
      next(err);
    }
  });

  router.post('/pdf', async (req, res, next) => {
    try {
      const parsedResult = labelRequestSchema.safeParse(req.body);
      if (!parsedResult.success) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsedResult.error.issues.map((i) => i.message).join('; '),
          },
        });
        return;
      }

      /** @type {LabelRequest} */
      const parsed = /** @type {LabelRequest} */ (/** @type {unknown} */ (parsedResult.data));
      const spec = getLayoutSpec(parsed.layout);
      if (parsed.startPosition !== undefined && parsed.startPosition > spec.perPage) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: `startPosition must be between 1 and ${spec.perPage} for layout ${parsed.layout}`,
          },
        });
        return;
      }

      const ctx = getCtx(req);
      const resolvedTargets = await resolveTargets(ctx, parsed.targets);
      if (!resolvedTargets || resolvedTargets.length === 0) {
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'No matching label targets found',
          },
        });
        return;
      }

      const baseUrl = resolveBaseUrl(getBaseUrl, req);
      const pdfBuffer = await generateLabelsPdf(resolvedTargets, parsed, baseUrl, {
        resolveLogoBuffer: resolveLogoBuffer
          ? (target) => resolveLogoBuffer(ctx, target)
          : undefined,
      });

      if (markPrinted) {
        await markPrinted(ctx, resolvedTargets);
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="labels.pdf"');
      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  });

  router.get('/qr/:code.svg', async (req, res, next) => {
    try {
      const rawCode = req.params.code;
      if (!isValidCode(rawCode)) {
        res.status(400).json({
          error: {
            code: 'INVALID_CODE',
            message: 'Invalid code format or check character',
          },
        });
        return;
      }

      const normalized = normalizeCode(rawCode);
      const baseUrl = resolveBaseUrl(getBaseUrl, req);
      const showLogo = req.query.logo !== '0' && req.query.logo !== 'false';
      const ctx = getCtx(req);
      const logoBuffer =
        showLogo && resolveCodeLogoBuffer ? await resolveCodeLogoBuffer(ctx, normalized) : null;

      const svg = await generateQrSvg(`${baseUrl}/c/${normalized}`, {
        showLogo,
        logoBuffer,
      });

      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.send(svg);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
