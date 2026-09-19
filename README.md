# AW Browser Cleaner

Powered by AhliWeb.com

A lightweight, privacy-focused Chrome Extension that allows you to surgically clean browsing data (Cookies, Local Storage, IndexedDB, etc.) for the **specific origin** you are currently visiting.

Unlike the standard Chrome "Clear Browsing Data" dialog which often clears data for *all* sites or time ranges, this tool focuses on the *active tab's* exact origin (`scheme://host:port`), ensuring you don't lose sessions on other important sites.

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

## Installation

Since this is a developer/unpacked extension:

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

## Permissions

AW Browser Cleaner strictly adheres to the principle of least privilege. See [docs/PERMISSION_MATRIX.md](docs/PERMISSION_MATRIX.md) for full details.

- `browsingData`: Required to selectively remove site data via `chrome.browsingData.remove`.
- `activeTab`: Ephemeral access to the active tab's URL when the user opens the popup.

*No background tab tracking (`tabs`) or persistent host permissions (`<all_urls>`) are requested.*

## License

See the [LICENSE](LICENSE) file for details.
