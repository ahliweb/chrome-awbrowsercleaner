# Changelog

Semua perubahan penting pada proyek ini didokumentasikan di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan proyek ini menganut [Semantic Versioning](https://semver.org/lang/id/) dengan skema tag `vX.Y.Z`.

## [Unreleased]

### Added
- **Exact-Origin Targeting**: Surgical cleanup strictly targeting `scheme://host:port` instead of hostname (#2).
- **Manual Input Normalization**: Strict origin normalization and validation rejecting unsupported schemes and malformed URLs (#6).
- **Cookie Scope Disclosure & Confirmation**: Explicit warning banner and two-step confirmation flow detailing registrable domain cookie deletion risk (#4).
- **Testing Infrastructure (Bun)**: Comprehensive test suite (64 unit and E2E tests) running natively on Bun runtime (#7).
- **Permission Matrix**: Detailed documentation of feature-to-permission mapping and least privilege rationale (`docs/PERMISSION_MATRIX.md`).

### Changed
- **Permission Minimization**: Removed broad `tabs` and `<all_urls>` host permissions; operating strictly on `browsingData` and `activeTab` (#3).
- **Accurate Storage Terminology**: Corrected "Cache (Service Workers)" label to "Cache Storage", and updated action button to "Clear Site Data" (#10).
- **Accessibility Enhancements**: Added semantic ARIA roles, `aria-live` polite status regions, and WCAG AA compliant focus rings (#10).

## [v1.1.0] - 2026-08-22

### Added
- Initial Chrome Web Store release (published as version `1.1`).
- Domain-targeted browsing data cleaner for active tab.
- Selective deletion checkboxes for Cache, Cookies, Local Storage, IndexedDB, and Service Workers.
- Local-first architecture using native Chrome `browsingData` API without remote tracking.
