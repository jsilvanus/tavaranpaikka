import PDFDocument from 'pdfkit';
import { A4_HEIGHT_PT, A4_WIDTH_PT } from './layouts.js';

/**
 * @typedef {import('../types.js').StorageDetail} StorageDetail
 * @typedef {import('../types.js').StorageKind} StorageKind
 * @typedef {import('../types.js').ItemStatus} ItemStatus
 * @typedef {import('../types.js').EntryStatus} EntryStatus
 */

/** @type {Record<StorageKind, string>} */
const KIND_LABELS_FI = {
  room: 'Varasto',
  first_aid: 'Ensiapupakkaus',
  cabinet: 'Kaappi',
  vehicle: 'Ajoneuvo',
  other: 'Muu säilytyspaikka',
};

/** @type {Record<ItemStatus | EntryStatus, string>} */
const STATUS_LABELS_FI = {
  ok: 'OK',
  depleted: 'Loppu',
  broken: 'Rikki',
  retired: 'Poistettu',
};

/**
 * Format an ISO timestamp or date string into `YYYY-MM-DD`.
 * @param {string | null | undefined} value
 * @returns {string}
 */
function formatDate(value) {
  if (!value) {
    return 'Ei tarkastettu';
  }
  return value.slice(0, 10);
}

/**
 * Generate an A4 PDF inspection checklist for a storage and its places/contents.
 * Pure function taking a StorageDetail and returning a PDF Buffer.
 * @param {StorageDetail} storageDetail
 * @returns {Promise<Buffer>}
 */
export async function generateSummaryPdf(storageDetail) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
    /** @type {Buffer[]} */
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const margin = 40;
    const contentWidth = A4_WIDTH_PT - 2 * margin;
    const bottomLimit = A4_HEIGHT_PT - margin;

    const colCheckX = margin;
    const colNameX = margin + 24;
    const colNameW = 225;
    const colQtyX = colNameX + colNameW + 8;
    const colQtyW = 95;
    const colStatusX = colQtyX + colQtyW + 8;
    const colStatusW = 70;
    const colExpX = colStatusX + colStatusW + 8;
    const colExpW = A4_WIDTH_PT - margin - colExpX;

    let y = margin;

    const drawTableHeader = () => {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#444444');
      doc.text('[ ]', colCheckX, y, { width: 22, lineBreak: false });
      doc.text('Kohde', colNameX, y, { width: colNameW, lineBreak: false });
      doc.text('Määrä', colQtyX, y, { width: colQtyW, lineBreak: false });
      doc.text('Tila', colStatusX, y, { width: colStatusW, lineBreak: false });
      doc.text('Vanhenee', colExpX, y, { width: colExpW, lineBreak: false });
      y += 14;
      doc
        .moveTo(margin, y)
        .lineTo(margin + contentWidth, y)
        .strokeColor('#cccccc')
        .lineWidth(0.75)
        .stroke();
      y += 8;
    };

    const ensureSpace = (needed) => {
      if (y + needed > bottomLimit) {
        doc.addPage();
        y = margin;
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333');
        doc.text(`${storageDetail.name} (jatkuu)`, margin, y, {
          width: contentWidth,
          lineBreak: false,
          ellipsis: true,
        });
        y += 18;
        drawTableHeader();
      }
    };

    doc.addPage();

    // Title & kind
    const kindLabel = KIND_LABELS_FI[storageDetail.kind] ?? KIND_LABELS_FI.other;
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#000000');
    doc.text(storageDetail.name, margin, y, { width: contentWidth - 140 });
    const titleHeight = doc.heightOfString(storageDetail.name, { width: contentWidth - 140 });

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#444444');
    doc.text(kindLabel, margin + contentWidth - 135, y + 4, {
      width: 135,
      align: 'right',
      lineBreak: false,
    });
    y += Math.max(24, titleHeight + 4);

    if (storageDetail.description) {
      doc.font('Helvetica').fontSize(10).fillColor('#333333');
      doc.text(storageDetail.description, margin, y, { width: contentWidth });
      y += doc.heightOfString(storageDetail.description, { width: contentWidth }) + 6;
    }

    // Inspection & code metadata
    const inspectionText = `Viimeisin tarkastus: ${formatDate(storageDetail.lastInspectedAt)}  |  ${
      storageDetail.inspectionDue ? 'Tarkastus ajankohtainen' : 'Tarkastus kunnossa'
    }`;
    doc.font('Helvetica').fontSize(9.5).fillColor(storageDetail.inspectionDue ? '#991b1b' : '#222222');
    doc.text(inspectionText, margin, y, { width: contentWidth });
    y += 14;

    if (storageDetail.code) {
      doc.font('Courier-Bold').fontSize(9.5).fillColor('#333333');
      doc.text(`Koodi: ${storageDetail.code}`, margin, y, { width: contentWidth });
      y += 14;
    }

    y += 4;
    doc
      .moveTo(margin, y)
      .lineTo(margin + contentWidth, y)
      .strokeColor('#000000')
      .lineWidth(1)
      .stroke();
    y += 12;

    drawTableHeader();

    const places = storageDetail.places ?? [];
    if (places.length === 0) {
      doc.font('Helvetica-Oblique').fontSize(10).fillColor('#555555');
      doc.text('Ei säilytyspaikkoja.', margin, y);
      doc.end();
      return;
    }

    for (const place of places) {
      ensureSpace(34);

      const pathLabel =
        place.path && place.path.length > 0 ? place.path.join(' > ') : place.name;

      doc.save();
      doc.rect(margin, y, contentWidth, 18).fill('#f3f4f6');
      doc.restore();

      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111');
      doc.text(pathLabel, margin + 6, y + 4, {
        width: contentWidth - 12,
        lineBreak: false,
        ellipsis: true,
      });
      y += 22;

      const rows = [
        ...(place.items ?? []).map((item) => ({
          name: item.code ? `${item.name} (${item.code})` : item.name,
          quantity: item.minQuantity != null ? `min ${item.minQuantity}` : '-',
          status: STATUS_LABELS_FI[item.status] ?? item.status,
          expiresOn: item.expiresOn ?? '-',
        })),
        ...(place.entries ?? []).map((entry) => {
          const qtyParts = [];
          if (entry.quantity != null) qtyParts.push(String(entry.quantity));
          if (entry.quantityNote) qtyParts.push(entry.quantityNote);
          return {
            name: entry.name,
            quantity: qtyParts.join(' ') || '-',
            status: STATUS_LABELS_FI[entry.status] ?? entry.status,
            expiresOn: entry.expiresOn ?? '-',
          };
        }),
      ];

      if (rows.length === 0) {
        ensureSpace(18);
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#666666');
        doc.text('(Ei kirjattuja tavaroita)', colNameX, y, { width: colNameW });
        y += 16;
        continue;
      }

      for (const row of rows) {
        ensureSpace(20);

        // Draw physical inspection checkbox
        doc.save();
        doc
          .rect(colCheckX + 2, y + 1, 9, 9)
          .strokeColor('#333333')
          .lineWidth(0.8)
          .stroke();
        doc.restore();

        doc.font('Helvetica').fontSize(9.5).fillColor('#111111');
        doc.text(row.name, colNameX, y, {
          width: colNameW,
          lineBreak: false,
          ellipsis: true,
        });
        doc.text(row.quantity, colQtyX, y, {
          width: colQtyW,
          lineBreak: false,
          ellipsis: true,
        });
        doc.text(row.status, colStatusX, y, {
          width: colStatusW,
          lineBreak: false,
          ellipsis: true,
        });
        doc.text(row.expiresOn, colExpX, y, {
          width: colExpW,
          lineBreak: false,
          ellipsis: true,
        });

        y += 16;
        doc
          .moveTo(margin, y - 2)
          .lineTo(margin + contentWidth, y - 2)
          .strokeColor('#eeeeee')
          .lineWidth(0.5)
          .stroke();
      }

      y += 6;
    }

    doc.end();
  });
}
