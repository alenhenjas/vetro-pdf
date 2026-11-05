// Scarica una sola volta i TTF statici OFL in public/fonts (i file vengono poi inclusi nel progetto).
// Dopo il download eseguire scripts/normalize-fonts.mjs.
import { writeFile } from 'node:fs/promises';
const FAMILIES = {
  Inter: '400,700,400i,700i', Roboto: '400,700,400i,700i', Lora: '400,700,400i,700i',
  Merriweather: '400,700,400i,700i', 'JetBrains Mono': '400,700,400i,700i',
  Caveat: '400,700', 'Patrick Hand': '400', Nunito: '400,700,400i,700i',
};
for (const [family, styles] of Object.entries(FAMILIES)) {
  const url = `https://fonts.googleapis.com/css?family=${family.replace(/ /g, '+')}:${styles}&subset=latin,latin-ext,greek,cyrillic,vietnamese`;
  const css = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/4.0' } })).text();
  const re = /font-style: (\w+);\s*font-weight: (\d+);[^}]*?src: url\((.+?\.ttf)\)/g;
  for (const m of css.matchAll(re)) {
    const slug = family.toLowerCase().replace(/ /g, '-');
    const name = `${slug}-${m[2]}${m[1] === 'italic' ? 'i' : ''}.ttf`;
    const buf = Buffer.from(await (await fetch(m[3])).arrayBuffer());
    await writeFile(`public/fonts/${name}`, buf);
    console.log(name, buf.length);
  }
}
