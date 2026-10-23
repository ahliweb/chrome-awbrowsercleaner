# Design — AW Browser Cleaner

Aset UI/UX dan perencanaan untuk roadmap v1.3–v1.5 (epic #43). Prinsip utamanya: **pembersihan hanya untuk origin persis (`scheme://host:port`) dari URL target, tidak pernah semua URL.**

Desain dibuat di kanvas Claude Design. Folder ini adalah salinan versi-terkontrol yang bisa dilihat tanpa akses ke kanvas tersebut.

## Isi folder

| Path | Isi |
| --- | --- |
| `exports/png/` | Render PNG @2x setiap papan (sumber gambar di bawah). |
| `exports/html/` | HTML statis setiap papan. Buka langsung di browser; link antar layar popup tetap berfungsi. |
| `canvas/` | Sumber asli kanvas: `canvas.json` (tata letak) dan `*.dc.html` (satu file per papan). Butuh runtime Claude Design untuk interaktivitas. |
| `tokens/tokens.json` | Token warna terang/gelap, tipografi, spasi, radius. Sumber kebenaran implementasi tetap `styles.css`. |
| `assets/` | Logo dan font (Inter, JetBrains Mono; SIL OFL 1.1) yang dipakai ekspor. |
| `tools/export-canvas.js` | Skrip untuk membuat ulang `exports/` dari `canvas/`. |

## Gaya visual

![Gaya visual](exports/png/Style.png)

## Layar popup (380 × 600)

| 1 · Popup utama | 2 · Cookie presisi | 3 · Konfirmasi lingkup |
| --- | --- | --- |
| ![Popup utama](exports/png/PopupMain.png) | ![Cookie presisi](exports/png/PopupCookies.png) | ![Konfirmasi](exports/png/PopupConfirm.png) |
| **4 · Hasil & bukti uji** | **5 · Halaman tidak didukung** | **Varian** |
| ![Hasil](exports/png/PopupResult.png) | ![Tidak didukung](exports/png/PopupUnsupported.png) | [Preset Stale assets](exports/png/PopupMain--preset-stale-assets.png) · [Cookie domain-wide](exports/png/PopupCookies--domain-wide.png) |

Alur: Popup utama → (Atur) Cookie presisi → Konfirmasi → Hasil. Halaman `chrome://` membuka layar 5.

## Halaman Options

![Options](exports/png/Options.png)

## Papan perencanaan

| Roadmap | Analisis celah | Standar & regulasi |
| --- | --- | --- |
| ![Roadmap](exports/png/Main.png) | ![Gap](exports/png/Gap.png) | ![Standar](exports/png/Standards.png) |

## Status implementasi

| Layar / fitur | Status | Issue / PR |
| --- | --- | --- |
| Gaya visual, token, font lokal, konfirmasi | Diimplementasikan | PR #44 (menutup #28) |
| Cookie presisi (layar 2) | Desain | #32 |
| HTTP Cache, File Systems | Desain | #29 |
| Session Storage + reload | Desain | #30 |
| Preset (layar 1, Options) | Desain | #34 |
| Shortcut & context menu | Desain | #35 |
| Hasil & bukti uji (layar 4) | Desain | #36 |
| Test Mode (Options) | Desain | #39 |

Angka, domain, dan tanggal di desain adalah data contoh.

## Membuat ulang ekspor

```bash
bun install
node design/tools/export-canvas.js
# atau dengan Chrome tertentu:
CHROME_PATH=/path/to/chrome node design/tools/export-canvas.js
```

Folder `design/` tidak ikut dalam paket ekstensi (`scripts/build-package.js` hanya memaketkan file runtime).
