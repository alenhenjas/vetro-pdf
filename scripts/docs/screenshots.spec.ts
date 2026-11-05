import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getFile, installFilePicker, openFromPicker, pagePoint, putFile, save, selectTool } from '../../tests/helpers';
import { writeDemoPdf } from './demo-pdf';

const OUT = 'docs/screenshots';
const TMP = 'tests/.tmp/demo.pdf';
const NAME = 'balanced-search-trees.pdf';

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, colorScheme: 'light' });

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` });

/** Tratto "a mano": percorso con molti punti intermedi. */
async function stroke(page: Page, points: { x: number; y: number }[]) {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.up();
}

async function circle(page: Page, cx: number, cy: number, rx: number, ry: number) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = -2.2 + (i / 40) * (Math.PI * 2.08);
    pts.push({ x: cx + Math.cos(t) * rx * (1 + i * 0.002), y: cy + Math.sin(t) * ry * (1 + i * 0.002) });
  }
  await stroke(page, pts);
}

async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}

async function note(page: Page, at: { x: number; y: number }, text: string, font: string, size: number, color?: string) {
  await selectTool(page, 't');
  await page.getByTestId('font-picker').click();
  await page.getByRole('option', { name: new RegExp(font) }).click();
  await page.getByTestId('font-size').fill(String(size));
  if (color) await page.getByLabel(`Colore del testo ${color}`).click();
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('[data-text-editor]')).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await page.mouse.click(4, 500);
}

async function pasteChart(page: Page) {
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 340;
    c.height = 218;
    const g = c.getContext('2d')!;
    g.scale(340 / 560, 218 / 360);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 560, 360);
    g.strokeStyle = '#d9dee9';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(50, 40 + i * 56);
      g.lineTo(530, 40 + i * 56);
      g.stroke();
    }
    const curve = (fn: (x: number) => number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = 5;
      g.beginPath();
      for (let x = 0; x <= 480; x += 4) g.lineTo(50 + x, 320 - fn(x));
      g.stroke();
    };
    curve((x) => x * 0.58, '#ff5a4f');
    curve((x) => Math.log2(x + 1) * 21, '#3a6bff');
    g.fillStyle = '#1c1c1e';
    g.font = '600 24px sans-serif';
    g.fillText('height of the tree', 50, 28);
    g.font = '20px sans-serif';
    g.fillStyle = '#ff5a4f';
    g.fillText('BST: O(n)', 380, 80);
    g.fillStyle = '#3a6bff';
    g.fillText('AVL: O(log n)', 380, 250);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'chart.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('[data-page="0"] [data-kind="image"]')).toHaveCount(1);
}

test('screenshot della documentazione', async ({ page, context }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  await writeDemoPdf(TMP);
  await installFilePicker(page, NAME);
  await page.goto('/');
  await putFile(page, NAME, TMP);
  await page.reload();

  await openFromPicker(page);
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+-');
  await page.keyboard.press('Control+-');
  await page.waitForTimeout(700);
  await page.locator('[data-viewer]').evaluate((el) => { el.scrollTop = 0; });

  // Prima di annotare: la pagina vuota.
  await page.waitForTimeout(500);
  await shot(page, 'workspace-clean');

  // Evidenziatore su due righe di testo.
  await selectTool(page, 'h');
  await drag(page, await pagePoint(page, 0, 0.106, 0.2195), await pagePoint(page, 0, 0.42, 0.2195));
  await shot(page, 'tool-highlighter');
  await drag(page, await pagePoint(page, 0, 0.106, 0.2858), await pagePoint(page, 0, 0.57, 0.2858));

  // Penna: cerchio attorno alla radice, tratto a mano sotto una parola.
  await selectTool(page, 'p');
  await page.getByLabel('Colore #ff3b30').click();
  const root = await pagePoint(page, 0, 0.4995, 0.4234);
  await circle(page, root.x, root.y, 38, 30);
  await shot(page, 'tool-pen');

  // Forme.
  await selectTool(page, 'a');
  await drag(page, await pagePoint(page, 0, 0.72, 0.405), await pagePoint(page, 0, 0.56, 0.42));
  await selectTool(page, 'r');
  await drag(page, await pagePoint(page, 0, 0.095, 0.578), await pagePoint(page, 0, 0.908, 0.714));
  await shot(page, 'tool-shapes');

  // Note di testo con font diversi.
  await note(page, await pagePoint(page, 0, 0.72, 0.4), 'the root stays balanced!', 'Caveat', 20, '#ff3b30');
  await note(page, await pagePoint(page, 0, 0.5, 0.635), 'constant time: only three pointers change', 'Patrick Hand', 15, '#0a84ff');

  // Selettore dei font con anteprima.
  await selectTool(page, 't');
  await page.getByTestId('font-picker').click();
  await page.waitForTimeout(500);
  await shot(page, 'font-picker');
  await page.keyboard.press('Escape');
  await page.mouse.click(4, 500);

  // Margine allargato e immagine incollata, ruotata di lato al contenuto.
  await page.locator('[data-action="margin"]').click();
  await page.getByTestId('margin-slider').fill('280');
  await page.getByTestId('margin-slider').dispatchEvent('pointerup');
  await page.waitForTimeout(250);
  await shot(page, 'margin-popover');
  await page.mouse.click(4, 500);
  await selectTool(page, 'v');
  await page.locator('[data-action="sidebar"]').click();
  await page.waitForTimeout(400);
  const side = await pagePoint(page, 0, 1.02, 0.14);
  await page.mouse.move(side.x, side.y);
  await pasteChart(page);
  await page.waitForTimeout(500);
  await shot(page, 'image-handles');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="sidebar"]').click();
  await page.waitForTimeout(500);

  // Risultato complessivo: immagine principale, nei due temi.
  await page.mouse.move(4, 500);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(500);
  await shot(page, 'workspace-annotated-light');

  await page.keyboard.press('Control+f');
  await page.locator('[data-search-input]').fill('rotation');
  await page.waitForTimeout(700);
  await shot(page, 'search');
  await page.keyboard.press('Escape');
  await page.mouse.click(4, 500);

  await save(page);
  writeFileSync(resolve('tests/.tmp/demo-annotated.pdf'), await getFile(page, NAME));

  await page.locator('[data-action="more"]').click();
  await page.waitForTimeout(250);
  await shot(page, 'menu');
  await page.locator('[data-theme-option="dark"]').click();
  await page.keyboard.press('Escape');
  await page.mouse.click(4, 500);
  await page.mouse.move(4, 500);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.locator('[data-viewer]').evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(3500);
  await shot(page, 'workspace-annotated-dark');

  await page.locator('[data-action="close"]').click();
  await page.waitForTimeout(800);
  await shot(page, 'home-dark');
  await page.locator('[data-theme-option="light"]').click();
  await page.waitForTimeout(400);
  await shot(page, 'home-light');

  // Lo stesso PDF nel lettore integrato di Chrome: la prova che il file è un PDF normale.
  const viewer = await context.newPage();
  await viewer.goto(`file:///${resolve('tests/.tmp/demo-annotated.pdf').replace(/\\/g, '/')}#zoom=88`).catch(() => undefined);
  await viewer.waitForTimeout(4500);
  await viewer.screenshot({ path: `${OUT}/saved-in-chrome-viewer.png` });
});
