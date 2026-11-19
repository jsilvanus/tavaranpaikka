/**
 * A4 dimensions in PDF points (1 pt = 1/72 in; 210mm x 297mm).
 */
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

/**
 * @typedef {import('../types.js').LabelLayout} LabelLayout
 */

/**
 * @typedef {Object} LayoutSpec
 * @property {LabelLayout} id
 * @property {number} cols
 * @property {number} rows
 * @property {number} perPage
 * @property {number} pageWidth
 * @property {number} pageHeight
 * @property {number} marginX
 * @property {number} marginY
 * @property {number} gapX
 * @property {number} gapY
 * @property {number} cellWidth
 * @property {number} cellHeight
 */

/**
 * Build a LayoutSpec from sheet dimensions and margins.
 * @param {LabelLayout} id
 * @param {number} cols
 * @param {number} rows
 * @param {number} marginX
 * @param {number} marginY
 * @param {number} [gapX]
 * @param {number} [gapY]
 * @returns {LayoutSpec}
 */
function makeLayout(id, cols, rows, marginX, marginY, gapX = 0, gapY = 0) {
  const cellWidth = (A4_WIDTH_PT - 2 * marginX - (cols - 1) * gapX) / cols;
  const cellHeight = (A4_HEIGHT_PT - 2 * marginY - (rows - 1) * gapY) / rows;
  return {
    id,
    cols,
    rows,
    perPage: cols * rows,
    pageWidth: A4_WIDTH_PT,
    pageHeight: A4_HEIGHT_PT,
    marginX,
    marginY,
    gapX,
    gapY,
    cellWidth,
    cellHeight,
  };
}

/**
 * Supported A4 sticker sheet and poster layouts.
 * @type {Record<LabelLayout, LayoutSpec>}
 */
export const LAYOUTS = {
  'a4-3x8': makeLayout('a4-3x8', 3, 8, 18, 36, 0, 0),
  'a4-5x13': makeLayout('a4-5x13', 5, 13, 28, 30, 0, 0),
  'a4-2x7': makeLayout('a4-2x7', 2, 7, 14, 42, 8, 0),
  'a4-1x1': makeLayout('a4-1x1', 1, 1, 36, 36, 0, 0),
};

/**
 * Look up a layout specification by ID.
 * @param {LabelLayout | string} layout
 * @returns {LayoutSpec}
 */
export function getLayoutSpec(layout) {
  const spec = LAYOUTS[/** @type {LabelLayout} */ (layout)];
  if (!spec) {
    throw new Error(`Unknown label layout: ${layout}`);
  }
  return spec;
}

/**
 * Compute the bounding rectangle in PDF points for a 0-based cell index on a page.
 * @param {LayoutSpec} spec
 * @param {number} cellIndexOnPage
 * @returns {{ col: number, row: number, x: number, y: number, width: number, height: number }}
 */
export function getCellRect(spec, cellIndexOnPage) {
  const row = Math.floor(cellIndexOnPage / spec.cols);
  const col = cellIndexOnPage % spec.cols;
  const x = spec.marginX + col * (spec.cellWidth + spec.gapX);
  const y = spec.marginY + row * (spec.cellHeight + spec.gapY);
  return {
    col,
    row,
    x,
    y,
    width: spec.cellWidth,
    height: spec.cellHeight,
  };
}
