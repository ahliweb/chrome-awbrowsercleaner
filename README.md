# AW Browser Cleaner

Powered by AhliWeb.com

A lightweight, privacy-focused Chrome Extension that allows you to surgically clean browsing data (Cookies, Local Storage, IndexedDB, etc.) for the **specific origin** you are currently visiting.

Unlike the standard Chrome "Clear Browsing Data" dialog which often clears data for *all* sites or time ranges, this tool focuses on the *active tab's* exact origin (`scheme://host:port`), ensuring you don't lose sessions on other important sites.

## Install from Chrome Web Store

[**AW Browser Cleaner** on Chrome Web Store](https://chromewebstore.google.com/detail/aw-browser-cleaner/njflkejajbifofomeebakgebgcincepf)

## Screenshots

| Light (EN) | Konfirmasi (ID) | Dark (EN) |
| --- | --- | --- |
| ![Popup, light theme](docs/screenshots/popup-light-en.png) | ![Confirmation panel in Indonesian](docs/screenshots/popup-confirm-id.png) | ![Popup, dark theme](docs/screenshots/popup-dark-en.png) |

## Features

- **Origin-Specific Cleaning:** Automatically detects the current tab's exact origin.
- **Granular Control:** Select exactly what to clear:
  - Cache Storage
  - Cookies (with registrable domain disclosure)
  - Local Storage
  - IndexedDB
  - Service Workers
- **Safe & Local:** All operations are performed locally using Chrome's native `browsingData` API. No data is sent to external servers.
- **Strict Input Validation:** Normalizes and validates URLs, hostnames, and IP addresses.
- **Bilingual UI:** English and Indonesian supported out of the box.
- **Minimal Permissions:** Only `browsingData` and `activeTab` — no background tracking.

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top right).
4. Click **Load unpacked**.
5. Select the directory containing this project (`chrome-awbrowsercleaner`).

## Usage

1. Navigate to the website you want to clean (e.g., `https://example.com`).
2. Click the **AW Browser Cleaner** icon in the Chrome toolbar.
3. The "Target Origin" field will auto-fill with the current origin.
    - *Tip:* You can manually edit this field if you want to clean a different origin.
4. Select the data types you wish to remove (or use "Select All").
5. Click **Clear Site Data**.
    - If Cookies are selected, confirm after reviewing the domain scope disclosure.

## Development

### Prerequisites

- [Bun](https://bun.sh/) runtime — the exact version is pinned in `.bun-version` (CI and release use the same file).
- No Node.js, npm, or pnpm required.

### Setup

```bash
git clone https://github.com/ahliweb/chrome-awbrowsercleaner.git
cd chrome-awbrowsercleaner
bun install
```

### Available Scripts

| Script | Description |
| ------ | ----------- |
| `bun run test` | Run unit tests, then E2E tests |
| `bun run test:unit` | Run unit tests only |
| `bun run test:e2e` | Run E2E tests only (needs Chrome for Testing or Chromium, see below) |
| `bun run lint` | Run ESLint |
| `bun run check:version` | Verify version synchronization across `manifest.json`, `package.json`, and `VERSION` |
| `bun run build:package` | Build deterministic release ZIP with SHA-256 checksum |
| `bun run validate:package` | Validate release ZIP contents and integrity |
| `bun run upload:cws` | Upload release package to Chrome Web Store (requires API credentials) |
| `bun run setup:cws` | Interactive wizard to configure Chrome Web Store API credentials |

### Running E2E tests

The E2E suite loads the unpacked extension into a real browser and proves that data is actually deleted for the target origin only. It drives the popup, then reads cookies, localStorage, sessionStorage, IndexedDB, Cache Storage, Service Workers, OPFS and the HTTP cache on several fixture origins (`a.localtest.me`, `b.localtest.me`, a port variant and a `127.0.0.1` canary that must stay intact).

Branded Google Chrome 137+ ignores extension-loading flags, so use **Chrome for Testing** or Chromium:

```bash
bunx @puppeteer/browsers install chrome@stable --path ~/.cache/chrome-for-testing
AW_CHROME_PATH=/path/printed/above/chrome bun run test:e2e
```

- With `CI=true`, a missing browser or an extension that fails to load **fails** the run; it never passes silently.
- Locally, without a browser, the suites are skipped with a visible banner.
- The deletion matrix (data type × origin × result) is printed and written to `test-artifacts/e2e-matrix.md`; screenshots and console logs of failing tests are saved in `test-artifacts/`.

### CI/CD

- **CI** (`.github/workflows/ci.yml`): Runs on push to `main` and PRs. The `validate` job runs the version check, ESLint, unit tests and package build/validation. The `e2e` job runs the E2E suite on Chrome for Testing **stable** and **beta** (beta is non-blocking) and publishes the deletion matrix to the job summary.
- **Release** (`.github/workflows/release.yml`): Triggered by pushing a `v*` tag. Builds, validates, attests build provenance, attaches an SBOM, creates the GitHub Release and uploads to the Chrome Web Store behind the protected `chrome-web-store` environment. See [docs/SUPPLY_CHAIN.md](docs/SUPPLY_CHAIN.md).
- **Security**: CodeQL, OpenSSF Scorecard and Dependabot; all actions are pinned to commit SHAs.

### Chrome Web Store Automated Upload

See [docs/chrome-web-store/API_UPLOAD_SETUP.md](docs/chrome-web-store/API_UPLOAD_SETUP.md) for step-by-step setup of automated Chrome Web Store publishing via OAuth2 API.

Quick start:

```bash
bun run setup:cws
```

## Permissions

AW Browser Cleaner strictly adheres to the principle of least privilege. See [docs/PERMISSION_MATRIX.md](docs/PERMISSION_MATRIX.md) for full details.

- `browsingData`: Required to selectively remove site data via `chrome.browsingData.remove`.
- `activeTab`: Ephemeral access to the active tab's URL when the user opens the popup.

*No background tab tracking (`tabs`) or persistent host permissions (`<all_urls>`) are requested.*

## Localization

The extension supports English (`en`) and Indonesian (`id`) out of the box.

To add a new language:

1. Create a new directory under `_locales/<language_code>/` (e.g., `_locales/es/messages.json`).
2. Copy `_locales/en/messages.json` into the new folder and translate each `"message"` property.
3. Keep message keys unchanged so popup elements map automatically.
4. Run `bun test` to verify parity across all locales.

## Documentation

| Document | Description |
| -------- | ----------- |
| [CHANGELOG.md](CHANGELOG.md) | Release history and version changes |
| [PRIVACY.md](PRIVACY.md) | Repository privacy policy |
| [SECURITY.md](SECURITY.md) | Security policy and vulnerability reporting |
| [docs/PERMISSION_MATRIX.md](docs/PERMISSION_MATRIX.md) | Feature-to-permission mapping |
| [docs/threat-model.md](docs/threat-model.md) | Extension threat model |
| [docs/chrome-web-store/RELEASE_CHECKLIST.md](docs/chrome-web-store/RELEASE_CHECKLIST.md) | Release checklist template |
| [docs/chrome-web-store/API_UPLOAD_SETUP.md](docs/chrome-web-store/API_UPLOAD_SETUP.md) | CWS API automated upload setup guide |
| [docs/chrome-web-store/STORE_LISTING.md](docs/chrome-web-store/STORE_LISTING.md) | Store listing draft |
| [docs/chrome-web-store/PUBLIC_PRIVACY_POLICY.md](docs/chrome-web-store/PUBLIC_PRIVACY_POLICY.md) | Public privacy policy for CWS |

## License

See the [LICENSE](LICENSE) file for details.
