import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

/**
 * Il selettore file nativo non è automatizzabile: lo si sostituisce con file reali
 * dell'Origin Private File System, che offrono la stessa FileSystemFileHandle
 * (createWritable compreso), quindi il percorso di salvataggio è quello vero.
 */
export async function installFilePicker(page: Page, fileName: string) {
  await page.addInitScript((name) => {
    (window as any).__pickName = name;
    (window as any).showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      return [await root.getFileHandle((window as any).__pickName)];
    };
    (window as any).showSaveFilePicker = async (o: { suggestedName: string }) => {
      const root = await navigator.storage.getDirectory();
      return root.getFileHandle(o.suggestedName, { create: true });
    };
  }, fileName);
}

export async function putFile(page: Page, name: string, path: string) {
  const base64 = readFileSync(path).toString('base64');
  await page.evaluate(async ({ name, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name, { create: true });
    const w = await handle.createWritable();
    await w.write(bytes);
    await w.close();
  }, { name, base64 });
}

export async function getFile(page: Page, name: string): Promise<Buffer> {
  const base64 = await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(name)).getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }, name);
  return Buffer.from(base64, 'base64');
}

export async function openFromPicker(page: Page) {
  await page.getByRole('button', { name: /Apri un PDF/ }).click();
  await expect(page.locator('[data-page="0"] canvas')).toBeVisible();
}

export async function reopen(page: Page) {
  await page.reload();
  await openFromPicker(page);
}

export async function pagePoint(page: Page, index: number, xFrac: number, yFrac: number) {
  const box = (await page.locator(`[data-page="${index}"] .page-canvas`).boundingBox())!;
  return { x: box.x + box.width * xFrac, y: box.y + box.height * yFrac };
}

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

export async function selectTool(page: Page, key: string) {
  await page.keyboard.press('Escape');
  await page.keyboard.press(key);
}

export async function pasteImage(page: Page, color = '#2a9d8f', size = 120) {
  await page.evaluate(async ({ color, size }) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = Math.round(size * 0.75);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(10, 10, 30, 30);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { color, size });
}

export const counts = (page: Page, index = 0) => page.evaluate((index) => {
  const root = document.querySelector(`[data-page="${index}"]`)!;
  const out: Record<string, number> = {};
  root.querySelectorAll('[data-kind]').forEach((el) => {
    const k = (el as HTMLElement).dataset.kind!;
    out[k] = (out[k] ?? 0) + 1;
  });
  return out;
}, index);

export async function save(page: Page) {
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty')).toHaveAttribute('data-dirty', 'false');
  await expect(page.locator('[data-toast="success"]').last()).toBeVisible();
}
