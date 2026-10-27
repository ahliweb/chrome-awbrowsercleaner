# Extension Permission Matrix — AW Browser Cleaner

## Overview

AW Browser Cleaner strictly adheres to the principle of **least privilege**. The extension requires only the minimum permissions necessary to identify the active tab's origin and clear browsing data for **exact origins** (`scheme://host:port`).

Two rules hold for every release:

- The extension has **no permanent host access**. `host_permissions` must not exist in `manifest.json`. Host access comes only from `activeTab` (the tab the user just invoked the extension on) or from an optional, per-origin grant the user approves (Exact Cookie Mode).
- Every `manifest.json` permission entry is documented in the table below. `bun run check:permissions` fails CI when the manifest and this document (or `PRIVACY.md`) drift apart.

## Final Manifest Permissions (current manifest)

```json
{
  "permissions": [
    "activeTab",
    "browsingData",
    "contextMenus",
    "cookies",
    "scripting",
    "storage"
  ],
  "optional_host_permissions": [
    "http://*/*",
    "https://*/*"
  ],
  "externally_connectable": {
    "matches": [
      "http://localhost/*",
      "http://127.0.0.1/*"
    ]
  }
}
```

`host_permissions` is **not declared**. The `commands` key (keyboard shortcuts) needs no permission.

### Manifest entries and install warnings

The table between the markers below is read by `scripts/check-permissions.js`. Keep the first two columns exactly as `` `entry` `` and `` `manifest key` ``.

<!-- check-permissions:begin -->

| Entry | Manifest key | Install warning | Reason |
| --- | --- | --- | --- |
| `activeTab` | `permissions` | None | Temporary access to the tab the user invoked the extension on (toolbar click, shortcut or context menu): its URL to find the origin, and script injection for the snapshot and Session Storage steps. |
| `browsingData` | `permissions` | None | `chrome.browsingData.remove({ origins: [origin] })` for Local Storage, IndexedDB, File Systems (OPFS), HTTP cache, Cache Storage and Service Workers. |
| `contextMenus` | `permissions` | None | The "Clean this origin with preset…" context menu on the page and the toolbar icon. |
| `cookies` | `permissions` | None | Exact Cookie Mode: read cookie metadata and remove only the cookies that apply to the target origin. Needs a host grant for that origin (see below). |
| `scripting` | `permissions` | None | `chrome.scripting.executeScript` to count what an origin stores (snapshot) and to clear Session Storage in frames whose origin equals the target. |
| `storage` | `permissions` | None | `chrome.storage` for custom presets, last-used preset, recent origins, history summaries, Test Mode settings and the permission grant log. See the data dictionary. |
| `http://*/*` | `optional_host_permissions` | None at install; Chrome asks per origin when requested | Upper bound for the per-origin grant (`<origin>/*`) requested only for Exact Cookie Mode, never as a blanket request. |
| `https://*/*` | `optional_host_permissions` | None at install; Chrome asks per origin when requested | Same as above for `https` origins. |
| `http://localhost/*` | `externally_connectable.matches` | None | Lets a local test page send messages to the extension. Messages are accepted only when Test Mode is on. |
| `http://127.0.0.1/*` | `externally_connectable.matches` | None | Same as above for the loopback address. |

<!-- check-permissions:end -->

"None" means that, to our knowledge of the current Chrome permission-warnings list, Chrome shows no warning line for that entry in the install or update dialog. The official list is maintained at <https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings>; re-check it when raising `minimum_chrome_version` or adding a permission. A permission that appears in that list (for example `tabs`, `history` or broad host permissions) would make the update look scarier to users and can disable the extension until the user accepts it again.

---

## Feature to Permission Mapping

| Feature / Operation | API Used | Permission Required | Justification |
| --- | --- | --- | --- |
| Detect the active tab origin when the popup opens | `chrome.tabs.query({ active: true, currentWindow: true })` | `activeTab` | Grants temporary, user-invoked access to the active tab's URL without access to other tabs or background browsing activity. |
| Keyboard shortcuts (Alt+Shift+K, Alt+Shift+L) | `chrome.commands.onCommand` | `activeTab` (granted by the shortcut) | The `commands` key needs no permission; invoking a command grants `activeTab` for the current tab. |
| Context menu "Clean this origin with preset…" | `chrome.contextMenus.create` / `onClicked` | `contextMenus`, `activeTab` (granted by the click) | One item per preset; the click grants `activeTab` for that tab. |
| Clear site storage (localStorage, IndexedDB, OPFS, HTTP cache, Cache Storage, Service Workers) | `chrome.browsingData.remove({ origins: [origin], originTypes: { unprotectedWeb: true } }, dataTypes)` | `browsingData` | One call per exact origin; `excludeOrigins` is never used. |
| Clear Session Storage | `chrome.scripting.executeScript` in frames whose `location.origin` equals the target | `scripting`, `activeTab` | `browsingData` cannot clear Session Storage. Only the active tab's origin is supported. |
| Evidence snapshot (counts before/after) | `chrome.scripting.executeScript` with `snapshotProbe` | `scripting`, `activeTab` | Returns counts and metadata only, never values. |
| Exact Cookie Mode: list, classify and remove cookies | `chrome.cookies.getAll`, `chrome.cookies.remove`, `chrome.cookies.getAllCookieStores` | `cookies` + per-origin optional host grant | Removes only host-only and partitioned cookies of the target by default; shared domain cookies only when the user selects them. |
| Request per-origin cookie access | `chrome.permissions.request({ origins: ['<origin>/*'] })` | `optional_host_permissions` | Runs inside a click handler; the user can revoke it in Options (`chrome.permissions.remove`). |
| Presets, history, Test Mode settings | `chrome.storage.sync`, `.local`, `.session` | `storage` | Local-only data; see the data dictionary for every key. |
| Test Mode (automation) | `chrome.runtime.onMessageExternal` | `externally_connectable.matches` | Accepts messages only from `http://localhost/*` and `http://127.0.0.1/*`, and only when Test Mode is enabled in Options. |
| Export report / presets / history | `Blob` + `URL.createObjectURL` + `<a download>` | *None* | No `downloads` permission is needed. |
| Manual origin input | DOM input and `origin-utils.js` | *None* | Evaluated in memory in the popup. |

### Notes

- **Optional host permissions** are requested per origin, never as `<all_urls>`, and only for Exact Cookie Mode (`chrome.cookies` needs host access to the cookie's URL). The user approves a Chrome prompt for that single origin; the grant is logged in the `aw.permissionGrants` list and can be revoked at any time in **Options → Per-origin permissions**. Without the grant the cookie step fails with `COOKIE_PERMISSION_MISSING`; there is no silent fallback to domain-wide mode.
- **`externally_connectable`** adds no install warning and does not give a page any ability by itself. The service worker answers `{ action: 'ping' }` always, but runs `{ action: 'clean' }` only when Test Mode is on, only for the sender's own origin and only for allow-listed origins. See [automation.md](automation.md).
- **`commands`** (`clean-last-preset`, `clean-logout`) is a manifest key, not a permission.

---

## Permissions Evaluated and Removed

### 1. `tabs` (Removed, still not used)

- **Previous state**: Declared in `permissions: ["tabs"]` in v1.1.
- **Why removed**: The broad `tabs` permission grants permanent access to inspect all tabs in all windows, tab URLs, and navigation events at any time. AW Browser Cleaner only needs to inspect the current active tab when the user explicitly invokes the extension.
- **Replacement**: `activeTab` provides ephemeral access to the current tab's URL strictly when invoked by the user (toolbar click, shortcut or context menu), satisfying the requirement without broad access.
- **Why it is still not used**: v1.3 adds shortcuts, a context menu, a reload action and the Options page. `tabs.reload`, `tabs.update` and `tabs.create` work without the `tabs` permission, and the tab that is cleaned is always the one the user invoked.
- **Security gain**: Eliminates persistent visibility into the user's overall browsing session and other open tabs/windows.

### 2. `<all_urls>` Host Permissions (Removed, still not used)

- **Previous state**: Declared in `host_permissions: ["<all_urls>"]` in v1.1.
- **Why removed**: Host permissions are required for injecting content scripts or executing cross-origin `fetch()` requests. AW Browser Cleaner does neither; cleanup is executed by Chrome's browser engine via the `chrome.browsingData` API.
- **Replacement**: `activeTab` for the current tab, and **optional** per-origin host permissions (`<origin>/*`) that the user grants only when they want Exact Cookie Mode for that origin. Nothing is granted at install time.
- **Why it is still not used**: `chrome.cookies` needs host access, which could have tempted a blanket grant. Instead the grant is requested per origin, is revocable, and is never `<all_urls>`. `check:permissions` fails if `host_permissions` ever reappears.
- **Security gain**: Eliminates the broad host-access warning during installation ("Read and change all your data on all websites"), vastly improving user trust and privacy.

### 3. `downloads` (Never used)

- **Considered for**: Saving the evidence report (JSON/Markdown) and exported presets/history.
- **Why not used**: Exports are built as a `Blob` and saved with a temporary `<a download>` link, which works in an extension page without any permission. The `downloads` permission would also let the extension see and manage the user's downloads, which is far outside its single purpose.
- **Security gain**: The extension cannot read, open or remove the user's downloads (the `downloads` data type is also on the `FORBIDDEN_TYPES` list of the Scope Guard).

---

## Chrome Web Store Policy Compliance

| Policy Area | Status | Impact |
| --- | --- | --- |
| **Least Privilege (Single Purpose)** | Compliant | The extension serves only one purpose: clearing browsing data for chosen exact origins. Every permission above maps to a feature of that purpose. |
| **Permission Justification** | Clear & Minimal | Six standard API permissions, each justified in `docs/chrome-web-store/STORE_LISTING.md`. |
| **User Install Warnings** | Minimal | No permanent host access, no `tabs`; host access is optional and asked per origin at the moment of use. |
| **Limited Use / User Data Policy** | Compliant by design | Nothing leaves the device; stored data is metadata only. See `PRIVACY.md`. |

---

## Verification & Testing

- **Documentation check**: `bun run check:permissions` (`scripts/check-permissions.js`) runs in CI after ESLint. It fails when a manifest entry is missing from the table above, when this table lists an entry the manifest no longer has, when an install-time permission is missing from `PRIVACY.md`, or when `host_permissions` exists. Its tests are in `tests/unit/check-permissions.test.js`.
- **Scope Guard unit tests**: `tests/unit/cleanup-core.test.js` , `tests/unit/scope-guard.fuzz.test.js` (seeded corpus) and `tests/unit/scope-guard.property.test.js` (fast-check properties) prove that no plan reaches a Chrome API unless it targets exact origins.
- **Background tests**: `tests/unit/background.test.js` covers shortcuts, the context menu and Test Mode (including `COOKIE_PERMISSION_MISSING`).
- **E2E**: `tests/e2e/` loads the unpacked extension in Chrome for Testing and proves deletion per origin.
