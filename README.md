# HRVCAD

Aplicație desktop (Windows + macOS) pentru proiectarea 3D a sistemelor de ventilare cu recuperare de căldură în clădiri rezidențiale — Academia Romstal.

Flux: plan (DWG/DXF, PDF, imagine) → model clădire 3D → necesar de căldură și debite → trasare tubulatură cu calcul în timp real → memoriu, planșe, listă de materiale.

## Stare

| # | Etapă | Stare |
|---|---|---|
| 0 | Schelet: Electron + React + Three.js, ribbon tip Office/AutoCAD, linie de comandă, RO/EN, fișier `.hrv`, undo/redo | ✅ |
| 1 | Import DWG/DXF (LibreDWG WASM), imagine, PDF; calibrare scară, mutare, rotire, măsurare, agățare, orto | ✅ |
| 2 | Pereți cu straturi, TRIM/EXTEND, grip-uri, uși/ferestre, camere detectate automat, planșee, acoperiș cu pantă pe laturi | ✅ |
| 3 | Necesar de căldură simplificat SR EN 12831-1, localități (zone climatice) | ✅ (date climatice de verificat) |
| 4 | Debite DIN 1946-6 / I5-2022 / SR EN 16798-1 / personalizat + echilibrare | ✅ (valori I5 / EN de completat) |
| 5 | Catalog editabil: recuperatoare, tubulatură, guri, distribuitoare | ✅ (produse generice) |
| 6 | Recuperator, distribuitoare, guri, tubulatură + calcul rețea (Colebrook, pierderi locale, curbă ventilator, reglaj) + mod strict/consultativ | ✅ |
| 7 | Temperaturi, îngheț, izolație/condens, zgomot estimat, economii anuale | ✅ (estimări) |
| 8 | Memoriu PDF, planșe PDF, listă materiale XLSX, export DXF | ✅ |
| 9 | Asistent AI | ⏳ decizie ulterioară |

Toate valorile normative sau de catalog care nu au putut fi verificate sunt marcate „neverificat” în aplicație și în memoriu.

## Dezvoltare

```bash
npm install
npm start          # build + pornește aplicația Electron
npm run web        # build + rulează interfața în browser la http://localhost:5173
npm test           # teste unitare (calcule geometrice)
npm run dist:win   # installer Windows (.exe) în release/
npm run dist:mac   # imagine macOS (.dmg) în release/
```

GitHub Actions construiește automat installerele Windows și macOS la fiecare push pe `main` (tab-ul **Actions** → ultimul run → **Artifacts**).

## Structură

```
src/main/            Electron: fereastră, protocol app://, dialoguri fișiere
src/renderer/
  core/              model de date, store + undo, comenzi, geometrie, fișier proiect
  import/            DWG/DXF (LibreDWG), imagini, PDF (pdf.js)
  tools/             unelte interactive (calibrare, mută, rotește, distanță)
  viewport/          motor Three.js 2D/3D, agățare, overlay
  ui/                ribbon, meniu Fișier, panouri, linie de comandă, bară de stare
  i18n/              ro.ts (sursă), en.ts
tests/               teste node:test
```

## Comenzi (linia de comandă)

Ca în AutoCAD: tastați oriunde și textul ajunge în linia de comandă. Enter sau Space execută, Enter gol repetă ultima comandă, Esc anulează.

`IMPORT` / `DWG` · `IMG` · `PDF` · `CAL` (calibrare) · `M` (mută) · `RO` (rotește) · `DIST` · `ZE` (zoom extins) · `2D` · `3D` · `NIVEL` · `U` (anulează) · `LANG`
Taste: F3 agățare · F7 grilă · F8 orto · Ctrl/⌘+S/O/N/Z/Y · rotiță = zoom · buton mijloc = pan · dublu-click mijloc = zoom extins.

## Licențe terțe

Importul DWG folosește [LibreDWG](https://www.gnu.org/software/libredwg/) prin `@mlightcad/libredwg-web`, licențiat **GPL-3.0**. Uzul strict intern în companie în general nu este considerat distribuire în sensul GPL (de confirmat cu departamentul juridic); dacă aplicația va fi distribuită în afara companiei, modulul DWG trebuie fie înlocuit (ex. ODA File Converter apelat extern), fie aplicația publicată sub o licență compatibilă GPL. Importul DXF poate fi decuplat de LibreDWG dacă e nevoie.
