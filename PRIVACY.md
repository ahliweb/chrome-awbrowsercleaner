# Privacy Policy — AW Browser Cleaner

This repository document describes the intended privacy behavior of the packaged AW Browser Cleaner extension. The public Chrome Web Store privacy-policy page must remain synchronized with the final shipped release.

Public policy URL: <https://ahliweb.com/privacy-browser-ext/>

## Summary

AW Browser Cleaner is designed as a local-first browser utility. **All processing is local. Nothing is ever sent off the device.**

The extension does not:

- collect personal information for AhliWeb,
- transmit browsing history to AhliWeb,
- transmit website content to AhliWeb,
- make network requests of its own (no analytics, no advertising tracking, no remote logging),
- sell user data,
- require an AhliWeb account.

Cleanup actions are performed locally through Chrome extension APIs after a user explicitly initiates them (popup, keyboard shortcut or context menu), or, when the user has turned on Test Mode, after a message from an allow-listed local page.

## Information processed locally

To perform its function, the extension may process locally:

- the URL/origin of the active tab,
- a target manually entered by the user,
- the data-type selections chosen by the user,
- counts of what an origin stores (for the before/after evidence report).

This information is used to determine what site data should be removed and is not transmitted to AhliWeb.

## Information stored by the extension

The extension keeps a small amount of its own data in `chrome.storage`. Keys are listed in [docs/data-dictionary.md](docs/data-dictionary.md).

| What | Where | Key | Notes |
| --- | --- | --- | --- |
| Custom presets | `chrome.storage.sync` | `aw.preset.<id>` | Name, data types, cookie mode, after-action, start path, optional exact origins and cookie names to keep. At most 50. |
| Last used preset | `chrome.storage.sync` | `aw.lastPreset` | A preset id. |
| Last preset per origin | `chrome.storage.local` | `aw.lastPresetByOrigin` | Pairs of origin and preset id, up to 100. |
| Recent origins | `chrome.storage.local` | `aw.recentOrigins` | The last 3 origins only (`scheme://host:port`), never paths or query strings. |
| History summaries | `chrome.storage.local` | `aw.history` | Up to 20 entries: time, origins, preset id, duration, success flag. |
| History switch | `chrome.storage.local` | `aw.historyEnabled` | On by default. |
| Test Mode settings | `chrome.storage.local` | `aw.testMode` | On/off and the allow-list of origins (off by default). |
| Permission grant log | `chrome.storage.local` | `aw.permissionGrants` | Origin, kind and time of per-origin cookie access the user granted. |
| Test session start | `chrome.storage.session` | `aw.sessionStart` | One timestamp; Chrome discards it when the browser closes. |
| Pending confirmation | `chrome.storage.session` | `aw.pendingConfirmation` | Preset id and origin for up to 60 seconds; discarded when the browser closes. |

Things the extension never stores or exports:

- **Cookie values.** Cookie metadata (name, domain, flags) is shown only to let you choose what to keep; the UI states "Cookie values are never shown".
- **Storage contents** (Local Storage, Session Storage, IndexedDB, Cache Storage, OPFS files).
- **Full URLs, page paths or page content.**
- Anything about sites other than the origins you cleaned.

`chrome.storage.sync` is handled by Chrome: if you are signed in to Chrome with sync enabled, Chrome may copy custom presets and the last preset id to your other devices through your Google account. AhliWeb does not receive this data and has no access to it.

### Snapshots and evidence reports

Before and after a cleanup the extension can count what an origin stores. These snapshots and the evidence report (Copy summary, Export JSON, Export Markdown) contain **counts and metadata only**. The report itself states "No cookie values or storage contents". A guard (`assertNoSensitiveValues`) refuses to build a report that contains a `value`, `cookieValue`, `storageValue`, `items` or `entries` key. Reports are created on your device and saved only when you export them; the extension never uploads them.

### Your control over stored data

- **History can be turned off** (Options → History & evidence). While it is off, no history entries and no recent origins are recorded.
- **History can be cleared**, and recent origins can be cleared separately, in the same section.
- Custom presets can be deleted or exported in Options.
- Per-origin cookie access can be revoked in Options → Per-origin permissions.
- Uninstalling the extension removes its local storage. Presets kept in Chrome sync can be removed by deleting them in Options before uninstalling.

## Site data affected

Depending on the user's selections, AW Browser Cleaner can remove, for the exact origin selected:

- Cookies
- Session Storage
- Local Storage
- IndexedDB
- File Systems (OPFS)
- HTTP cache
- Cache Storage
- Service Workers

It never touches browsing history, downloads, saved passwords, form data, or data of any other site. The release documentation and UI must not claim support for a data type that is not implemented.

## Cookie scope

Cookies have different scope semantics from origin-scoped storage. A cookie may be associated with a registrable domain and shared with related subdomains, and cookies are not isolated by port (RFC 6265 §8.5).

The default **Exact Cookie Mode** removes only the cookies that apply to the selected origin and keeps shared domain cookies unless the user selects them. A domain-wide mode exists behind a red confirmation, and clearing shared cookies can sign the user out of related subdomains. The product must disclose this behavior before cookie-inclusive cleanup.

## Permissions

The exact permission list is defined by the final release `manifest.json`. See [docs/PERMISSION_MATRIX.md](docs/PERMISSION_MATRIX.md) for the detailed feature-to-permission mapping and least privilege justification. `bun run check:permissions` fails CI when this list and the manifest differ.

Install-time permissions:

- `activeTab`: Ephemeral access to the active tab's URL when the user opens the popup, uses a shortcut or uses the context menu.
- `browsingData`: Required to selectively remove site data via `chrome.browsingData.remove`.
- `contextMenus`: Adds the "Clean this origin with preset…" menu.
- `cookies`: Exact Cookie Mode reads cookie metadata (never values) and removes the cookies that apply to the selected origin.
- `scripting`: Counts what an origin stores and clears Session Storage in the page of the selected origin.
- `storage`: Stores the settings listed above.

Optional permissions: access to one origin (`<origin>/*`) is requested only when the user wants Exact Cookie Mode for that origin, can be revoked at any time, and is never requested for all sites.

No background tab tracking (`tabs`), no download access (`downloads`) and no persistent host permissions (`<all_urls>`) are requested.

The extension does not use or claim any permission that is absent from the shipped manifest.

## Test Mode

Test Mode lets a script on a local test page (`http://localhost/*` or `http://127.0.0.1/*`) ask the extension to clean that page's own origin. It is **off by default**, accepts only allow-listed origins, never cleans another origin and never allows domain-wide cookie removal. The reply to the page contains counts and error codes only. See [docs/automation.md](docs/automation.md).

## Remote code and third parties

The extension's executable code must be packaged with the extension. It must not download or execute remotely hosted application logic. Fonts are packaged with the extension; no CDN is used.

If third-party libraries are introduced in the future, their privacy and security behavior must be reviewed before release.

## Data sharing

Because the extension is designed not to transmit user browsing/site data to AhliWeb, AhliWeb does not share such extension-derived browsing/site data with third parties. Use of data is limited to providing the single purpose of the extension (Chrome Web Store "Limited Use"): it is not sold, not used for advertising, not used to determine creditworthiness, and not used for any purpose unrelated to cleaning site data.

## Standards and regulations

The design is **in line with** the following. This is a design statement, not a certification or legal opinion.

| Reference | How the design relates to it |
| --- | --- |
| Indonesia, UU No. 27 Tahun 2022 (Pelindungan Data Pribadi, PDP): purpose limitation and data minimisation | Data is used only to perform the cleanup the user requested. Stored data is limited to settings and metadata, with fixed size caps; no cookie values or contents. History is optional and clearable. |
| GDPR Art. 5(1)(c) (data minimisation) and Art. 5(1)(b) (purpose limitation) | Same measures; the evidence report holds counts only and the history whitelist drops every other field. |
| Chrome Web Store User Data Policy, including Limited Use | Single purpose; no transfer of user data; no sale; no use for ads; all processing on the device. |
| ISO/IEC 27701 and ISO/IEC 29100 (privacy framework: collection limitation, use limitation, data minimisation, openness) | Local processing, minimal storage, public documentation of every stored key and permission. |

## Security

The project follows these principles:

- least privilege,
- explicit user action before destructive cleanup,
- accurate disclosure of deletion scope,
- local processing,
- no unnecessary remote services,
- review and automated testing before release,
- a signed, reproducible release pipeline (see [docs/SUPPLY_CHAIN.md](docs/SUPPLY_CHAIN.md)).

Security issues should be reported using the process in `SECURITY.md`.

## Changes

This document should be updated whenever the extension's data handling, permissions, telemetry, remote services, or supported cleanup types change.
