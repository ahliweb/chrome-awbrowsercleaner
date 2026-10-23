# Automation — AW Browser Cleaner

How to reset site data from Playwright, Puppeteer, Cypress or plain CDP, and how to hand the same job to the extension with **Test Mode**.

> **Scope principle:** clean exact origins (`scheme://host:port`), never "everything". The same rule applies to automation: scope every reset to the origin under test. Anything that clears the whole browser profile is an anti-pattern because it hides bugs, wipes the data of other tests and removes the sessions you did not mean to remove.

## What is tested in CI

The snippets marked **tested** below are copied from `tests/automation/cdp-example.test.js` (`// docs:begin` / `// docs:end` blocks). `tests/unit/docs-snippets.test.js` fails when this document and the test differ, and `bun run test:e2e` runs the test in CI on Chrome for Testing. Snippets marked **not run in CI** are shown for convenience; Playwright and Cypress are not dependencies of this repository.

Run the automation test locally with:

```bash
AW_CHROME_PATH=/path/to/chromium bun test tests/automation --timeout 60000
```

Without `AW_CHROME_PATH` the test is skipped with a visible banner; with `CI=true` a missing binary fails the run.

## Data types: extension versus automation tools

Each data type of the extension (`DATA_TYPES` in `cleanup-core.js`) mapped to what automation tools offer. "Origin" means the equivalent is scoped to one origin.

| Extension type | CDP (origin-scoped) | Playwright | Cypress | Note |
| --- | --- | --- | --- | --- |
| `cookies` | `Network.getCookies({ urls: [origin] })`, then `Network.deleteCookies({ name, url: origin })` per cookie | `context.clearCookies({ name, domain, path })` (filters need Playwright 1.43+) | `cy.clearCookies()` | Cookies are not isolated by port (RFC 6265 §8.5); `clearDataForOrigin` with `cookies` is not a precise per-origin tool, so delete by name. |
| `sessionStorage` | none; run `sessionStorage.clear()` in the page | `page.evaluate(() => sessionStorage.clear())` | `cy.clearAllSessionStorage()` (all origins, avoid) or `cy.window().then((w) => w.sessionStorage.clear())` | Per tab and per frame. |
| `localStorage` | `Storage.clearDataForOrigin` with `local_storage` | New context per test, or `page.evaluate(() => localStorage.clear())` | `cy.clearLocalStorage()` (current origin) | `cy.clearAllLocalStorage()` clears every origin: avoid. |
| `indexedDB` | `Storage.clearDataForOrigin` with `indexeddb` | `page.evaluate` that deletes `indexedDB.databases()` | `cy.window()` then delete databases | |
| `fileSystems` (OPFS) | `Storage.clearDataForOrigin` with `file_systems` | New context per test | none built in | Verified to clear OPFS in Chromium 141. |
| `cache` (HTTP cache) | none origin-scoped. `Network.clearBrowserCache` is **global** | New context per test (empty cache) | none built in | Anti-pattern, see below. Prefer content-hashed URLs, `Cache-Control` headers in the test server, or the extension's "Fix stale files" preset. |
| `cacheStorage` | `Storage.clearDataForOrigin` with `cache_storage` | `page.evaluate` with `caches.keys()` and `caches.delete()` | `cy.window()` then `caches.delete()` | |
| `serviceWorkers` | `Storage.clearDataForOrigin` with `service_workers` | Context option `serviceWorkers: 'block'`, or unregister in the page | `cy.window()` then unregister registrations | |

CDP-only types that the extension deliberately does not offer: `shared_storage`, `storage_buckets`, `interest_groups` and `shader_cache` (also the deprecated `appcache` and `websql`). They are test-infrastructure concerns, cannot be limited to an origin the way `chrome.browsingData` can, or have no user-facing meaning. Use them through CDP when your own test needs them.

### Anti-pattern: `Network.clearBrowserCache`

```js
// DO NOT: clears the HTTP cache of the whole browser profile, not of the origin under test.
await client.send('Network.clearBrowserCache');
```

It is global. It slows every other tab and test, can make a failure irreproducible, and teaches the habit that "clear everything" is a fix. Scope the reset to the origin, or start each test in a fresh browser context.

### Tested: clear one origin through CDP

```js
const client = await page.createCDPSession();
await client.send('Storage.clearDataForOrigin', {
    origin,
    storageTypes: 'local_storage,indexeddb,cache_storage'
});
```

*Tested.* The test seeds localStorage, IndexedDB and Cache Storage on `http://127.0.0.1:<port>` and on a second origin `http://localhost:<port2>`, runs the snippet, and asserts that the first origin is empty and the second one keeps its data. `storageTypes` is a comma-separated list; list the types you mean.

Playwright reaches the same protocol with `const client = await context.newCDPSession(page);` (*not run in CI*).

## Test Mode

Test Mode lets a script on a local page ask the extension to run a preset on **that page's own origin**. It exists so that a QA hand-off ("clean, then run the flow") uses the same presets, Scope Guard and evidence behavior as a person, without a second implementation in the test code.

### Enable it

1. Open the extension's **Options** page (`chrome://extensions` → AW Browser Cleaner → Details → Extension options).
2. In **Test Mode**, switch it on. It is off by default.
3. In **Allowed origins**, list the origins your tests run on, separated by commas or new lines. The default list is `http://localhost` and `http://127.0.0.1`. An origin without a port allows any port; an origin with a port allows only that exact origin (for example `http://localhost:3000`). Only `http` and `https`, no paths and no wildcards; at most 20 entries.
4. Click **Save origins**.

The manifest limits who can send messages at all (`externally_connectable.matches`: `http://localhost/*` and `http://127.0.0.1/*`, any port). The allow-list can only narrow that further: an origin outside those patterns cannot send messages at all, whatever the list says.

### Message protocol

Send from a page whose origin matches the allow-list. `EXTENSION_ID` is the id on `chrome://extensions` (an unpacked extension has an id derived from its folder path; the Chrome Web Store id is `njflkejajbifofomeebakgebgcincepf`).

```js
chrome.runtime.sendMessage(EXTENSION_ID, { action: 'ping' })
chrome.runtime.sendMessage(EXTENSION_ID, { action: 'clean', preset: 'fresh' })
```

`preset` is a built-in id (`logout`, `fresh`, `stale`, `full`) or the id of one of your custom presets.

#### `ping`

Always answered, also when Test Mode is off, so a test can detect the state:

```json
{ "ok": true, "enabled": false }
```

*Tested:*

```js
const ping = await page.evaluate(
    (id) => chrome.runtime.sendMessage(id, { action: 'ping' }),
    EXTENSION_ID
);
```

#### `clean`

*Tested:*

```js
const response = await page.evaluate(
    (id) => chrome.runtime.sendMessage(id, { action: 'clean', preset: 'client-state' }),
    EXTENSION_ID
);
```

A successful response (`ok` is `false` when any step failed, for example a missing cookie permission; the shape is the same):

```json
{
  "ok": true,
  "origin": "http://127.0.0.1:4173",
  "presetId": "client-state",
  "result": {
    "ok": true,
    "durationMs": 12,
    "perOrigin": [
      {
        "origin": "http://127.0.0.1:4173",
        "types": { "localStorage": "ok", "indexedDB": "ok", "cacheStorage": "ok" },
        "cookies": null,
        "errors": []
      }
    ],
    "after": { "action": "none", "ok": true }
  },
  "dropped": []
}
```

- `types` values are `ok`, `skipped` or `error`.
- `cookies` is `null`, or `{ "removed": n, "kept": n, "failed": n }` in Exact Cookie Mode. Cookie values are never part of any response.
- `errors` entries are `{ "type", "code", "message" }`; codes include `COOKIE_PERMISSION_MISSING`, `COOKIE_READ_FAILED`, `COOKIE_REMOVE_FAILED`, `BROWSING_DATA_FAILED` and `SESSION_STORAGE_FAILED`.
- `dropped` lists steps that Test Mode removed from the preset: `{ "type": "sessionStorage", "reason": "testModeNoActiveTab" }`, and `{ "after": "<action>", "reason": "noTab" }` when the call does not come from a top-level tab frame.
- `ignoredPayloadOrigin: true` is added when the payload contained `origin`, `origins` or `target`. They are ignored.

#### Error responses

| `error` | When | Extra fields |
| --- | --- | --- |
| `BAD_REQUEST` | The message is not an object with a string `action`, or `clean` has no string `preset` | |
| `UNKNOWN_ACTION` | `action` is neither `ping` nor `clean` | |
| `TEST_MODE_DISABLED` | Test Mode is off | |
| `ORIGIN_NOT_ALLOWED` | The sender origin is not an exact origin on the allow-list | |
| `PRESET_NOT_FOUND` | No built-in or custom preset has that id | |
| `DOMAIN_WIDE_NOT_ALLOWED` | The preset would remove cookies domain-wide or shared cookies | `origin`, `presetId`, `dropped` |
| `PLAN_INVALID` | The plan failed validation | `code`, `origin`, `presetId`, `dropped` |
| `SCOPE_GUARD` | `executePlan` threw a Scope Guard error | `message`, `origin`, `presetId`, `dropped` |
| `INTERNAL_ERROR` | An unexpected failure in the worker | |

Every error response has `ok: false`.

### Rules

- **`sender.origin` only.** The target is the origin of the page that sent the message, taken from the browser, never from the payload.
- **Allow-list.** The origin must be enabled and match an allow-list entry. Otherwise `ORIGIN_NOT_ALLOWED`.
- **No domain-wide.** Domain-wide cookie removal and shared cookies are refused (`DOMAIN_WIDE_NOT_ALLOWED`). Exact Cookie Mode needs the per-origin host permission, which only a person can grant; in a fresh profile a preset with cookies returns `COOKIE_PERMISSION_MISSING` in `errors`. Let your tool clear cookies (`Network.deleteCookies` or `context.clearCookies`) and use Test Mode for the client state.
- **One origin.** Extra origins in a preset are dropped; `sessionStorage` is dropped (the extension has no active-tab grant here, and the page can clear its own).
- **After-actions.** If the preset has a reload or start-page action and the call comes from a top-level frame, the tab navigates right after the response. That can make `page.evaluate` fail with "Execution context was destroyed". Use a custom preset with **After: Nothing** for automation and navigate yourself.
- **Replies are value-free.** Counts, origins and error codes only.

### Tested example: a custom preset for automation

The test saves a custom preset `client-state` (localStorage, IndexedDB, Cache Storage, no cookies, After: Nothing), turns Test Mode on for `http://127.0.0.1`, and checks `TEST_MODE_DISABLED` while off, a scoped clean while on, `DOMAIN_WIDE_NOT_ALLOWED` for a domain-wide preset, `ignoredPayloadOrigin` for a payload that names another origin, and `ORIGIN_NOT_ALLOWED` for a page that is not on the allow-list. Presets are normally created in Options; the test writes the same storage keys (`aw.preset.<id>` in `chrome.storage.sync`, `aw.testMode` in `chrome.storage.local`) from an extension page. See [data-dictionary.md](data-dictionary.md).

### Loading the extension

Branded Google Chrome 137 and later ignores `--load-extension`. Use **Chrome for Testing** or Chromium (see the README section "Running E2E tests").

Puppeteer (*tested*, see the test file): launch with `enableExtensions: true`, `pipe: true` and `--enable-unsafe-extension-debugging`, then `const id = await browser.installExtension(extensionPath);`.

Playwright persistent context (*not run in CI*):

```js
import { chromium } from '@playwright/test';

const extensionPath = '/path/to/chrome-awbrowsercleaner';
const context = await chromium.launchPersistentContext('/tmp/aw-profile', {
    channel: 'chromium',
    args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
    ]
});
let [worker] = context.serviceWorkers();
if (!worker) worker = await context.waitForEvent('serviceworker');
const extensionId = new URL(worker.url()).host;

const page = await context.newPage();
await page.goto('http://localhost:3000/');
const ping = await page.evaluate((id) => chrome.runtime.sendMessage(id, { action: 'ping' }), extensionId);
```

## Evidence for the test report

Test Mode does not create a report file or a history entry, and its reply holds counts and error codes only. To attach before/after evidence to a ticket, rehearse the preset once from the popup and use Copy summary or Export JSON on the result screen (file name `aw-cleaner-<host>-<YYYYMMDD-HHmmss>.json`), and keep the Test Mode `response` object from your test run as the automated record. See the [QA playbook](qa-playbook.md), section "Automation hand-off via Test Mode".
