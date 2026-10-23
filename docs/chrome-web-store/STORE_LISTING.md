# Chrome Web Store Listing — AW Browser Cleaner

This file is the canonical draft for the next Chrome Web Store listing update. It must be reviewed against the final packaged release before submission.

## Product identity

**Name:** AW Browser Cleaner  
**Publisher:** AhliWeb.com / PT Ahli Web Internasional  
**Extension ID:** `njflkejajbifofomeebakgebgcincepf`  
**Category:** Developer Tools

## Recommended short description

Clean site data for the exact origin you are on: cookies, storage, cache and service workers. 100% local.

## Recommended detailed description

AW Browser Cleaner is a lightweight, privacy-focused Chrome extension for developers, QA engineers, support teams, security professionals, and advanced users who need to reset site data without clearing unrelated browser data.

### Core capabilities

- Detect the current HTTP(S) site automatically and clean only its exact origin (`scheme://host:port`).
- Choose what to clear: Cookies, Session Storage, Local Storage, IndexedDB, File Systems (OPFS), HTTP cache, Cache Storage and Service Workers.
- One-click presets: Log out, Fresh start, Fix stale files and Everything, plus your own presets (for example "Client state only").
- Exact Cookie Mode: remove only the cookies that apply to this origin and keep cookies shared with other subdomains.
- Before/after evidence report: copy a summary or export JSON / Markdown to attach to a bug report. Counts and metadata only; no cookie values or storage contents.
- Keyboard shortcuts (Alt+Shift+K for the last preset, Alt+Shift+L for Log out) and a context menu.
- Optional time range, for example "since the test session started".
- Test Mode (off by default) for Playwright, Puppeteer or Selenium scripts on localhost.
- English and Indonesian interface.
- Keep cleanup operations local to the browser. No account, no analytics, no behavioral tracking, and no transmission of browsing data to AhliWeb servers.

### Important cookie behavior

Most supported storage types are targeted using the selected origin. Cookies are different: browser cookie scoping can apply to the registrable domain and related subdomains, and cookies do not isolate by port. By default AW Browser Cleaner removes only the cookies that apply to the selected origin and keeps shared domain cookies unless you choose them. A domain-wide mode exists behind a red confirmation, because clearing shared cookies may sign you out of related subdomains.

### What it never touches

Browsing history, downloads, saved passwords, form data and other websites. Exports are generated on your device; nothing is uploaded.

### Privacy

AW Browser Cleaner is designed as a local-first utility. The extension uses browser APIs only to identify the selected target and perform the cleanup you explicitly request. It stores only settings and metadata (presets, recent origins, up to 20 history summaries) on your device, and you can turn history off and clear it.

Privacy policy:
<https://ahliweb.com/privacy-browser-ext/>

Source:
<https://github.com/ahliweb/chrome-awbrowsercleaner>

## Single purpose statement for Developer Dashboard

AW Browser Cleaner's single purpose is to let a user selectively remove browser site data (cookies, storage, cache and service workers) for the exact website origin the user chooses, using Chrome's native browsing-data functionality. Presets, shortcuts, the context menu, the evidence report, history and Test Mode all serve this one purpose: they choose, trigger or document a cleanup of the chosen origin.

## Permission justifications for Developer Dashboard

AW Browser Cleaner requests only the minimal set of permissions required for its single purpose. None of the permissions below produces a Chrome install warning, and the extension has no permanent host access.

### activeTab

Required to read the URL of the current active tab when the user explicitly clicks the extension icon, uses a keyboard shortcut or picks the context menu item, so the extension knows which origin to clean. The access is temporary and limited to that tab.

### browsingData

Required to invoke `chrome.browsingData.remove` with `{ origins: [origin] }` to delete the site-data categories the user selected (Local Storage, IndexedDB, File Systems, HTTP cache, Cache Storage, Service Workers) for one exact origin per call. The extension never calls it without an explicit origin list and never uses `excludeOrigins`.

### contextMenus

Required to add the "Clean this origin with preset…" menu to the page and the toolbar icon, with one item per preset. A click is a user action and cleans the current tab's origin.

### cookies

Required for Exact Cookie Mode: to list cookie metadata (name, domain, flags; never values) for the selected origin and to remove only the cookies that apply to it. It is used together with an optional, per-origin host permission (below).

### scripting

Required to run two small packaged functions in the page of the selected origin: one counts what the origin stores (for the before/after report) and one clears Session Storage, which the browsing-data API cannot clear. No remote code is run and no content script is declared.

### storage

Required to store the user's presets, last-used preset, up to 3 recent origins, up to 20 history summaries, Test Mode settings and a log of per-origin permission grants. Only settings and metadata are stored; see `docs/data-dictionary.md`.

### Optional host permissions (`optional_host_permissions`)

Requested per origin (`<origin>/*`), only when the user chooses Exact Cookie Mode for that origin, from a user click. The user can revoke each grant in Options. Nothing is granted at install, and the extension never requests access to all sites.

### externally_connectable (`http://localhost/*`, `http://127.0.0.1/*`)

Allows a local test page to message the extension for Test Mode. It adds no install warning, is ignored unless the user turns Test Mode on in Options, and only lets a page clean its own origin.

### Unused permissions eliminated (Least Privilege)

- **tabs**: Not requested. The broad `tabs` permission is unnecessary because ephemeral `activeTab` provides all required active tab URL information upon user invocation.
- **host_permissions (<all_urls>)**: Not requested. Cleanup runs through `chrome.browsingData`; cookie access uses optional per-origin grants.
- **downloads**: Not requested. Exports are saved from a `Blob` without the downloads API.

See `docs/PERMISSION_MATRIX.md` for the full mapping; `bun run check:permissions` keeps it in sync with `manifest.json`.

## Data-use declaration draft

Subject to final package verification:

- No personally identifiable information is collected by AhliWeb through the extension.
- No browsing history is collected or transmitted.
- No website content is collected or transmitted.
- No analytics/tracking SDK is included.
- No user data is sold.
- No data is used for advertising, creditworthiness, or unrelated purposes.
- Use of data stays within the single purpose (Limited Use).
- Cleanup operations execute locally using Chrome APIs.
- Data stored on the device is limited to settings and metadata (no cookie values, no storage contents); history can be turned off and cleared.

## Support and testing notes for reviewers

- To try the extension: open any `https://` page, click the icon, choose the "Log out" preset and clear. The result screen shows before/after counts.
- Step-by-step scenarios for QA teams are in `docs/qa-playbook.md` (English) and `docs/qa-playbook.id.md` (Indonesian).
- Test Mode and automation examples are in `docs/automation.md`.

## Screenshot plan

Refresh screenshots after the popup redesign is released.

Recommended screenshots:

1. Popup showing the exact selected origin and the preset bar.
2. Granular storage-type selection and Exact Cookie Mode.
3. Confirmation state (review and domain-wide variants).
4. Result screen with the before/after evidence table.
5. Options page (presets, Test Mode, history).

Screenshots must reflect the actual release UI; do not submit mockups that materially differ from the extension. The files in `design/exports/png/` are design references and must not be used as store screenshots.

## Current live-listing audit

The currently published listing is version 1.1 and describes domain-specific cleaning, local operation, and no tracking/data collection.

Before the next submission:

- replace "per domain" language where it overstates cookie isolation;
- align wording with exact-origin behavior for origin-scoped storage;
- update the Privacy tab: single purpose, the six permissions above, optional host permissions and the data-use declaration;
- ensure the Privacy tab and public privacy policy match the final permission set.
