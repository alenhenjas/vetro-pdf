import { mkdirSync, writeFileSync } from 'node:fs';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/** Genera i PDF di prova: pagine ruotate, formati diversi, CropBox, documento lungo. */
export default async function globalSetup() {
  mkdirSync('tests/.tmp', { recursive: true });

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const p1 = doc.addPage([595, 842]);
  p1.drawText('Strutture dati: alberi binari di ricerca', { x: 60, y: 760, size: 18, font });
  for (let i = 0; i < 12; i++) {
    p1.drawText(`Riga ${i + 1}: il testo originale deve restare leggibile sotto ogni annotazione.`, {
      x: 60, y: 720 - i * 22, size: 12, font, color: rgb(0.1, 0.1, 0.15),
    });
  }

  const p2 = doc.addPage([595, 842]);
  p2.setRotation(degrees(90));
  p2.drawText('Pagina ruotata di 90 gradi', { x: 60, y: 760, size: 18, font });

  const p3 = doc.addPage([842, 400]);
  p3.drawText('Pagina orizzontale con CropBox', { x: 120, y: 300, size: 18, font });
  p3.setCropBox(100, 50, 640, 300);

  const p4 = doc.addPage([400, 500]);
  p4.setRotation(degrees(270));
  p4.drawText('Pagina ruotata di 270 gradi', { x: 40, y: 400, size: 14, font });

  writeFileSync('tests/.tmp/sample.pdf', await doc.save());

  const big = await PDFDocument.create();
  const bigFont = await big.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 320; i++) {
    const page = big.addPage([595, 842]);
    page.drawText(`Pagina ${i + 1}`, { x: 60, y: 760, size: 22, font: bigFont });
    for (let k = 0; k < 30; k++) {
      page.drawText(`Contenuto ${i + 1}.${k + 1} per la prova di prestazioni`, { x: 60, y: 720 - k * 20, size: 11, font: bigFont });
    }
  }
  writeFileSync('tests/.tmp/big.pdf', await big.save());
}
