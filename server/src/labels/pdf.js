import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { getCellRect, getLayoutSpec } from './layouts.js';

/**
 * @typedef {import('../types.js').LabelTarget} LabelTarget
 * @typedef {import('../types.js').LabelRequest} LabelRequest
 * @typedef {import('../types.js').LabelTargetRef} LabelTargetRef
 * @typedef {import('../types.js').LabelSize} LabelSize
 */

/**
 * @typedef {Object} ExpandedLabelCell
 * @property {number} page
 * @property {number} cellIndexOnPage
 * @property {number} col
 * @property {number} row
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {LabelTarget} target
 * @property {{ qr: boolean, code: boolean, name: boolean, place: boolean, note: boolean }} show
 * @property {string} placeText
 * @property {string} noteText
 */

const SIZE_SCALES = {
  small: 0.85,
  normal: 1.0,
  large: 1.2,
};

/**
 * Pure helper that expands label targets and request options into positioned
 * cells across A4 pages.
 * @param {LabelTarget[]} targets
 * @param {LabelRequest} request
 * @returns {ExpandedLabelCell[]}
 */
export function expandLabelCells(targets, request) {
  const spec = getLayoutSpec(request.layout);
  const startPosition = request.startPosition ?? 1;
  if (!Number.isInteger(startPosition) || startPosition < 1 || startPosition > spec.perPage) {
    throw new Error(`startPosition must be an integer between 1 and ${spec.perPage}`);
  }

  const copies = request.copies ?? 1;
  if (!Number.isInteger(copies) || copies < 1) {
    throw new Error('copies must be a positive integer');
  }

  const baseShow = {
    qr: request.show?.qr !== false,
    code: request.show?.code !== false,
    name: request.show?.name !== false,
    place: request.show?.place !== false,
    note: Boolean(request.show?.note),
  };

  /** @type {Map<string, LabelTargetRef>} */
  const refMap = new Map();
  if (Array.isArray(request.targets)) {
    for (const ref of request.targets) {
      refMap.set(`${ref.kind}:${ref.id}`, ref);
    }
  }

  /** @type {ExpandedLabelCell[]} */
  const cells = [];
  let slotIndex = startPosition - 1;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const indexedRef = request.targets?.[i];
    const targetRef =
      indexedRef && indexedRef.kind === target.kind && indexedRef.id === target.id
        ? indexedRef
        : refMap.get(`${target.kind}:${target.id}`);

    const effectiveShow = {
      qr: baseShow.qr,
      code: baseShow.code,
      name: targetRef?.show?.name ?? baseShow.name,
      place: targetRef?.show?.place ?? baseShow.place,
      note: baseShow.note,
    };

    let placeText = '';
    if (target.kind === 'item') {
      placeText =
        target.placePath && target.placePath.length > 0
          ? target.placePath.join(' > ')
          : target.storageName || '';
    } else if (target.kind === 'place') {
      placeText = target.storageName || '';
    }

    let noteText = '';
    if (effectiveShow.note) {
      const customNote = request.note?.trim();
      if (customNote) {
        noteText = customNote;
      } else if (target.expiresOn) {
        noteText = `Vanhenee: ${target.expiresOn}`;
      }
    }

    for (let copy = 0; copy < copies; copy++) {
      const page = Math.floor(slotIndex / spec.perPage);
      const cellIndexOnPage = slotIndex % spec.perPage;
      const rect = getCellRect(spec, cellIndexOnPage);

      cells.push({
        page,
        cellIndexOnPage,
        ...rect,
        target,
        show: effectiveShow,
        placeText,
        noteText,
      });
      slotIndex++;
    }
  }

  return cells;
}

/**
 * Draw a crisp vector QR code directly onto a PDFKit document.
 * @param {PDFKit.PDFDocument} doc
 * @param {string} url
 * @param {number} x
 * @param {number} y
 * @param {number} size
 */
function drawQrVector(doc, url, x, y, size) {
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const count = qr.modules.size;
  const modSize = size / count;

  doc.save();
  doc.fillColor('#000000');
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.modules.get(r, c)) {
        doc.rect(x + c * modSize, y + r * modSize, modSize, modSize).fill();
      }
    }
  }
  doc.restore();
}

/**
 * Render a single label cell onto the current PDFKit page.
 * @param {PDFKit.PDFDocument} doc
 * @param {ExpandedLabelCell} cell
 * @param {import('./layouts.js').LayoutSpec} spec
 * @param {LabelSize} size
 * @param {string} baseUrl
 */
function renderCell(doc, cell, spec, size, baseUrl) {
  const scale = SIZE_SCALES[size] ?? 1.0;
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const hasQr = cell.show.qr && Boolean(cell.target.code);

  if (spec.id === 'a4-1x1') {
    const pad = 24;
    const centerX = cell.x + cell.width / 2;
    let cursorY = cell.y + pad;
    const contentWidth = cell.width - 2 * pad;

    if (hasQr && cell.target.code) {
      const qrSize = Math.min(280, cell.width * 0.55);
      drawQrVector(doc, `${cleanBaseUrl}/c/${cell.target.code}`, centerX - qrSize / 2, cursorY, qrSize);
      cursorY += qrSize + 24;
    }

    if (cell.show.code && cell.target.code) {
      const fontSize = Math.round(22 * scale);
      doc.font('Courier-Bold').fontSize(fontSize).fillColor('#000000');
      doc.text(cell.target.code, cell.x + pad, cursorY, {
        width: contentWidth,
        align: 'center',
        lineBreak: false,
        ellipsis: true,
      });
      cursorY += fontSize + 18;
    }

    if (cell.show.name && cell.target.name) {
      const fontSize = Math.round(28 * scale);
      doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#000000');
      doc.text(cell.target.name, cell.x + pad, cursorY, {
        width: contentWidth,
        align: 'center',
        height: 120,
        ellipsis: true,
      });
      cursorY += doc.heightOfString(cell.target.name, { width: contentWidth }) + 14;
    }

    if (cell.show.place && cell.placeText) {
      const fontSize = Math.round(16 * scale);
      doc.font('Helvetica').fontSize(fontSize).fillColor('#333333');
      doc.text(cell.placeText, cell.x + pad, cursorY, {
        width: contentWidth,
        align: 'center',
        height: 60,
        ellipsis: true,
      });
      cursorY += doc.heightOfString(cell.placeText, { width: contentWidth }) + 10;
    }

    if (cell.show.note && cell.noteText) {
      const fontSize = Math.round(14 * scale);
      doc.font('Helvetica-Oblique').fontSize(fontSize).fillColor('#555555');
      doc.text(cell.noteText, cell.x + pad, cursorY, {
        width: contentWidth,
        align: 'center',
        height: 60,
        ellipsis: true,
      });
    }
    return;
  }

  const isCompact = spec.id === 'a4-5x13';
  const pad = isCompact ? 4 : 6;
  const qrSize = hasQr
    ? Math.min(cell.height - 2 * pad, cell.width * (isCompact ? 0.44 : 0.4))
    : 0;

  if (hasQr && cell.target.code) {
    const qrY = cell.y + (cell.height - qrSize) / 2;
    drawQrVector(doc, `${cleanBaseUrl}/c/${cell.target.code}`, cell.x + pad, qrY, qrSize);
  }

  const textX = hasQr ? cell.x + pad + qrSize + pad : cell.x + pad;
  const textWidth = Math.max(10, cell.x + cell.width - pad - textX);
  const maxY = cell.y + cell.height - pad;
  let cursorY = cell.y + pad;

  const baseNameSize = isCompact ? 7.5 : spec.id === 'a4-2x7' ? 11.5 : 9.5;
  const baseSubSize = isCompact ? 6.0 : spec.id === 'a4-2x7' ? 8.5 : 7.5;
  const baseCodeSize = isCompact ? 6.5 : spec.id === 'a4-2x7' ? 9.5 : 8.0;

  if (cell.show.name && cell.target.name && cursorY < maxY) {
    const fontSize = baseNameSize * scale;
    doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#000000');
    const lineHeight = fontSize * 1.15;
    const maxLinesHeight = Math.min(lineHeight * 2, maxY - cursorY);
    doc.text(cell.target.name, textX, cursorY, {
      width: textWidth,
      height: maxLinesHeight,
      ellipsis: true,
    });
    const used = Math.min(
      maxLinesHeight,
      doc.heightOfString(cell.target.name, { width: textWidth }),
    );
    cursorY += used + (isCompact ? 1.5 : 3);
  }

  if (cell.show.place && cell.placeText && cursorY < maxY - 6) {
    const fontSize = baseSubSize * scale;
    doc.font('Helvetica').fontSize(fontSize).fillColor('#333333');
    doc.text(cell.placeText, textX, cursorY, {
      width: textWidth,
      lineBreak: false,
      ellipsis: true,
    });
    cursorY += fontSize * 1.2 + (isCompact ? 1 : 2);
  }

  if (cell.show.note && cell.noteText && cursorY < maxY - 6) {
    const fontSize = baseSubSize * scale;
    doc.font('Helvetica-Oblique').fontSize(fontSize).fillColor('#444444');
    doc.text(cell.noteText, textX, cursorY, {
      width: textWidth,
      lineBreak: false,
      ellipsis: true,
    });
    cursorY += fontSize * 1.2 + (isCompact ? 1 : 2);
  }

  if (cell.show.code && cell.target.code && cursorY < maxY - 5) {
    const fontSize = baseCodeSize * scale;
    doc.font('Courier-Bold').fontSize(fontSize).fillColor('#000000');
    const codeY = Math.max(cursorY, maxY - fontSize * 1.1);
    doc.text(cell.target.code, textX, codeY, {
      width: textWidth,
      lineBreak: false,
      ellipsis: true,
    });
  }
}

/**
 * Generate an A4 PDF label sheet for the given targets and request options.
 * @param {LabelTarget[]} targets
 * @param {LabelRequest} request
 * @param {string} baseUrl
 * @returns {Promise<Buffer>}
 */
export async function generateLabelsPdf(targets, request, baseUrl) {
  const spec = getLayoutSpec(request.layout);
  const size = request.size ?? 'normal';
  const cells = expandLabelCells(targets, request);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
    /** @type {Buffer[]} */
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (cells.length === 0) {
      doc.addPage();
      doc.end();
      return;
    }

    let currentPage = -1;
    for (const cell of cells) {
      while (currentPage < cell.page) {
        doc.addPage();
        currentPage++;
      }
      renderCell(doc, cell, spec, size, baseUrl);
    }

    doc.end();
  });
}
