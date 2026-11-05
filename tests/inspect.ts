import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function inspectPdf(bytes: Buffer) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const reg = doc.catalog.lookup(PDFName.of('VetroPDF'), PDFDict);
  const data = reg.lookup(PDFName.of('Data')) as PDFRawStream;
  const project = JSON.parse(new TextDecoder().decode(decodePDFRawStream(data).decode()));
  const pages = doc.getPages().map((p) => {
    const contents = p.node.Contents();
    const parts = contents instanceof PDFArray ? contents.size() : 1;
    const xo = p.node.Resources()?.lookup(PDFName.of('XObject'));
    const layers = xo instanceof PDFDict ? xo.keys().filter((k) => k.decodeText().startsWith('VetroLayer')).length : 0;
    return { parts, layers, width: p.getCropBox().width, height: p.getCropBox().height };
  });
  return {
    pages,
    project,
    objectCount: doc.context.enumerateIndirectObjects().length,
    registered: reg.lookup(PDFName.of('Objects'), PDFArray).size(),
    size: bytes.length,
  };
}

export async function readWithPdfjs(bytes: Buffer) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const ops = await page.getOperatorList();
    pages.push({
      text: content.items.map((it) => ('str' in it ? it.str : '')).join(' '),
      opCount: ops.fnArray.length,
      view: page.view,
      rotate: page.rotate,
    });
  }
  return { numPages: pdf.numPages, pages };
}
