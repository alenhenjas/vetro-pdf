// Copia in public/ le risorse di pdf.js (cmaps, font standard, wasm): niente CDN a runtime.
import { cp, mkdir } from 'node:fs/promises';
await mkdir('public/pdfjs', { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(`node_modules/pdfjs-dist/${dir}`, `public/pdfjs/${dir}`, { recursive: true });
}
