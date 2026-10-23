# Changelog

Semua perubahan penting pada proyek ini didokumentasikan di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan proyek ini menganut [Semantic Versioning](https://semver.org/lang/id/) dengan skema tag `vX.Y.Z`.

## [Unreleased]

### Changed

- **Gaya visual profesional**: popup didesain ulang dengan tema terang netral yang mengikuti tema sistem (mode gelap otomatis via `prefers-color-scheme`), satu aksen biru dari logo, label sentence case, dan kontras teks WCAG AA.
- **Lingkup selalu terlihat**: catatan lingkup hijau "hanya origin ini" berubah menjadi peringatan kuning saat Cookies dipilih (registrable domain); tag `domain-wide` pada Cookies menggantikan banner peringatan yang selalu tampil.
- **Panel konfirmasi**: menggantikan form saat dibuka (popup tetap di bawah 600 px), menampilkan daftar "Akan dihapus" dan "Tidak disentuh"; tombol merah hanya untuk pembersihan yang menyertakan cookie domain; `Esc` membatalkan.
- **Data dikelompokkan**: Sesi, Storage, Cache & offline, dengan jumlah tipe terpilih.
- **Font lokal**: Inter dan JetBrains Mono (variable, subset Latin, SIL OFL 1.1) dipaketkan di `fonts/` tanpa CDN.

### Fixed

- Label **Select All** sinkron dengan status checkbox saat popup dibuka dan setiap perubahan (#28).
- Timer pesan status dibatalkan sebelum pesan baru; pesan sukses tidak lagi hilang setelah 3 detik (#28).
- Panel konfirmasi dibangun dengan `textContent`/`createElement`, tanpa `innerHTML` (#28).

### Changed

- **Gaya visual profesional**: popup didesain ulang dengan tema terang netral yang mengikuti tema sistem (mode gelap otomatis via `prefers-color-scheme`), satu aksen biru dari logo, label sentence case, dan kontras teks WCAG AA.
- **Lingkup selalu terlihat**: catatan lingkup hijau "hanya origin ini" berubah menjadi peringatan kuning saat Cookies dipilih (registrable domain); tag `domain-wide` pada Cookies menggantikan banner peringatan yang selalu tampil.
- **Panel konfirmasi**: menggantikan form saat dibuka (popup tetap < 600 px), menampilkan daftar "Akan dihapus" dan "Tidak disentuh"; tombol destruktif merah hanya untuk pembersihan yang menyertakan cookie domain; `Esc` membatalkan.
- **Data dikelompokkan**: Sesi, Storage, Cache & offline, dengan jumlah tipe terpilih.
- **Font lokal**: Inter dan JetBrains Mono (variable, subset Latin, SIL OFL 1.1) dipaketkan di `fonts/` tanpa CDN.

### Fixed

- Label **Select All** kini sinkron dengan status checkbox saat popup dibuka dan setiap perubahan (sebelumnya klik pertama justru menghapus semua centang).
- Timer pesan status dibatalkan sebelum pesan baru; pesan sukses tidak lagi hilang setelah 3 detik.
- Panel konfirmasi dibangun dengan `textContent`/`createElement`, tanpa `innerHTML`.

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
