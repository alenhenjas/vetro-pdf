import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { counts, drag, getFile, installFilePicker, openFromPicker, pagePoint, pasteImage, putFile, reopen, save, selectTool } from './helpers';
import { inspectPdf, readWithPdfjs } from './inspect';

const NAME = 'annotato.pdf';

test.beforeEach(async ({ page }) => {
  await installFilePicker(page, NAME);
  await page.goto('/');
  await putFile(page, NAME, 'tests/.tmp/sample.pdf');
  await page.reload();
});

async function addEverything(page: Page) {
  // Testo
  await selectTool(page, 't');
  const t = await pagePoint(page, 0, 0.15, 0.62);
  await page.mouse.click(t.x, t.y);
  await expect(page.locator('[data-text-editor]')).toBeFocused();
  await page.keyboard.type('Nota di prova àèìòù → x ≤ y');
  await page.keyboard.press('Escape');

  // Penna
  await selectTool(page, 'p');
  await drag(page, await pagePoint(page, 0, 0.2, 0.7), await pagePoint(page, 0, 0.6, 0.74));

  // Evidenziatore
  await selectTool(page, 'h');
  await drag(page, await pagePoint(page, 0, 0.1, 0.145), await pagePoint(page, 0, 0.7, 0.145));

  // Forme
  for (const [key, a, b] of [
    ['r', [0.15, 0.78], [0.35, 0.86]],
    ['o', [0.4, 0.78], [0.6, 0.86]],
    ['a', [0.65, 0.78], [0.85, 0.86]],
    ['l', [0.15, 0.9], [0.5, 0.92]],
  ] as const) {
    await selectTool(page, key);
    await drag(page, await pagePoint(page, 0, a[0], a[1]), await pagePoint(page, 0, b[0], b[1]));
  }

  // Immagine incollata
  await selectTool(page, 'v');
  const p = await pagePoint(page, 0, 0.6, 0.55);
  await page.mouse.move(p.x, p.y);
  await pasteImage(page);
  await expect(page.locator('[data-page="0"] [data-kind="image"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
}

const EXPECTED = { text: 1, ink: 2, shape: 4, image: 1 };

test('apre, annota, salva, riapre: oggetti modificabili, nessuna duplicazione, PDF valido', async ({ page }) => {
  // 1. Apertura
  await openFromPicker(page);

  // 2. Annotazioni
  await addEverything(page);
  expect(await counts(page)).toEqual(EXPECTED);
  await expect(page.getByTestId('dirty')).toHaveAttribute('data-dirty', 'true');

  // 3. Salvataggio sul file originale
  await save(page);
  const first = await getFile(page, NAME);
  const info1 = await inspectPdf(first);
  expect(Object.values(info1.project.annotations).flat()).toHaveLength(8);
  expect(info1.pages[0].layers).toBe(1);
  expect(info1.pages[1].layers).toBe(0);

  // 4. Riapertura: oggetti di nuovo modificabili
  await reopen(page);
  await expect(page.locator('[data-page="0"] [data-kind="image"]')).toHaveCount(1);
  expect(await counts(page)).toEqual(EXPECTED);
  await expect(page.getByTestId('dirty')).toHaveAttribute('data-dirty', 'false');

  const rect = page.locator('[data-page="0"] [data-subkind="rect"] path');
  const before = (await rect.boundingBox())!;
  await selectTool(page, 'v');
  const a = await pagePoint(page, 0, 0.15, 0.82);
  await drag(page, a, { x: a.x + 40, y: a.y + 10 });
  const after = (await rect.boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 30);

  // Il testo si rimodifica
  const text = page.locator('[data-page="0"] [data-kind="text"]');
  const tb = (await text.boundingBox())!;
  await page.mouse.dblclick(tb.x + 20, tb.y + tb.height / 2);
  await expect(page.locator('[data-text-editor]')).toHaveValue(/Nota di prova àèìòù → x ≤ y/);
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' (bis)');
  await page.keyboard.press('Escape');
  await expect(text).toContainText('(bis)');

  // 5. Secondo salvataggio: nessuna duplicazione
  await save(page);
  const second = await getFile(page, NAME);
  const info2 = await inspectPdf(second);
  expect(Object.values(info2.project.annotations).flat()).toHaveLength(8);
  expect(info2.pages[0].parts).toBe(info1.pages[0].parts);
  expect(info2.objectCount).toBe(info1.objectCount);
  expect(info2.registered).toBe(info1.registered);
  expect(Math.abs(info2.size - info1.size)).toBeLessThan(2000);

  // Salvataggi ripetuti: il file non cresce
  await reopen(page);
  await selectTool(page, 'p');
  await drag(page, await pagePoint(page, 0, 0.3, 0.3), await pagePoint(page, 0, 0.4, 0.3));
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z').catch(() => undefined);
  await page.keyboard.press('Control+y');
  await page.locator('[data-action="save"]').click();
  await expect(page.locator('[data-toast="success"]').last()).toBeVisible();
  const third = await getFile(page, NAME);
  expect(Math.abs(third.length - second.length)).toBeLessThan(2000);

  // 6. Valido e leggibile con pdf.js: testo vettoriale estraibile, disegno presente
  const read = await readWithPdfjs(third);
  expect(read.numPages).toBe(4);
  expect(read.pages[0].text).toContain('Strutture dati');
  expect(read.pages[0].text.replace(/\s+/g, ' ')).toContain('Nota di prova àèìòù → x ≤ y (bis)');
  expect(read.pages[0].opCount).toBeGreaterThan(50);
});

test('pagine ruotate e CropBox: coordinate corrette nel PDF', async ({ page }) => {
  await openFromPicker(page);
  await page.getByTestId('page-input').fill('2');
  await page.getByTestId('page-input').press('Enter');
  await expect(page.locator('[data-page="1"]')).toBeVisible();

  // Pagina ruotata: è orizzontale a schermo (842 × 595)
  const box = (await page.locator('[data-page="1"]').boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(842 / 595, 1);

  await selectTool(page, 't');
  const t = await pagePoint(page, 1, 0.1, 0.1);
  await page.mouse.click(t.x, t.y);
  await expect(page.locator('[data-text-editor]')).toBeFocused();
  await page.keyboard.type('Testo su pagina ruotata');
  await page.keyboard.press('Escape');

  await page.getByTestId('page-input').fill('3');
  await page.getByTestId('page-input').press('Enter');
  await selectTool(page, 't');
  const t3 = await pagePoint(page, 2, 0.1, 0.2);
  await page.mouse.click(t3.x, t3.y);
  await expect(page.locator('[data-text-editor]')).toBeFocused();
  await page.keyboard.type('Testo con CropBox');
  await page.keyboard.press('Escape');
  await save(page);

  const bytes = await getFile(page, NAME);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;

  const find = async (n: number, needle: string) => {
    const p = await pdf.getPage(n);
    const vp = p.getViewport({ scale: 1 });
    const content = await p.getTextContent();
    const item = content.items.find((i) => 'str' in i && i.str.includes(needle)) as any;
    expect(item, needle).toBeTruthy();
    const [x, y] = vp.convertToViewportPoint(item.transform[4], item.transform[5]);
    // Direzione del testo a schermo: deve correre da sinistra a destra.
    const [ax, ay] = vp.convertToViewportPoint(item.transform[4] + item.transform[0], item.transform[5] + item.transform[1]);
    return { x: x / vp.width, y: y / vp.height, dx: ax - x, dy: ay - y };
  };
  const r = await find(2, 'Testo su pagina');
  expect(r.x).toBeGreaterThan(0.09);
  expect(r.x).toBeLessThan(0.14);
  expect(r.y).toBeGreaterThan(0.08);
  expect(r.y).toBeLessThan(0.14);
  expect(r.dx).toBeGreaterThan(0);
  expect(Math.abs(r.dy)).toBeLessThan(0.01);

  const c = await find(3, 'Testo con');
  expect(c.x).toBeGreaterThan(0.09);
  expect(c.x).toBeLessThan(0.14);
  expect(c.y).toBeGreaterThan(0.17);
  expect(c.y).toBeLessThan(0.26);
});

test('selezione, duplica, copia tra pagine, annulla e ripeti', async ({ page }) => {
  await openFromPicker(page);
  await selectTool(page, 'r');
  await drag(page, await pagePoint(page, 0, 0.2, 0.2), await pagePoint(page, 0, 0.4, 0.3));
  await selectTool(page, 'o');
  await drag(page, await pagePoint(page, 0, 0.5, 0.2), await pagePoint(page, 0, 0.7, 0.3));
  expect(await counts(page)).toEqual({ shape: 2 });

  // Selezione multipla a rettangolo
  await selectTool(page, 'v');
  await drag(page, await pagePoint(page, 0, 0.1, 0.1), await pagePoint(page, 0, 0.8, 0.4));
  await expect(page.locator('.selection-box')).toHaveCount(1);
  await expect(page.locator('[data-panel="selection"]')).toContainText('2 oggetti');

  await page.keyboard.press('Control+d');
  expect(await counts(page)).toEqual({ shape: 4 });
  await page.keyboard.press('Delete');
  expect(await counts(page)).toEqual({ shape: 2 });
  await page.keyboard.press('Control+z');
  expect(await counts(page)).toEqual({ shape: 4 });
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  expect(await counts(page)).toEqual({ shape: 4 });
  await page.keyboard.press('Control+z');
  expect(await counts(page)).toEqual({ shape: 2 });

  // Copia e incolla su un'altra pagina
  await drag(page, await pagePoint(page, 0, 0.1, 0.1), await pagePoint(page, 0, 0.45, 0.4));
  await page.evaluate(() => {
    const dt = new DataTransfer();
    window.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    (window as any).__dt = dt;
  });
  await page.getByTestId('page-input').fill('2');
  await page.getByTestId('page-input').press('Enter');
  await expect(page.getByTestId('page-input')).toHaveValue('2');
  await page.evaluate(() => {
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: (window as any).__dt, bubbles: true, cancelable: true }));
  });
  expect(await counts(page, 1)).toEqual({ shape: 1 });
  await page.keyboard.press('Control+z');
  expect(await counts(page, 1)).toEqual({});
});

test('gomma per oggetto, evidenziatore non copre, Shift vincola', async ({ page }) => {
  await openFromPicker(page);
  await selectTool(page, 'p');
  await drag(page, await pagePoint(page, 0, 0.2, 0.3), await pagePoint(page, 0, 0.6, 0.3));
  await drag(page, await pagePoint(page, 0, 0.2, 0.4), await pagePoint(page, 0, 0.6, 0.4));
  expect(await counts(page)).toEqual({ ink: 2 });
  await selectTool(page, 'e');
  await drag(page, await pagePoint(page, 0, 0.4, 0.25), await pagePoint(page, 0, 0.4, 0.35));
  expect(await counts(page)).toEqual({ ink: 1 });

  await selectTool(page, 'h');
  await drag(page, await pagePoint(page, 0, 0.1, 0.146), await pagePoint(page, 0, 0.8, 0.146));
  expect(await page.locator('.annotation-svg.multiply').count()).toBeGreaterThan(0);

  await selectTool(page, 'r');
  const a = await pagePoint(page, 0, 0.2, 0.5);
  await page.keyboard.down('Shift');
  await drag(page, a, { x: a.x + 150, y: a.y + 60 });
  await page.keyboard.up('Shift');
  const box = (await page.locator('[data-subkind="rect"] path').boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(3);
});

test('immagine: proporzioni, rotazione, margine laterale persistente', async ({ page }) => {
  await openFromPicker(page);
  await page.locator('[data-action="margin"]').click();
  await page.getByTestId('margin-slider').fill('200');
  await page.getByTestId('margin-slider').dispatchEvent('pointerup');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 450);
  await selectTool(page, 'v');

  const q = await pagePoint(page, 0, 0.8, 0.3);
  await page.mouse.move(q.x, q.y);
  await pasteImage(page, '#e76f51', 200);
  const img = page.locator('[data-kind="image"] image');
  await expect(img).toHaveCount(1);

  const ratio = () => img.evaluate((el) => +el.getAttribute('width')! / +el.getAttribute('height')!);
  const ratio0 = await ratio();
  const hb = (await page.locator('[data-handle="se"]').boundingBox())!;
  await drag(page, { x: hb.x + 5, y: hb.y + 5 }, { x: hb.x + 80, y: hb.y + 20 });
  expect(await ratio()).toBeCloseTo(ratio0, 2);

  const rot = (await page.locator('[data-handle="rotate"]').boundingBox())!;
  await drag(page, { x: rot.x + 5, y: rot.y + 5 }, { x: rot.x + 120, y: rot.y + 120 });
  expect(await img.getAttribute('transform')).toMatch(/rotate/);

  await save(page);
  const info = await inspectPdf(await getFile(page, NAME));
  expect(info.pages[0].width).toBeCloseTo(795, 0);
  expect(info.pages[1].width).toBeLessThan(600);

  await reopen(page);
  await expect(img).toHaveCount(1);
  await expect(page.locator('.page-margin')).toBeVisible();
  await expect(img).toHaveAttribute('transform', /rotate/);

  // Dopo la riapertura la pagina di base ha di nuovo il formato originale.
  const box = (await page.locator('[data-page="0"]').boundingBox())!;
  const canvas = (await page.locator('[data-page="0"] .page-canvas').boundingBox())!;
  expect(box.width / canvas.width).toBeCloseTo(795 / 595, 1);
});

test('bozza automatica e ripristino originale', async ({ page }) => {
  await openFromPicker(page);
  await selectTool(page, 'p');
  await drag(page, await pagePoint(page, 0, 0.2, 0.3), await pagePoint(page, 0, 0.6, 0.3));

  // Crash simulato: dopo l'autosalvataggio si ricarica senza salvare.
  await page.waitForTimeout(3600);
  page.on('dialog', (d) => d.accept());
  await page.reload();
  await page.getByRole('button', { name: /Apri un PDF/ }).click();
  await page.locator('[data-dialog-action="restore"]').click();
  await expect(page.locator('[data-page="0"] [data-kind="ink"]')).toHaveCount(1);
  await expect(page.getByTestId('dirty')).toHaveAttribute('data-dirty', 'true');

  await save(page);
  await reopen(page);
  await expect(page.locator('[data-page="0"] [data-kind="ink"]')).toHaveCount(1);

  // Ripristina originale
  await page.locator('[data-action="more"]').click();
  await page.locator('[data-action="restore"]').click();
  await page.locator('[data-dialog-action="restore"]').click();
  await expect(page.locator('[data-page="0"] [data-kind="ink"]')).toHaveCount(0);
  await expect(page.getByTestId('dirty')).toHaveAttribute('data-dirty', 'true');
  await save(page);
  const restored = await getFile(page, NAME);
  const read = await readWithPdfjs(restored);
  expect(read.numPages).toBe(4);
  expect(read.pages[0].text).toContain('Riga 12');
  expect(Math.abs(restored.length - readFileSync('tests/.tmp/sample.pdf').length)).toBeLessThan(4000);
});

test('avviso con modifiche non salvate, ricerca, tema', async ({ page }) => {
  await openFromPicker(page);
  await page.keyboard.press('Control+f');
  await page.locator('[data-search-input]').fill('Riga 1');
  await expect(page.getByTestId('search-count')).toContainText('di 4');
  await expect(page.locator('[data-search-hit]').first()).toBeAttached();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  await selectTool(page, 'r');
  await drag(page, await pagePoint(page, 0, 0.2, 0.4), await pagePoint(page, 0, 0.4, 0.5));

  await page.locator('[data-action="close"]').click();
  await expect(page.getByRole('alertdialog')).toContainText('Modifiche non salvate');
  await page.locator('[data-dialog-action="cancel"]').click();
  await expect(page.locator('[data-page="0"]')).toBeVisible();

  const unload = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(unload).toBe(true);

  await page.locator('[data-action="more"]').click();
  await page.locator('[data-theme-option="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.locator('[data-page="0"]').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(255, 255, 255)');
});

test('PDF di 320 pagine: DOM virtualizzato e pagina lontana raggiungibile', async ({ page }) => {
  await putFile(page, NAME, 'tests/.tmp/big.pdf');
  await page.reload();
  await openFromPicker(page);
  expect(await page.locator('[data-page]').count()).toBeLessThan(12);
  await page.getByTestId('page-input').fill('300');
  await page.getByTestId('page-input').press('Enter');
  await expect(page.locator('[data-page="299"] canvas')).toBeVisible();
  expect(await page.locator('[data-page]').count()).toBeLessThan(12);
  await selectTool(page, 'r');
  await drag(page, await pagePoint(page, 299, 0.2, 0.2), await pagePoint(page, 299, 0.4, 0.3));
  await save(page);
  const read = await readWithPdfjs(await getFile(page, NAME));
  expect(read.numPages).toBe(320);
  expect(read.pages[299].text).toContain('Pagina 300');
});

test('offline: dopo la prima visita funziona senza rete', async ({ page, context }) => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await openFromPicker(page);
  await selectTool(page, 't');
  const t = await pagePoint(page, 0, 0.2, 0.5);
  await page.mouse.click(t.x, t.y);
  await expect(page.locator('[data-text-editor]')).toBeFocused();
  await page.keyboard.type('Offline');
  await page.keyboard.press('Escape');
  await save(page);
  const read = await readWithPdfjs(await getFile(page, NAME));
  expect(read.pages[0].text).toContain('Offline');
  await context.setOffline(false);
});
