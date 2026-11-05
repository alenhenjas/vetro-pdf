# Third-party notices

The MIT license in [LICENSE](LICENSE) covers the Vetro PDF source code. The components below keep their own licenses.

## Fonts

All fonts in `public/fonts` are distributed under the [SIL Open Font License 1.1](https://openfontlicense.org). The full license text is in [public/fonts/OFL.txt](public/fonts/OFL.txt).

| Family | Copyright |
| --- | --- |
| Inter | Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) |
| Roboto | Copyright 2011 The Roboto Project Authors (https://github.com/googlefonts/roboto-classic) |
| Nunito | Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito) |
| Lora | Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic), with Reserved Font Name "Lora" |
| Merriweather | Copyright 2024 The Merriweather Project Authors (https://github.com/EbenSorkin/Merriweather4) with Reserved Font Name "Merriweather" |
| JetBrains Mono | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) |
| Caveat | Copyright 2014 The Caveat Project Authors (https://github.com/googlefonts/caveat) |
| Patrick Hand | Copyright (c) 2012 Patrick Wagesreiter (mail@patrickwagesreiter.at) |

Inter, Caveat and Patrick Hand were modified: `scripts/normalize-fonts.mjs` pads their `glyf` table so that fontkit produces valid subsets. No glyph outlines were changed. Lora and Merriweather are distributed unmodified.

## Libraries

| Library | License |
| --- | --- |
| [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`), including its CMaps, standard fonts and WebAssembly files | Apache-2.0 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | MIT |
| [@pdf-lib/fontkit](https://github.com/Hopding/fontkit) | MIT |
| [perfect-freehand](https://github.com/steveruizok/perfect-freehand) | MIT |
| [Zustand](https://github.com/pmndrs/zustand) | MIT |
| [React](https://github.com/facebook/react) | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) (`lucide-react`) | ISC |
