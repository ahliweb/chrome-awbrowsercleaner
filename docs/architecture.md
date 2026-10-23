# Architecture — AW Browser Cleaner

> **Core principle (non-negotiable):** every deletion targets an explicit list of exact
> origins (`scheme://host:port`). Never global, never wildcard, never "everything except".

This document is the contract between the extension's modules. Every runtime file is an
**ES module** (`<script type="module">` in pages, `"type": "module"` for the service worker).
Pure modules have no `chrome.*` or DOM dependency and are unit-tested directly by Bun.

## Module map

| File | Kind | Responsibility |
| --- | --- | --- |
| `origin-utils.js` | pure | `normalizeTarget(input)`, `validateOrigin(origin)`, `VALID_SCHEMES`. |
| `cleanup-core.js` | pure + single gate | Data type registry, plan creation, **Scope Guard** (`validatePlan`), `describePlan`, `confirmationLevel`, and `executePlan` — the **only** place allowed to call `chrome.browsingData.*` or `chrome.cookies.remove` (enforced by ESLint). |
| `cookie-engine.js` | pure | Exact Cookie Mode: applicability of a cookie to an origin, classification (host-only / partitioned / shared), redaction, removal details. |
| `presets.js` | pure | Built-in presets, custom preset schema validation, JSON import/export. |
| `report.js` | pure | Snapshot diff, evidence report (JSON/Markdown), file names, history summaries, sensitive-value guard. |
| `page-probes.js` | injected | Self-contained functions passed to `chrome.scripting.executeScript` (snapshot, sessionStorage clear). |
| `settings.js` | storage adapter | `chrome.storage` wrapper (sync/local/session injected) for presets, last preset, recent origins, history, Test Mode, test session start, permission grant log. |
| `i18n.js` | DOM helper | `getMessage`, `localizeDocument` shared by popup and options. |
| `popup.html/js` | UI | Thin controller: screens 1–5 (main, cookies, confirm, result, unsupported). |
| `options.html/js` | UI | Options page: presets, per-origin permissions, Test Mode, history & evidence, shortcuts. |
| `background.js` | service worker | Keyboard commands, context menus, badge feedback, Test Mode (`runtime.onMessageExternal`). |

## Data types (`DATA_TYPES` in `cleanup-core.js`)

Order is the UI order. `api` is the `chrome.browsingData` `DataTypeSet` key.

| key | group | api | Notes |
| --- | --- | --- | --- |
| `cookies` | `session` | `cookies` (domain-wide mode only) | Exact mode uses `chrome.cookies` via `cookie-engine.js`. `risk: 'high'`. |
| `sessionStorage` | `session` | — | Cleared with `chrome.scripting` in frames whose `location.origin === target`. Only for the active tab's origin. |
| `localStorage` | `storage` | `localStorage` | |
| `indexedDB` | `storage` | `indexedDB` | |
| `fileSystems` | `storage` | `fileSystems` | Includes OPFS. |
| `cache` | `cache` | `cache` | HTTP cache. Not countable (snapshot shows "–"). |
| `cacheStorage` | `cache` | `cacheStorage` | Service Worker Cache Storage. |
| `serviceWorkers` | `cache` | `serviceWorkers` | |

Never added (cannot be limited to an origin): `history`, `downloads`, `formData`, `passwords`,
`pluginData`, `appcache`, `webSQL`. `FORBIDDEN_TYPES` lists them; Scope Guard rejects them.

## Plan

A plan is the single description of what will be deleted. The confirmation screen, the result
screen, the evidence report and `executePlan` all read the same object.

```js
{
  version: 1,
  source: 'popup' | 'shortcut' | 'contextMenu' | 'testMode',
  origins: ['https://app.example.test'],     // 1..MAX_ORIGINS (10), validated, de-duplicated
  dataTypes: ['cookies', 'localStorage'],      // DATA_TYPES keys, in DATA_TYPES order
  cookieMode: 'exact' | 'domainWide',
  cookieSelection: { includeShared: [/* cookie ids */], keepNames: [/* cookie names */] },
  since: 0,                                    // 0 = all time, else epoch ms (<= now)
  after: 'none' | 'reload' | 'hard' | 'start',
  startPath: '/',                              // used when after === 'start'; path only
  presetId: 'custom',
  tab: { id: 12, origin: 'https://app.example.test', storeId: '0' } | null
}
```

`createPlan(input)` returns `{ ok: true, plan }` or `{ ok: false, code, error }`.

### Scope Guard (`validatePlan(plan)`)

Runs inside `executePlan` **before any Chrome API call**; returns `{ ok, errors: [{ code, message }] }`.

- `origins` must be a non-empty array of at most `MAX_ORIGINS` (10) strings, each passing
  `validateOrigin()` exactly (no wildcard, no bare host, no path/query/hash, http/https only).
- `excludeOrigins` (any property name containing it) is rejected — "everything except" mode is forbidden.
- Unknown or forbidden data types are rejected; at least one type is required.
- `since` must be `0` or a finite timestamp not in the future; `since > 0` with exact cookies is rejected
  (`chrome.cookies` has no creation time).
- `cookieMode: 'domainWide'` is rejected when `source === 'testMode'`.
- `after !== 'none'` and `sessionStorage` require `tab` whose `origin` is in `origins`.
- `startPath` must start with `/` and must not start with `//`.

Every `chrome.browsingData.remove` call is built by `buildRemovalOptions({ origins: [origin], since })`,
which always sets `originTypes: { unprotectedWeb: true }` and never sets `excludeOrigins`.

### Confirmation (`confirmationLevel(plan)`)

| Level | When | UI |
| --- | --- | --- |
| `danger` | cookies selected and (`cookieMode === 'domainWide'` or `includeShared.length > 0`) | Red confirm button; shortcuts and Test Mode never execute such a plan without the popup. |
| `review` | cookies selected in exact mode | Blue confirm button ("Clear now"). |
| `none` | no cookies | Executes directly. |

`requiresConfirmation(plan)` is `confirmationLevel(plan) !== 'none'`.

### `describePlan(plan, extras?)`

```js
{
  origin, origins, preset: plan.presetId, scope: 'exact' | 'wide',
  remove: [{ type, labelKey, count }],              // count from extras.counts or null
  keep: [{ kind: 'sharedCookies', count, domain }?, { kind: 'otherOrigins' }, { kind: 'browserData' }],
  notApplicable: [{ type, origin, reason }],         // e.g. sessionStorage for a non-active origin
  after, since
}
```
`keep` always contains `otherOrigins` and `browserData`.

### `executePlan(plan, { api = globalThis.chrome, now = Date.now })`

Order per origin: **sessionStorage → cookies (exact engine) → `browsingData.remove` → after-action** (after-action
only once, for the active tab). Throws `ScopeGuardError` (with `errors`) before touching any API when the plan is invalid.

```js
{
  ok, startedAt, finishedAt, durationMs,
  perOrigin: [{
    origin,
    types: { localStorage: 'ok' | 'skipped' | 'error', ... },
    cookies: { removed: n, kept: n, failed: n } | null,
    errors: [{ type, code, message }]
  }],
  after: { action, ok, error? }
}
```
Exact cookie removal requires the optional host permission for that origin
(`api.permissions.contains({ origins: [origin + '/*'] })`); if missing, the cookie step fails with code
`COOKIE_PERMISSION_MISSING` — there is no silent fallback to domain-wide mode.

## Exact Cookie Mode (`cookie-engine.js`)

- Candidates: `cookies.getAll({ url: origin + '/', partitionKey: {} , storeId })` plus `getAll({ domain: d, partitionKey: {}, storeId })`
  for the host and each parent domain, de-duplicated by `cookieId`.
- `cookieAppliesToOrigin(cookie, origin)`: domain-match (host-only → `domain === host`; domain cookie →
  host equals or ends with `.domain`), `secure` cookies apply to `http://` only on `localhost`/loopback.
  Cookies do not isolate by port (RFC 6265 §8.5) — documented, not hidden.
- Classification: `hostOnly` (removed by default), `partitioned` (CHIPS, `partitionKey.topLevelSite` is the
  target's site; removed by default), `shared` (domain cookies; kept unless selected or domain-wide),
  `ignored` (not applicable / other partitions).
- Cookie values are never read into UI, reports, or storage: `redactCookie()` drops `value`.

## Popup DOM contract (stable hooks for E2E)

Screens are `<section>` elements toggled with the `hidden` attribute; `body[data-screen]` names the active one.

| Screen | Hooks |
| --- | --- |
| Main (`#screenMain`) | `#originInput`, `#fillCurrent`, `#normalizedPreview`, `#presetBar [data-preset]` (`aria-pressed`), `#presetStatus`, `.checkbox-grid input[type=checkbox][value=<type>]`, `[data-count-for=<type>]`, `#selectAll`, `#selectedCount`, `#scopeNote[data-scope]`, `#cookieSummary`, `#cookieManageBtn`, `#extraOrigins`, `#addOriginBtn`, `#rangeSelect`, `#afterSelect`, `#clearBtn` (`.shortcut-tag`), `#statusMessage`, `#optionsBtn`, `#testModeTag` |
| Cookies (`#screenCookies`) | `#cookieBackBtn`, `#cookieModeExact`, `#cookieModeWide`, `#cookieListHostOnly`, `#cookieListPartitioned`, `#cookieListShared` (rows `input[data-cookie-id]`), `#cookiePermissionNotice`, `#cookieGrantBtn`, `#cookieSaveBtn` |
| Confirm (`#screenConfirm`, `body.is-confirming`) | `#confirmOrigin`, `#confirmTypes`, `#confirmKeep`, `#confirmBtn` (`.btn-danger` for `danger`, `.btn-primary` for `review`), `#cancelBtn`; `Esc` cancels |
| Result (`#screenResult`) | `#resultBanner`, `#resultTable tr[data-type]` (`.before`, `.after`), `#copySummaryBtn`, `#exportJsonBtn`, `#exportMdBtn`, `#resultDoneBtn` |
| Unsupported (`#screenUnsupported`) | `#unsupportedScheme`, `#manualTargetInput`, `#manualPreview`, `#manualError`, `#continueBtn`, `#recentOrigins` |

## Permissions

See `docs/PERMISSION_MATRIX.md`. Install-time permissions add no install warnings; host access comes
only from `activeTab` or optional per-origin host permissions requested at the moment of use.
