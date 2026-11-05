// Genera i PNG dell'icona dalla SVG usando Chrome.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const browser = await chromium.launch({ channel: 'chrome' });
for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['icon-maskable', 512, 60]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0;background:${pad ? '#7b6cf6' : 'transparent'};display:grid;place-items:center;height:100vh"><div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${svg}</div>`);
  await page.screenshot({ path: `public/icons/${name}.png`, omitBackground: !pad });
  await page.close();
}
await browser.close();
