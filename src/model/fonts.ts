export interface FontInfo {
  family: string;
  slug: string;
  hasBold: boolean;
  hasItalic: boolean;
  category: string;
}

export const FONTS: FontInfo[] = [
  { family: 'Inter', slug: 'inter', hasBold: true, hasItalic: true, category: 'Sans' },
  { family: 'Roboto', slug: 'roboto', hasBold: true, hasItalic: true, category: 'Sans' },
  { family: 'Nunito', slug: 'nunito', hasBold: true, hasItalic: true, category: 'Sans' },
  { family: 'Lora', slug: 'lora', hasBold: true, hasItalic: true, category: 'Serif' },
  { family: 'Merriweather', slug: 'merriweather', hasBold: true, hasItalic: true, category: 'Serif' },
  { family: 'JetBrains Mono', slug: 'jetbrains-mono', hasBold: true, hasItalic: true, category: 'Mono' },
  { family: 'Caveat', slug: 'caveat', hasBold: true, hasItalic: false, category: 'Manoscritto' },
  { family: 'Patrick Hand', slug: 'patrick-hand', hasBold: false, hasItalic: false, category: 'Manoscritto' },
];

export const FALLBACK_FONT = 'Inter';

export function fontInfo(family: string): FontInfo {
  return FONTS.find((f) => f.family === family) ?? FONTS[0];
}

/** File TTF da incorporare e stili da simulare quando la famiglia non ha la variante. */
export function fontFace(family: string, bold: boolean, italic: boolean) {
  const info = fontInfo(family);
  const realBold = bold && info.hasBold;
  const realItalic = italic && info.hasItalic;
  return {
    key: `${info.slug}-${realBold ? 700 : 400}${realItalic ? 'i' : ''}`,
    fakeBold: bold && !realBold,
    fakeItalic: italic && !realItalic,
  };
}

/** Disattiva legature e alternative contestuali: schermo e PDF devono avere gli stessi glifi. */
export const FONT_FEATURES = { liga: false, clig: false, calt: false, dlig: false };
export const CSS_FONT_FEATURES = '"liga" 0, "clig" 0, "calt" 0, "dlig" 0';

export const TEXT_PADDING = 4;
