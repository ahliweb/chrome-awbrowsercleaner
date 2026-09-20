# AW Browser Cleaner

Powered by AhliWeb.com

A lightweight, privacy-focused Chrome Extension that allows you to surgically clean browsing data (Cookies, Local Storage, IndexedDB, etc.) for the **specific origin** you are currently visiting.

Unlike the standard Chrome "Clear Browsing Data" dialog which often clears data for *all* sites or time ranges, this tool focuses on the *active tab's* exact origin (`scheme://host:port`), ensuring you don't lose sessions on other important sites.

## Install from Chrome Web Store

[**AW Browser Cleaner** on Chrome Web Store](https://chromewebstore.google.com/detail/aw-browser-cleaner/njflkejajbifofomeebakgebgcincepf)

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

- [Bun](https://bun.sh/) runtime (v1.4+) — used for package management, test runner, and script execution.
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
| `bun test` | Run all 85 unit and E2E tests |
| `bun run test:unit` | Run unit tests only |
| `bun run test:e2e` | Run E2E tests only |
| `bun run lint` | Run ESLint |
| `bun run check:version` | Verify version synchronization across `manifest.json`, `package.json`, and `VERSION` |
| `bun run build:package` | Build deterministic release ZIP with SHA-256 checksum |
| `bun run validate:package` | Validate release ZIP contents and integrity |
| `bun run upload:cws` | Upload release package to Chrome Web Store (requires API credentials) |
| `bun run setup:cws` | Interactive wizard to configure Chrome Web Store API credentials |

### CI/CD

- **CI** (`.github/workflows/ci.yml`): Runs on push to `main` and PRs. Executes lint, tests, version check, and package build/validation.
- **Release** (`.github/workflows/release.yml`): Triggered by pushing a `v*` tag. Builds, validates, creates GitHub Release with artifacts, and uploads to Chrome Web Store.

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
