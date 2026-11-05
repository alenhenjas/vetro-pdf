import { readdirSync, readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { expect, test } from '@playwright/test';
import { counts, drag, getFile, installFilePicker, openFromPicker, pagePoint, putFile, save, selectTool } from './helpers';
import { readWithPdfjs } from './inspect';

const NAME = 'extra.pdf';

test('font: tutti i glifi hanno lunghezza pari (i subset restano leggibili in Chrome/Edge)', () => {
  const files = readdirSync('public/fonts').filter((f) => f.endsWith('.ttf'));
  expect(files.length).toBeGreaterThanOrEqual(27);
  for (const file of files) {
    const font = fontkit.create(readFileSync(`public/fonts/${file}`)) as unknown as { loca: { offsets: number[] } };
    expect(font.loca.offsets.every((o) => o % 2 === 0), file).toBe(true);
  }
});

test('manifest: installabile e registrato per i PDF', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.file_handlers[0].accept['application/pdf']).toContain('.pdf');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
});

test.describe('con File System Access', () => {
  test.beforeEach(async ({ page }) => {
    await installFilePicker(page, NAME);
    await page.goto('/');
    await putFile(page, NAME, 'tests/.tmp/sample.pdf');
    await page.reload();
    await openFromPicker(page);
  });

  test('Ctrl+V dagli appunti reali del sistema', async ({ page }) => {
    const p = await pagePoint(page, 0, 0.5, 0.3);
    await page.mouse.move(p.x, p.y);
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 60;
      canvas.getContext('2d')!.fillRect(0, 0, 80, 60);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    });
    await page.keyboard.press('Control+v');
    await expect(page.locator('[data-page="0"] [data-kind="image"]')).toHaveCount(1);
    const img = (await page.locator('[data-page="0"] [data-kind="image"] image').boundingBox())!;
    expect(img.x).toBeGreaterThanOrEqual(p.x);
    expect(img.x).toBeLessThan(p.x + 60);
  });

  test('trascinamento di un\'immagine sulla pagina', async ({ page }) => {
    const p = await pagePoint(page, 0, 0.4, 0.2);
    await page.evaluate(async ({ x, y }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 50;
      canvas.height = 50;
      canvas.getContext('2d')!.fillRect(0, 0, 50, 50);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'x.png', { type: 'image/png' }));
      const target = document.elementFromPoint(x, y)!;
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }, p);
    await expect(page.locator('[data-page="0"] [data-kind="image"]')).toHaveCount(1);
  });

  test('ordine: porta avanti e indietro', async ({ page }) => {
    await selectTool(page, 'r');
    await drag(page, await pagePoint(page, 0, 0.2, 0.2), await pagePoint(page, 0, 0.4, 0.3));
    await selectTool(page, 'o');
    await drag(page, await pagePoint(page, 0, 0.2, 0.2), await pagePoint(page, 0, 0.4, 0.3));
    const order = () => page.$$eval('[data-page="0"] [data-subkind]', (els) => els.map((e) => (e as HTMLElement).dataset.subkind));
    expect(await order()).toEqual(['rect', 'ellipse']);
    await selectTool(page, 'v');
    await page.mouse.click(...(Object.values(await pagePoint(page, 0, 0.203, 0.202)) as [number, number]));
    await expect(page.locator('[data-panel="selection"]')).toBeVisible();
    await page.keyboard.press(']');
    expect(await order()).toEqual(['ellipse', 'rect']);
    await page.keyboard.press('[');
    expect(await order()).toEqual(['rect', 'ellipse']);
  });

  test('sottolineatura dritta agganciata al testo del PDF', async ({ page }) => {
    await selectTool(page, 'u');
    // La prima riga del corpo è a y = 842-720 pt: si traccia leggermente storto e un po' sotto.
    await drag(page, await pagePoint(page, 0, 0.12, 0.149), await pagePoint(page, 0, 0.5, 0.156));
    const path = page.locator('[data-subkind="underline"] path');
    await expect(path).toHaveCount(1);
    const box = (await path.boundingBox())!;
    expect(box.height).toBeLessThan(5);
    const page0 = (await page.locator('[data-page="0"] .page-canvas').boundingBox())!;
    const yPt = ((box.y + box.height / 2 - page0.y) / page0.height) * 842;
    expect(yPt).toBeGreaterThan(122);
    expect(yPt).toBeLessThan(127);
  });

  test('stile del testo: font, grassetto, allineamento, sfondo persistono', async ({ page }) => {
    await selectTool(page, 't');
    const t = await pagePoint(page, 0, 0.2, 0.5);
    await page.mouse.click(t.x, t.y);
    await expect(page.locator('[data-text-editor]')).toBeFocused();
    await page.keyboard.type('Stile');
    await page.getByTestId('font-picker').click();
    await page.getByRole('option', { name: /Lora/ }).click();
    await page.getByLabel('Grassetto').click();
    await page.getByLabel('Centra').click();
    await page.getByTestId('bg-picker').click();
    await page.getByLabel('Sfondo #ff3b30').click();
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 700);
    await save(page);
    await page.reload();
    await openFromPicker(page);
    const text = page.locator('[data-kind="text"] text');
    await expect(text).toHaveText('Stile');
    await expect(text).toHaveCSS('font-family', /Lora/);
    await expect(text).toHaveCSS('font-weight', '700');
    await expect(page.locator('[data-kind="text"] > rect')).toHaveAttribute('fill', '#ff3b30');
    const read = await readWithPdfjs(await getFile(page, NAME));
    expect(read.pages[0].text).toContain('Stile');
  });

  test('Salva con nome crea una copia e lascia l\'originale intatto', async ({ page }) => {
    await selectTool(page, 'r');
    await drag(page, await pagePoint(page, 0, 0.2, 0.2), await pagePoint(page, 0, 0.4, 0.3));
    const original = await getFile(page, NAME);
    await page.locator('[data-action="more"]').click();
    await page.locator('[data-action="save-as"]').click();
    await expect(page.locator('[data-toast="success"]')).toContainText('Copia salvata');
    expect((await getFile(page, NAME)).equals(original)).toBe(true);
    expect((await getFile(page, 'extra - copia.pdf')).length).toBeGreaterThan(original.length);
    await expect(page.getByTestId('dirty')).toHaveAttribute('data-dirty', 'true');
  });

  test('modifica esterna del file: chiede conferma prima di sovrascrivere', async ({ page }) => {
    await selectTool(page, 'r');
    await drag(page, await pagePoint(page, 0, 0.2, 0.2), await pagePoint(page, 0, 0.4, 0.3));
    await page.waitForTimeout(20);
    await putFile(page, NAME, 'tests/.tmp/sample.pdf');
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('alertdialog')).toContainText('modificato altrove');
    await page.locator('[data-dialog-action="cancel"]').click();
    await expect(page.getByTestId('dirty')).toHaveAttribute('data-dirty', 'true');
  });

  test('i file recenti riaprono il documento', async ({ page }) => {
    await page.locator('[data-action="close"]').click();
    await page.locator(`[data-recent="${NAME}"]`).click();
    await expect(page.locator('[data-page="0"] canvas')).toBeVisible();
  });

  test('zoom con Ctrl+rotella e adatta larghezza: coordinate indipendenti', async ({ page }) => {
    await selectTool(page, 'r');
    await drag(page, await pagePoint(page, 0, 0.2, 0.2), await pagePoint(page, 0, 0.4, 0.3));
    const attr = () => page.locator('[data-subkind="rect"] path').getAttribute('d');
    const d0 = await attr();
    const z0 = await page.getByTestId('zoom-value').textContent();
    await page.mouse.move(500, 400);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await expect(page.getByTestId('zoom-value')).not.toHaveText(z0!);
    expect(await attr()).toBe(d0);
    await page.locator('[data-action="fit-width"]').click();
    await expect.poll(async () => {
      const box = (await page.locator('[data-page="0"]').boundingBox())!;
      const view = (await page.locator('[data-viewer]').boundingBox())!;
      return Math.abs(box.width - (view.width - 48)) < 24;
    }).toBe(true);
  });
});

test('dimensione del font: il campo si svuota e accetta qualsiasi valore', async ({ page }) => {
  await installFilePicker(page, NAME);
  await page.goto('/');
  await putFile(page, NAME, 'tests/.tmp/sample.pdf');
  await page.reload();
  await openFromPicker(page);
  await selectTool(page, 't');
  const field = page.getByTestId('font-size');
  await field.click();
  await field.press('Control+a');
  await field.press('Backspace');
  await expect(field).toHaveValue('');
  await page.keyboard.type('8');
  await expect(field).toHaveValue('8');
  await field.press('Backspace');
  await page.keyboard.type('24');
  await expect(field).toHaveValue('24');

  const t = await pagePoint(page, 0, 0.2, 0.4);
  await page.mouse.click(t.x, t.y);
  await expect(page.locator('[data-text-editor]')).toBeFocused();
  await page.keyboard.type('Grande');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-kind="text"] text')).toHaveCSS('font-size', '24px');

  // Con il campo svuotato e abbandonato torna l'ultima dimensione valida.
  await field.click();
  await field.press('Control+a');
  await field.press('Backspace');
  await field.blur();
  await expect(field).toHaveValue('24');
});

test('senza File System Access: input file e download', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as any).showOpenFilePicker;
    delete (Window.prototype as any).showOpenFilePicker;
    delete (window as any).showSaveFilePicker;
    delete (Window.prototype as any).showSaveFilePicker;
  });
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Apri un PDF/ }).click();
  await (await chooser).setFiles('tests/.tmp/sample.pdf');
  await expect(page.locator('[data-page="0"] canvas')).toBeVisible();
  await selectTool(page, 'r');
  await drag(page, await pagePoint(page, 0, 0.2, 0.2), await pagePoint(page, 0, 0.4, 0.3));
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  const file = await download;
  expect(file.suggestedFilename()).toBe('sample.pdf');
  expect(readFileSync(await file.path()).subarray(0, 4).toString()).toBe('%PDF');
  await expect(page.getByTestId('dirty')).toHaveAttribute('data-dirty', 'false');
  expect(await counts(page)).toEqual({ shape: 1 });
});
