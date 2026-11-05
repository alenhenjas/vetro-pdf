import { writeFileSync } from 'node:fs';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

const INK = rgb(0.11, 0.12, 0.16);
const SOFT = rgb(0.4, 0.43, 0.5);
const ACCENT = rgb(0.2, 0.3, 0.72);
const WIDTH = 595;
const MARGIN = 62;

function wrap(text: string, font: PDFFont, size: number, max: number) {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > max) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  lines.push(line);
  return lines;
}

function paragraph(page: PDFPage, text: string, y: number, font: PDFFont) {
  let cursor = y;
  for (const line of wrap(text, font, 11, WIDTH - MARGIN * 2)) {
    page.drawText(line, { x: MARGIN, y: cursor, size: 11, font, color: INK });
    cursor -= 16;
  }
  return cursor - 8;
}

function node(page: PDFPage, x: number, y: number, label: string, font: PDFFont) {
  page.drawCircle({ x, y, size: 15, color: rgb(0.93, 0.95, 1), borderColor: ACCENT, borderWidth: 1.2 });
  page.drawText(label, { x: x - font.widthOfTextAtSize(label, 11) / 2, y: y - 4, size: 11, font, color: INK });
}

/** Documento dimostrativo originale usato per gli screenshot della documentazione. */
export async function writeDemoPdf(path: string) {
  const doc = await PDFDocument.create();
  doc.setTitle('Balanced Search Trees');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const p1 = doc.addPage([WIDTH, 842]);
  p1.drawText('Balanced Search Trees', { x: MARGIN, y: 770, size: 26, font: bold, color: INK });
  p1.drawText('Lecture notes, part 1: why balance matters', { x: MARGIN, y: 748, size: 12, font: regular, color: SOFT });
  p1.drawLine({ start: { x: MARGIN, y: 736 }, end: { x: WIDTH - MARGIN, y: 736 }, thickness: 1.4, color: ACCENT });

  let y = 708;
  p1.drawText('1. The problem', { x: MARGIN, y, size: 14, font: bold, color: ACCENT });
  y = paragraph(p1, 'A binary search tree keeps its keys ordered, so that lookup, insertion and deletion all follow a single path from the root. The cost of every operation is therefore proportional to the height of the tree, not to the number of keys it stores.', y - 22, regular);
  y = paragraph(p1, 'Inserting keys that are already sorted produces a degenerate tree that behaves like a linked list. Its height grows linearly and every operation slows down to O(n). A balanced tree restores the logarithmic bound by reorganising itself after each update.', y, regular);

  p1.drawText('2. Rotations', { x: MARGIN, y: y - 4, size: 14, font: bold, color: ACCENT });
  y = paragraph(p1, 'A rotation changes the shape of a subtree in constant time while preserving the in-order sequence of its keys. It is the only primitive an AVL tree needs in order to repair an imbalance.', y - 26, regular);

  const cx = 297;
  const top = y - 22;
  const edges: [number, number, number, number][] = [
    [cx, top, cx - 80, top - 56], [cx, top, cx + 80, top - 56],
    [cx - 80, top - 56, cx - 122, top - 112], [cx - 80, top - 56, cx - 38, top - 112],
    [cx + 80, top - 56, cx + 122, top - 112],
  ];
  for (const [x1, y1, x2, y2] of edges) {
    p1.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1, color: SOFT });
  }
  node(p1, cx, top, '42', bold);
  node(p1, cx - 80, top - 56, '17', bold);
  node(p1, cx + 80, top - 56, '63', bold);
  node(p1, cx - 122, top - 112, '8', bold);
  node(p1, cx - 38, top - 112, '29', bold);
  node(p1, cx + 122, top - 112, '81', bold);

  const code = [
    'function rotateRight(y):',
    '    x = y.left',
    '    y.left = x.right',
    '    x.right = y',
    '    update(y); update(x)',
    '    return x',
  ];
  const codeTop = top - 142;
  p1.drawRectangle({ x: MARGIN, y: codeTop - 96, width: WIDTH - MARGIN * 2, height: 104, color: rgb(0.96, 0.965, 0.98) });
  code.forEach((line, i) => {
    p1.drawText(line, { x: MARGIN + 14, y: codeTop - 12 - i * 15, size: 10.5, font: mono, color: INK });
  });
  p1.drawText('Vetro PDF sample document', { x: MARGIN, y: 34, size: 9, font: regular, color: SOFT });

  const p2 = doc.addPage([WIDTH, 842]);
  p2.drawText('3. Complexity', { x: MARGIN, y: 770, size: 14, font: bold, color: ACCENT });
  y = paragraph(p2, 'The height of an AVL tree with n keys never exceeds about 1.44 log2(n), so the worst case stays logarithmic for every operation.', 744, regular);
  const rows = [
    ['Operation', 'Unbalanced BST', 'AVL tree'],
    ['Search', 'O(n)', 'O(log n)'],
    ['Insert', 'O(n)', 'O(log n)'],
    ['Delete', 'O(n)', 'O(log n)'],
  ];
  rows.forEach((row, r) => {
    const rowY = y - 8 - r * 24;
    if (r === 0) p2.drawRectangle({ x: MARGIN, y: rowY - 7, width: WIDTH - MARGIN * 2, height: 24, color: rgb(0.93, 0.95, 1) });
    row.forEach((cell, c) => {
      p2.drawText(cell, { x: MARGIN + 12 + c * 158, y: rowY, size: 11, font: r === 0 ? bold : regular, color: INK });
    });
  });
  p2.drawText('Vetro PDF sample document', { x: MARGIN, y: 34, size: 9, font: regular, color: SOFT });

  writeFileSync(path, await doc.save());
}
