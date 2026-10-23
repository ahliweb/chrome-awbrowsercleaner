# QA Playbook — AW Browser Cleaner

Bahasa Indonesia: [qa-playbook.id.md](qa-playbook.id.md)

Practical scenarios for testers, QA engineers and support teams who use AW Browser Cleaner to reset the state of one site between test runs. Each scenario names a goal, a preset, the steps, the expected result and how to attach the evidence report to a ticket.

## Contents

- [Scope principle](#scope-principle)
- [Before you start](#before-you-start)
- [Evidence report](#evidence-report)
- [Custom preset: Client state only](#custom-preset-client-state-only)
- [Scenario 1: Logout and session fixation](#scenario-1-logout-and-session-fixation)
- [Scenario 2: First visit, onboarding and cookie consent](#scenario-2-first-visit-onboarding-and-cookie-consent)
- [Scenario 3: Deploy verification and cache busting](#scenario-3-deploy-verification-and-cache-busting)
- [Scenario 4: Service Worker and PWA update](#scenario-4-service-worker-and-pwa-update)
- [Scenario 5: IndexedDB schema migration](#scenario-5-indexeddb-schema-migration)
- [Scenario 6: Several environments on one registrable domain](#scenario-6-several-environments-on-one-registrable-domain)
- [Scenario 7: App and API on different origins](#scenario-7-app-and-api-on-different-origins)
- [Scenario 8: Cleanup since a test session](#scenario-8-cleanup-since-a-test-session)
- [Scenario 9: Automation hand-off via Test Mode](#scenario-9-automation-hand-off-via-test-mode)
- [Design references](#design-references)

## Scope principle

The extension only ever cleans **exact origins** (`scheme://host:port`). It never touches browsing history, downloads, saved passwords, form data or any other site, and it has no "everything except" mode. `https://app.example.test` and `https://app.example.test:8443` are different origins; so are `http` and `https`.

Cookies are the one place where the browser does not follow origins. A cookie is scoped by host and path, not by port (RFC 6265 §8.5), and a cookie set with a `Domain` attribute is shared with every subdomain. That is why the default **Exact Cookie Mode** removes only the cookies that apply to the target host and keeps shared domain cookies unless you tick them, and why the domain-wide mode needs a red confirmation. Read the result screen: it states how many shared cookies were kept on purpose.

## Before you start

- Open the page you want to reset in the active tab, then open the extension. The target origin is filled in from the tab. On `chrome://` pages and the Chrome Web Store the extension shows an "unsupported page" screen where you can type a target manually.
- The first time you clean cookies for an origin in Exact Cookie Mode, Chrome asks you to grant access to that one origin ("Grant access to read cookies"). You can revoke it in **Options → Per-origin permissions**. Without it the cookie step fails with `COOKIE_PERMISSION_MISSING`; nothing falls back to domain-wide.
- Cookie values are never shown by the extension. If a scenario needs to compare a session identifier, use the browser's DevTools (Application → Cookies) and record only whether the value changed, never the value itself.
- Built-in presets: **Log out** (cookies + Session Storage, then reload), **Fresh start** (cookies, Session Storage, Local Storage, IndexedDB, File Systems, Cache Storage, Service Workers, then open the start page; the HTTP cache is kept), **Fix stale files** (HTTP cache, Cache Storage, Service Workers, then reload without cache; logins stay) and **Everything** (every supported type, for this origin only, then reload without cache).
- Shortcuts: `Alt+Shift+K` runs the last preset and `Alt+Shift+L` runs **Log out** on the current tab (change them at `chrome://extensions/shortcuts`). The context menu entry "Clean this origin with preset…" lists every preset. Plans that would remove domain-wide cookies are never run from a shortcut or the menu; the popup opens for confirmation instead.

## Evidence report

After every cleanup the result screen shows a before/after table (counts only) and three actions:

- **Copy summary** puts a short text on the clipboard. Paste it into the ticket comment.
- **Export JSON** saves the full report. Attach it to the ticket.
- **Markdown** saves the same report as a readable `.md` file. Paste or attach it.

File names follow `aw-cleaner-<host>-<YYYYMMDD-HHmmss>.json` (and `.md`). The host is lower case, a port is appended with a dash, and the time is local time. Examples: `aw-cleaner-staging.example.test-20261023-091500.json`, `aw-cleaner-localhost-3000-20261023-091500.json`.

Reports contain counts and metadata only. The screen says "Cookie values are never shown" and the report says "No cookie values or storage contents", so a report is safe to attach to a public tracker. Field definitions: [data-dictionary.md](data-dictionary.md).

Options → **History & evidence** keeps the last 20 cleanups on the device (switchable and clearable) and can export them as one JSON file.

## Custom preset: Client state only

Documented example from issue #34: clear what the page keeps in the browser, keep the login.

| Setting | Value |
| --- | --- |
| Name | Client state only |
| Data types | Session Storage, Local Storage, IndexedDB |
| Cookies | none selected (cookie mode does not matter) |
| After cleaning | Reload |

Create it in **Options → Presets → New preset** (the id becomes `client-state-only`), or import this file with **Import JSON**:

```json
{
  "format": "aw-browser-cleaner-presets",
  "version": 1,
  "exportedAt": "2026-10-23T08:00:00.000Z",
  "presets": [
    {
      "id": "client-state-only",
      "name": "Client state only",
      "dataTypes": ["sessionStorage", "localStorage", "indexedDB"],
      "cookieMode": "exact",
      "after": "reload",
      "startPath": "/"
    }
  ]
}
```

It appears under "More presets…" in the popup and in the context menu. Because it contains no cookies it runs without confirmation, also from `Alt+Shift+K`.

## Scenario 1: Logout and session fixation

Reference: OWASP Web Security Testing Guide WSTG-SESS-06 (Testing for Logout Functionality) and WSTG-SESS-03 (Testing for Session Fixation).

- **Goal.** Show that logging out invalidates the session on the server and that a new session identifier is issued when a user logs in.
- **Preset.** **Log out** (exact cookies + Session Storage, then reload).
- **Steps.**
  1. Open the application login page, clear the state with **Log out** so that you start anonymous, and note in DevTools whether a pre-login session cookie exists (name and whether it is `HttpOnly` and `Secure`).
  2. Log in. In DevTools check that the session cookie was replaced after login: its value must differ from the pre-login one (fixation check). Record "changed" or "unchanged".
  3. Keep the old session cookie in the DevTools of this throwaway test profile (use a test account; never paste the value into a ticket).
  4. Use the application's own logout button. Verify the cookie is removed or replaced and that you land on a logged-out page.
  5. Replay the old session cookie against a protected URL (browser DevTools override or an HTTP client). The server must refuse it (WSTG-SESS-06: the session is terminated server side, not only in the browser).
  6. Log in again and run the extension's **Log out** preset. Verify that the tab reloads logged out, and export the report.
- **Expected result.** After step 2 the identifier differs from the pre-login one; after step 4 the old identifier is rejected; the report for step 6 shows the cookie count going to 0 for host-only cookies and the session storage count to 0. Shared domain cookies that were kept on purpose are listed in the result screen.
- **Evidence.** Attach the JSON from step 6 and write the fixation and replay outcome in the ticket in words ("session id changed after login: yes").
- **Design screens.** [Popup main](../design/exports/png/PopupMain.png), [Result](../design/exports/png/PopupResult.png).

## Scenario 2: First visit, onboarding and cookie consent

- **Goal.** Verify what a brand-new visitor sees: the cookie consent banner, the onboarding tour, default language and default settings.
- **Preset.** **Fresh start** (cookies, Session Storage, Local Storage, IndexedDB, File Systems, Cache Storage, Service Workers, then open the start page).
- **Steps.**
  1. Open the site, accept the consent banner, finish onboarding, and change a setting (for example theme).
  2. Open the extension and choose **Fresh start**; confirm. The cookie step is a `review` confirmation (blue button "Clear now").
  3. The extension opens the start page of the origin. Check that the consent banner and the onboarding appear again and the setting is back to default.
  4. Repeat once with the data type list reduced to Local Storage only if the banner state is kept there, to learn which store holds the consent.
- **Expected result.** The consent banner and onboarding reappear; the report shows cookies, Local Storage and IndexedDB going to 0 for this origin. Other sites stay logged in.
- **Evidence.** Export JSON (or Copy summary) and attach it with a screenshot of the banner.
- **Design screens.** [Popup main](../design/exports/png/PopupMain.png), [Confirm](../design/exports/png/PopupConfirm.png), [Result](../design/exports/png/PopupResult.png).

## Scenario 3: Deploy verification and cache busting

- **Goal.** Confirm that users get the new build after a deploy, and find out whether a stale file is served from a cache.
- **Preset.** **Fix stale files** (HTTP cache, Cache Storage, Service Workers, then reload without cache). Logins stay.
- **Steps.**
  1. Before the deploy, note the build identifier shown by the app (footer, `/version.json` or an asset hash).
  2. Deploy. Load the page normally and note the identifier you see. If it is still the old one, the browser or a Service Worker served stale files: keep that observation.
  3. Run **Fix stale files** and note the identifier after the hard reload.
  4. If the identifier is correct only after the preset, report a cache-busting problem: check `Cache-Control` and `ETag` of the HTML and of un-hashed assets, and the Service Worker update logic.
- **Expected result.** A normal reload already shows the new build. If not, the preset fixes it and the ticket points to the cache headers or Service Worker. The report shows HTTP cache as "–" (it cannot be counted), Cache Storage and Service Workers before/after.
- **Evidence.** Attach the report and the two identifiers.
- **Design screens.** [Popup main with the Fix stale files preset](../design/exports/png/PopupMain--preset-stale-assets.png), [Result](../design/exports/png/PopupResult.png).

## Scenario 4: Service Worker and PWA update

- **Goal.** Verify that an installed Service Worker updates to the new version, and that a first install on a clean profile works.
- **Preset.** **Fix stale files** for the cold-start path; no preset for the update path.
- **Steps.**
  1. On the old build, open DevTools → Application → Service Workers and note the active worker and the Cache Storage names (for example `app-v41`).
  2. Deploy the new build. Without cleaning anything, reload twice and observe the update path: a new worker "waiting" or "activated", and the cache names changing to `app-v42`. Record how the user is told to refresh, if at all.
  3. Run **Fix stale files**. The report shows Service Workers and Cache Storage going to 0.
  4. After the reload, check that exactly one worker registers and the caches are rebuilt with the new names (cold-start path).
- **Expected result.** Update path: the new worker activates (or the app prompts) without manual clearing. Cold-start path: a single new registration and a complete cache. Old cache names do not remain.
- **Evidence.** Attach the report from step 3 and a screenshot of DevTools after step 4.
- **Design screens.** [Result](../design/exports/png/PopupResult.png).

## Scenario 5: IndexedDB schema migration

- **Goal.** Verify that a new schema version migrates existing local data without loss, and that a fresh install creates the same schema.
- **Preset.** **Client state only** for the fresh path; no cleanup for the migration path.
- **Steps.**
  1. On the old build, create representative data (several records, one of each kind). Note the database name and version in DevTools → Application → IndexedDB.
  2. Deploy the new build with the higher schema version. Reload **without** cleaning. Check the new version number, that the records are still present and that new stores or indexes exist (migration path).
  3. Run **Client state only**. The report shows IndexedDB going to 0 databases; the tab reloads.
  4. Create data again on the new build and compare the stores and indexes with the migrated database from step 2 (fresh path).
  5. Optional: keep a second tab open on the old build during the upgrade to check how the app handles the blocked or `versionchange` event.
- **Expected result.** Migration keeps all records; a fresh install produces an identical schema; no console errors from the upgrade.
- **Evidence.** Attach the report from step 3 and a table of before/after stores from DevTools.
- **Design screens.** [Popup main](../design/exports/png/PopupMain.png), [Options with presets](../design/exports/png/Options.png).

## Scenario 6: Several environments on one registrable domain

- **Goal.** Reset one environment (for example `staging.example.test`) without logging out the others (`qa.example.test`, `app.example.test`).
- **Preset.** **Log out** or **Fresh start**, in Exact Cookie Mode (the default).
- **Why Exact Cookie Mode.** `chrome.browsingData` can only remove cookies for a whole registrable domain. Cleaning `staging.example.test` that way would also delete every cookie of `qa.example.test` and `app.example.test` and sign you out of them. Exact Cookie Mode lists the cookies that apply to the target host, removes host-only and partitioned (CHIPS) cookies, and keeps cookies that were set for `.example.test` and are shared by the other environments. Remember that cookies are also not isolated by port (RFC 6265 §8.5): a host-only cookie of `staging.example.test` applies to `:3000` and `:8443` alike.
- **Steps.**
  1. Log in to staging and qa in two tabs.
  2. In the staging tab, open the extension and choose **Log out**. Grant access for this origin if asked. Open **Manage** on the cookie summary to see the groups: Host-only, Partitioned and Shared domain. Cookie values are not shown.
  3. Confirm with "Clear now".
  4. Reload the qa tab. It must still be logged in.
  5. If you must also remove the shared domain cookies, tick them in the Shared domain group (the confirmation turns red) or switch to Domain-wide. Expect other environments to be signed out.
- **Expected result.** Staging is logged out, qa is still logged in. The result screen says that N shared domain cookies were kept on purpose, with the domain.
- **Evidence.** Attach the JSON: `perOrigin[0].cookies` shows `removed`, `kept` and `failed`.
- **Design screens.** [Cookies](../design/exports/png/PopupCookies.png), [Cookies, domain-wide](../design/exports/png/PopupCookies--domain-wide.png), [Confirm](../design/exports/png/PopupConfirm.png), [Result](../design/exports/png/PopupResult.png).

## Scenario 7: App and API on different origins

Issue #38.

- **Goal.** Reset a front end and its API in one action when they live on different origins (`https://app.example.test` and `https://api.example.test`, or `http://localhost:3000` and `http://localhost:8080`).
- **Preset.** **Fresh start**, or a custom preset with the API as an extra origin (a preset can store extra exact origins, up to 10 in total).
- **Steps.**
  1. Open the front end in the active tab and open the extension.
  2. Under "Additional origin", type the API origin (for example `https://api.example.test`) and choose **Add**. Repeat for further origins; the popup stops at 10 and rejects duplicates and anything that is not an exact origin. The button now reads "Clear 2 origins".
  3. Review the confirmation: it lists every origin. Session Storage and the reload apply to the active tab only; additional origins are processed for the other data types and say so.
  4. Confirm. The result screen shows "2 origins processed" with one table per origin.
  5. Check that both origins start clean: the front end reloads, and the API session is gone (log in again).
- **Expected result.** Both origins are cleaned, nothing else is. A third origin, even on the same registrable domain, is untouched.
- **Evidence.** One report covers all origins; the file name uses the first origin's host. Attach the JSON.
- **Design screens.** [Origins in the popup](../design/exports/png/PopupOrigins.png), [Popup main](../design/exports/png/PopupMain.png), [Result](../design/exports/png/PopupResult.png).

## Scenario 8: Cleanup since a test session

Issue #37.

- **Goal.** Remove only the data that the test run created, and keep what existed before it.
- **Preset.** A preset without exact cookies, for example **Client state only**, or any preset with the cookie mode set to Domain-wide.
- **Steps.**
  1. Open **Options → History & evidence → Test session** and choose **Start test session**. The start time is shown; it is kept until you end the session or close the browser.
  2. Run the test flow, creating data on the site.
  3. In the popup, set **Time range** to "Since test session started" (the option shows the start time) and run the cleanup.
  4. In Options, choose **End session**.
- **Expected result.** Data created since the start is removed; older data of the same origin is kept where Chrome supports a time range. Not every storage type honors it precisely: the popup says so, and some types are removed completely. Exact cookies cannot be limited by time; the popup explains this and asks you to choose All time or the domain-wide mode.
- **Verified Chrome behavior.** `tests/e2e/since-matrix.test.js` seeds old data, waits 3 s, seeds new data and cleans origin A with `since` set between the two (Chrome/141.0.7390.37, `chrome.browsingData.remove` with `origins` and `since`; output in `test-artifacts/since-matrix.md`). Re-run it on the Chrome version you test with; do not assume the table stays the same.

  | Data type | Old data (before the start time) | New data (after the start time) |
  | --- | --- | --- |
  | Local Storage | removed (time range ignored) | removed |
  | IndexedDB | removed (time range ignored) | removed |
  | File systems (OPFS) | removed (time range ignored) | removed |
  | Cache Storage | removed (time range ignored) | removed |
  | Service Workers | removed (time range ignored) | removed |
  | HTTP cache | kept | removed |
  | Cookies (domain-wide only) | kept | removed |

  So with a time range, only the HTTP cache and domain-wide cookies keep older data in this Chrome version. For the other types the cleanup removes everything of the origin, which is why the popup warns that some types are removed completely. In every case new data is removed and other origins (including the canary) are untouched.
- **Evidence.** The report's "Since" field holds the start of the range in Markdown and `since` in JSON. Attach it and state which types were affected.
- **Design screens.** [Time range in the popup](../design/exports/png/PopupRange.png), [Options](../design/exports/png/Options.png), [Result](../design/exports/png/PopupResult.png).

## Scenario 9: Automation hand-off via Test Mode

Issue #39.

- **Goal.** Let Playwright, Puppeteer or Selenium reset the site state through the extension instead of re-implementing the cleanup in test code, using the same presets and the same Scope Guard.
- **Preset.** A custom preset with **After cleaning: Don't reload** and no cookies, for example `client-state` (Local Storage, IndexedDB, Cache Storage).
- **Steps.**
  1. In **Options → Test Mode**, switch Test Mode on and list the origins of your test environment under "Allowed origins" (default `http://localhost` and `http://127.0.0.1`; an entry without a port allows any port). Choose **Save origins**.
  2. In the test script, send `chrome.runtime.sendMessage(EXTENSION_ID, { action: 'ping' })` and assert `enabled: true`.
  3. Send `{ action: 'clean', preset: 'client-state' }` before each test and assert `ok: true`.
  4. Let the script clear cookies itself (`context.clearCookies()` or `Network.deleteCookies`): exact cookies need a per-origin grant that only a person can give.
  5. Switch Test Mode off after the run if the browser profile is reused.
- **Expected result.** The reply holds `ok`, `origin`, `presetId`, a value-free `result` and `dropped`. A page that is not allow-listed gets `ORIGIN_NOT_ALLOWED`; a preset with domain-wide cookies gets `DOMAIN_WIDE_NOT_ALLOWED`; with Test Mode off every `clean` gets `TEST_MODE_DISABLED`.
- **Evidence.** Keep the `response` object in the test log. Test Mode creates no report file; for a ticket, rehearse the same preset once from the popup and attach that report.
- **More.** Code examples, the full protocol and the error table are in [automation.md](automation.md).
- **Design screens.** [Options](../design/exports/png/Options.png).

## Design references

The PNG files linked above live in `design/exports/png/`. They are **design references** from the design canvas, not screenshots of the shipped extension: layout, wording and example numbers (domains, counts, dates) may differ from the released UI, and the numbers are sample data. When the design and the extension disagree, the extension is right. Screens used here:

| Name | File | Shows |
| --- | --- | --- |
| Popup main | [PopupMain.png](../design/exports/png/PopupMain.png) | Target origin, presets, data types, cookie summary, range and after-action |
| Popup cookies | [PopupCookies.png](../design/exports/png/PopupCookies.png) | Exact Cookie Mode: host-only, partitioned and shared cookies |
| Popup confirm | [PopupConfirm.png](../design/exports/png/PopupConfirm.png) | What will be removed and what is not touched |
| Popup result | [PopupResult.png](../design/exports/png/PopupResult.png) | Before/after table and the Copy summary, Export JSON and Markdown actions |
| Popup unsupported | [PopupUnsupported.png](../design/exports/png/PopupUnsupported.png) | Unsupported page, manual target and recent origins |
| Options | [Options.png](../design/exports/png/Options.png) | Presets, per-origin permissions, Test Mode, history and shortcuts |

Additional design boards: [PopupOrigins.png](../design/exports/png/PopupOrigins.png) (several origins) and [PopupRange.png](../design/exports/png/PopupRange.png) (time range).
