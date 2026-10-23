# Changelog

Semua perubahan penting pada proyek ini didokumentasikan di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan proyek ini menganut [Semantic Versioning](https://semver.org/lang/id/) dengan skema tag `vX.Y.Z`.

## [Unreleased]

## [v1.3.0] - 2026-10-23

Rilis ini menuntaskan roadmap v1.3–v1.5 (epic #43): AW Browser Cleaner menjadi alat pembersih **origin persis** untuk pengujian software. Prinsipnya tetap: setiap penghapusan membawa daftar origin `scheme://host:port` yang eksplisit; tidak pernah global, wildcard, atau mode "hapus semua kecuali".

### Added

- **Tipe data baru**: HTTP Cache (`cache`), File Systems/OPFS (`fileSystems`) dan Session Storage (via `chrome.scripting`, hanya di frame yang origin-nya sama dengan target) (#29, #30).
- **Exact Cookie Mode (default)**: hanya cookie host-only dan partitioned (CHIPS) milik origin target yang dihapus; cookie domain bersama dipertahankan kecuali dipilih; nilai cookie tidak pernah dibaca ke UI, laporan, atau storage. Mode domain-wide tetap ada dengan konfirmasi merah (#32).
- **Preset skenario uji**: Log out, Fresh start, Fix stale files, Everything, preset kustom dengan impor/ekspor JSON, preset terakhir per origin (#34).
- **Aksi setelah pembersihan**: hard reload, reload, buka halaman awal, atau tidak sama sekali; tersimpan per preset (#30).
- **Shortcut & context menu**: `Alt+Shift+K` (preset terakhir) dan `Alt+Shift+L` (Log out), menu klik kanan per preset, badge ✓/!; rencana berisiko tidak pernah dijalankan tanpa konfirmasi di popup (#35).
- **Bukti uji**: snapshot sebelum/sesudah, tabel hasil, salin ringkasan, ekspor JSON/Markdown `aw-cleaner-<host>-<YYYYMMDD-HHmmss>`, riwayat 20 pembersihan terakhir tanpa nilai sensitif (#36).
- **Rentang waktu**: 15 menit, 1 jam, atau sejak sesi uji dimulai; selalu digabung dengan origin target (#37).
- **Kumpulan origin eksplisit**: hingga 10 origin persis per pembersihan dengan peringatan untuk origin IdP (#38).
- **Test Mode** (nonaktif secara default): halaman `localhost`/`127.0.0.1` dapat memicu preset untuk origin-nya sendiri via `runtime.onMessageExternal`; panduan otomasi CDP/Playwright/Cypress dengan contoh yang diuji di CI (#39).
- **Halaman Options**: preset, izin per origin (dengan Cabut), Test Mode, riwayat & bukti, sesi uji, shortcut (#47).
- **Layar halaman tidak didukung**: penjelasan skema, input target dengan pratinjau normalisasi, 3 origin terakhir (#48).
- **Target Edge Add-ons** (`bun scripts/build-package.js --target=edge`) dan ADR untuk Firefox serta Incognito (#41).
- Dokumentasi: QA playbook EN/ID, data dictionary, arsitektur, CONTRIBUTING, AGENTS, desain papan rentang waktu dan kumpulan origin (#42).

### Changed

- **Gaya visual profesional**: tema terang netral yang mengikuti tema sistem (mode gelap otomatis), satu aksen biru dari logo, label sentence case, kontras WCAG AA, font lokal Inter dan JetBrains Mono (SIL OFL 1.1) tanpa CDN (#28, PR #44).
- **Lingkup selalu terlihat**: catatan hijau "hanya origin ini" atau peringatan kuning untuk cookie domain-wide; konfirmasi dirender dari rencana yang benar-benar dieksekusi (`describePlan`) (#27, #33).
- **Arsitektur**: logika pembersihan dipindahkan ke modul murni `cleanup-core.js` sebagai satu-satunya gerbang penghapusan; semua file runtime menjadi ES module (#27).
- **Izin**: `activeTab`, `browsingData`, `contextMenus`, `cookies`, `scripting`, `storage` — tanpa peringatan instalasi baru; akses host hanya dari `activeTab` atau izin opsional per origin yang diminta saat dibutuhkan. Tanpa `host_permissions`.
- `minimum_chrome_version` 120.

### Security

- **Scope Guard**: origin kosong, wildcard (termasuk `%2A` yang dihasilkan parser URL Chrome), path, `excludeOrigins`, lebih dari 10 origin, tipe data terlarang, dan `since` di masa depan ditolak sebelum API apa pun dipanggil; ESLint melarang `chrome.browsingData`/`chrome.cookies.remove` di luar `cleanup-core.js`; uji fuzz 4000 input (#33).
- **Supply chain**: action dipin ke SHA, izin workflow minimal per job, attestation provenance SLSA, SBOM CycloneDX, CodeQL, OpenSSF Scorecard, Dependabot, upload Chrome Web Store di balik environment terproteksi (#40).
- `check:permissions` memastikan setiap izin manifest terdokumentasi di permission matrix dan kebijakan privasi (#42).

### Fixed

- **Incognito**: manifest memakai `"incognito": "split"`. Dengan mode bawaan (*spanning*), pembersihan dari tab Incognito justru menghapus data origin yang sama di profil reguler dan membiarkan data Incognito; kini setiap profil hanya membersihkan dirinya sendiri (diverifikasi E2E dua arah) (#41).
- E2E tidak lagi lolos diam-diam: CI gagal bila browser/ekstensi tidak termuat; E2E memverifikasi penghapusan per tipe data dan origin, dengan origin canary (#26).
- E2E memakai Chrome for Testing stable dan beta, Bun dipin (`.bun-version`) (#31).
- Label **Select All** sinkron dengan status checkbox; pesan sukses tidak hilang setelah 3 detik; panel konfirmasi tanpa `innerHTML` (#28).

## [v1.2.0] - 2026-09-20

### Added

- **Exact-Origin Targeting**: Surgical cleanup strictly targeting `scheme://host:port` instead of hostname (#2).
- **Manual Input Normalization**: Strict origin normalization and validation rejecting unsupported schemes and malformed URLs (#6).
- **Cookie Scope Disclosure & Confirmation**: Explicit warning banner and two-step confirmation flow detailing registrable domain cookie deletion risk (#4).
- **Testing Infrastructure (Bun)**: Comprehensive test suite (85 unit and E2E tests) running natively on Bun runtime (#7).
- **Permission Matrix**: Detailed documentation of feature-to-permission mapping and least privilege rationale (`docs/PERMISSION_MATRIX.md`).
- **Deterministic Packaging & CI/CD**: Automated packaging and release verification workflows (`scripts/build-package.js`, `scripts/validate-package.js`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`) (#8).
- **Bilingual Localization**: Native English (`en`) and Indonesian (`id`) locale support via Chrome `_locales` with 100% key parity (#11).
- **Chrome Web Store Automated Upload**: `scripts/upload-cws.js` for OAuth2-based automated upload to Chrome Web Store Developer Dashboard, integrated into release CI workflow.
- **CWS Setup Wizard**: Interactive `scripts/setup-cws-credentials.js` for automated OAuth2 credential retrieval and GitHub Secrets provisioning.

### Changed

- **Permission Minimization**: Removed broad `tabs` and `<all_urls>` host permissions; operating strictly on `browsingData` and `activeTab` (#3).
- **Accurate Storage Terminology**: Corrected "Cache (Service Workers)" label to "Cache Storage", and updated action button to "Clear Site Data" (#10).
- **Accessibility Enhancements**: Added semantic ARIA roles, `aria-live` polite status regions, and WCAG AA compliant focus rings (#10).
- **Store & Privacy Documentation**: Synchronized public privacy policy, store listing, and security policies with zero remote tracking and minimal permissions (#9, #13).

## [v1.1.0] - 2026-08-22

### Added

- Initial Chrome Web Store release (published as version `1.1`).
- Domain-targeted browsing data cleaner for active tab.
- Selective deletion checkboxes for Cache, Cookies, Local Storage, IndexedDB, and Service Workers.
- Local-first architecture using native Chrome `browsingData` API without remote tracking.
