// fontkit (usato da pdf-lib per i subset) scrive la tabella `loca` in formato corto, che
// richiede glifi di lunghezza pari; con glifi dispari i contorni si sfalsano e Chrome/Edge
// mostrano caratteri vuoti. Questo script riscrive i TTF allineando ogni glifo a 4 byte.
// Va eseguito una volta sola dopo download-fonts.mjs: i file risultanti sono nel progetto.
// I font senza glifi dispari restano intatti: Lora e Merriweather hanno un Reserved Font Name
// e la licenza OFL ne vieta la ridistribuzione modificata con lo stesso nome.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'public/fonts';
const pad4 = (n) => (n + 3) & ~3;

function checksum(buf) {
  let sum = 0;
  const padded = Buffer.alloc(pad4(buf.length));
  buf.copy(padded);
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

function normalize(font) {
  const numTables = font.readUInt16BE(4);
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16;
    const tag = font.toString('latin1', p, p + 4);
    const offset = font.readUInt32BE(p + 8);
    tables.set(tag, Buffer.from(font.subarray(offset, offset + font.readUInt32BE(p + 12))));
  }

  const head = tables.get('head');
  const long = head.readInt16BE(50) === 1;
  const numGlyphs = tables.get('maxp').readUInt16BE(4);
  const loca = tables.get('loca');
  const glyf = tables.get('glyf');
  const off = (i) => (long ? loca.readUInt32BE(i * 4) : loca.readUInt16BE(i * 2) * 2);

  const chunks = [];
  const newLoca = Buffer.alloc((numGlyphs + 1) * 4);
  let pos = 0;
  let odd = 0;
  for (let g = 0; g < numGlyphs; g++) {
    newLoca.writeUInt32BE(pos, g * 4);
    const data = glyf.subarray(off(g), off(g + 1));
    if (data.length % 2) odd++;
    const out = Buffer.alloc(pad4(data.length));
    data.copy(out);
    chunks.push(out);
    pos += out.length;
  }
  newLoca.writeUInt32BE(pos, numGlyphs * 4);
  head.writeInt16BE(1, 50); // loca lunga nel font completo
  head.writeUInt32BE(0, 8); // checkSumAdjustment ricalcolato sotto
  tables.set('glyf', Buffer.concat(chunks));
  tables.set('loca', newLoca);

  const tags = [...tables.keys()].sort();
  const headerSize = 12 + tags.length * 16;
  const total = headerSize + tags.reduce((n, t) => n + pad4(tables.get(t).length), 0);
  const out = Buffer.alloc(total);
  font.copy(out, 0, 0, 12);
  let cursor = headerSize;
  tags.forEach((tag, i) => {
    const data = tables.get(tag);
    const p = 12 + i * 16;
    out.write(tag, p, 'latin1');
    out.writeUInt32BE(checksum(data), p + 4);
    out.writeUInt32BE(cursor, p + 8);
    out.writeUInt32BE(data.length, p + 12);
    data.copy(out, cursor);
    cursor += pad4(data.length);
  });
  const headOffset = out.readUInt32BE(12 + tags.indexOf('head') * 16 + 8);
  out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, headOffset + 8);
  return { out, odd, long };
}

for (const name of readdirSync(DIR).filter((f) => f.endsWith('.ttf'))) {
  const { out, odd } = normalize(readFileSync(`${DIR}/${name}`));
  if (odd) writeFileSync(`${DIR}/${name}`, out);
  console.log(name, odd ? `riallineato (${odd} glifi dispari)` : 'invariato');
}
