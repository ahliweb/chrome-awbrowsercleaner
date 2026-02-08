# AW Browser Cleaner

Powered by AhliWeb.com

A lightweight, privacy-focused Chrome Extension that allows you to surgically clean browsing data (Cookies, Local Storage, IndexedDB, etc.) for the **specific domain** you are currently visiting.

Unlike the standard Chrome "Clear Browsing Data" dialog which often clears data for *all* sites or time ranges, this tool focuses on the *active tab's* domain, ensuring you don't lose sessions on other important sites.

## Features

- **Domain-Specific Cleaning:** Automatically detects the current tab's domain.
- **Granular Control:** Select exactly what to clear:
  - Cache (Service Workers & Cache Storage)
  - Cookies
  - Local Storage
  - IndexedDB
  - Service Workers
- **Safe & Local:** All operations are performed locally using Chrome's native `browsingData` API. No data is sent to external servers.

## Installation

Since this is a developer/unpacked extension:

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top right).
4. Click **Load unpacked**.
5. Select the directory containing this project (`chrome-awbrowsercleaner`).

## Usage

1. Navigate to the website you want to clean (e.g., `example.com`).
2. Click the **AW Browser Cleaner** icon in the Chrome toolbar.
3. The "Target Domain" field will auto-fill with the current hostname.
    - *Tip:* You can manually edit this field if you want to clean a different domain.
4. Select the data types you wish to remove (or use "Select All").
5. Click **Clear Data**.

## Permissions

The extension requires the following permissions to function:

- `browsingData`: To execute the cleaning commands.
- `activeTab`: To detect the URL of the current tab.
- `tabs`: To query tab information.
- `host_permissions` (`<all_urls>`): To allow clearing data for any website you visit.

## License

See the [LICENSE](LICENSE) file for details.
