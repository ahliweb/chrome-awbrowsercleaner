# Data Dictionary — AW Browser Cleaner

Every piece of data the extension stores, exchanges or exports, derived from the code (`settings.js`, `cleanup-core.js`, `presets.js`, `report.js`, `background.js`, `options.js`). If you change a shape, change this document in the same pull request.

Rules that apply to everything below:

- Nothing is ever sent off the device by the extension.
- No cookie values and no storage contents are stored, exported or returned. Cookie metadata (name, domain, flags) is used in memory only.
- All origins are exact (`scheme://host:port`, no path, no wildcard). Origins in storage are validated again when read.

## Storage keys

All keys are prefixed `aw.`. Quotas (Chrome): `storage.sync` 100 KB total and 8 KB per item, `storage.local` 10 MB, `storage.session` 10 MB. Everything here is far below these limits.

| Key | Area | Type | Shape | Max size | Retention | Written by | Read by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `aw.preset.<id>` | sync | object, one key per custom preset | [Preset](#preset) | 50 presets, each well under 8 KB | Until deleted in Options | Options (`saveCustomPreset`, import) | Popup, Options, service worker (`getCustomPresets`) |
| `aw.lastPreset` | sync | string | Preset id (`^[a-z0-9][a-z0-9-]{0,39}$`) | 40 chars | Overwritten on every successful cleanup | Popup, service worker (`setLastPreset`) | Popup, service worker (`getLastPreset`) |
| `aw.lastPresetByOrigin` | local | array | `[{ origin, presetId }]`, oldest first | 100 entries | Oldest dropped beyond 100; no UI clears it today (`clearLastPresetMemory` exists but nothing calls it) | Popup, service worker (`setLastPreset`) | Popup (`getLastPresetForOrigin`) |
| `aw.recentOrigins` | local | array | `[{ origin, at }]`, newest first; `at` is epoch ms | 3 entries | Not recorded while history is off; cleared in Options | Popup, service worker (`addRecentOrigin`) | Popup, Options (`getRecentOrigins`) |
| `aw.history` | local | array | `[`[History entry](#history-entry)`]`, newest first | 20 entries | Not recorded while history is off; cleared in Options | Popup, service worker (`addHistoryEntry`) | Options (`getHistory`, export) |
| `aw.historyEnabled` | local | boolean | `true` when absent | 1 value | Until changed | Options (`setHistoryEnabled`) | Options, service worker (`getHistoryEnabled`) |
| `aw.testMode` | local | object | `{ enabled: boolean, allowedOrigins: string[] }`; defaults `{ enabled: false, allowedOrigins: ['http://localhost', 'http://127.0.0.1'] }` | 20 allowed origins | Until changed | Options (`setTestMode`) | Popup, Options, service worker (`getTestMode`) |
| `aw.sessionStart` | session | number | Epoch ms of the start of a test session | 1 value | Until the session is ended or the browser closes | Options (`startSession`, `clearSession`) | Popup, Options (`getSessionStart`) |
| `aw.pendingConfirmation` | session | object | `{ presetId, origin, at }` | 1 value | Read once and removed; valid for 60 seconds (`PENDING_CONFIRMATION_TTL_MS`); discarded when the browser closes | Service worker (`setPendingConfirmation`) | Popup (`takePendingConfirmation`) |
| `aw.permissionGrants` | local | array | `[{ origin, kind, at }]`; `kind` matches `^[a-zA-Z][a-zA-Z0-9_-]{0,31}$` (the popup writes `exactCookies`) | 200 entries | Removed when the user revokes access in Options; oldest dropped beyond 200 | Popup (`recordPermissionGrant`), Options (`removePermissionGrant`) | Options (`listPermissionGrants`) |

"Written by / read by" lists the callers in `popup.js`, `options.js` and `background.js` at the time of writing; the popup is the file most likely to change.

Reads are defensive: malformed entries are dropped (for example a recent origin that is not an exact origin), and `aw.history` and `aw.recentOrigins` are truncated to their caps on read.

## Plan

The single description of what will be deleted. The confirmation screen, the result screen, the evidence report and `executePlan` read the same object. Built by `createPlan(input)`, checked by `validatePlan(plan)` (Scope Guard). See [architecture.md](architecture.md) for the semantics.

| Field | Type | Values / limits |
| --- | --- | --- |
| `version` | number | `1` |
| `source` | string | `popup`, `shortcut`, `contextMenu`, `testMode` |
| `origins` | string[] | 1 to 10 exact origins, de-duplicated; no wildcard, no `@`, no path |
| `dataTypes` | string[] | At least one of `cookies`, `sessionStorage`, `localStorage`, `indexedDB`, `fileSystems`, `cache`, `cacheStorage`, `serviceWorkers`, in registry order. `history`, `downloads`, `formData`, `passwords`, `pluginData`, `appcache`, `webSQL` are forbidden |
| `cookieMode` | string | `exact` (default) or `domainWide` (never from `testMode`) |
| `cookieSelection` | object | `{ includeShared: string[], keepNames: string[] }` (cookie ids and names) |
| `since` | number | `0` for all time, else epoch ms not in the future; not allowed with exact cookies |
| `after` | string | `none`, `reload`, `hard`, `start` |
| `startPath` | string | Starts with a single `/`; used when `after` is `start` |
| `presetId` | string | Preset id or `custom` |
| `tab` | object or null | `{ id, origin, storeId? }`; required for `sessionStorage` and any after-action; `origin` must be in `origins` |

No property whose name contains `exclude` is accepted anywhere.

## Preset

Built-in presets (`logout`, `fresh`, `stale`, `full`) are code; custom presets are stored under `aw.preset.<id>` and exported/imported as JSON. A preset never widens a cleanup: it only pre-selects types, cookie mode and the after-action.

| Field | Type | Rules |
| --- | --- | --- |
| `id` | string | `^[a-z0-9][a-z0-9-]{0,39}$`; not a built-in id |
| `name` | string | 1 to 60 characters, no control characters (custom presets) |
| `dataTypes` | string[] | Non-empty; known types only; normalized to registry order |
| `cookieMode` | string | `exact` (default) or `domainWide` |
| `after` | string | `none` (default), `reload`, `hard`, `start` |
| `startPath` | string | `/` default; single leading `/`, at most 200 characters, no control characters or backslash |
| `boundOrigin` | string, optional | One exact origin the preset was designed for. Informational: never redirects a cleanup |
| `origins` | string[], optional | Extra exact origins; with `boundOrigin` at most 10 in total |
| `keepCookieNames` | string[], optional | Up to 20 cookie names (RFC 6265 token characters, at most 128 characters each) that exact cookie removal keeps |

Unknown properties are rejected, and so is any property containing `exclude`. At most 50 custom presets exist (also the import limit).

### Example: "Client state only"

```json
{
  "id": "client-state-only",
  "name": "Client state only",
  "dataTypes": ["sessionStorage", "localStorage", "indexedDB"],
  "cookieMode": "exact",
  "after": "reload",
  "startPath": "/"
}
```

## Presets export file

File name `aw-cleaner-presets-<YYYYMMDD>.json`. Import is atomic: any problem rejects the whole file, and imported presets replace existing ones with the same id.

```json
{
  "format": "aw-browser-cleaner-presets",
  "version": 1,
  "exportedAt": "2026-10-23T08:00:00.000Z",
  "presets": [ { "id": "client-state-only", "name": "Client state only", "dataTypes": ["sessionStorage", "localStorage", "indexedDB"], "cookieMode": "exact", "after": "reload", "startPath": "/" } ]
}
```

## Execution result

Returned by `executePlan(plan)`. Failures of individual steps are recorded, never thrown (a Scope Guard violation throws `ScopeGuardError` before any API call).

| Field | Type | Notes |
| --- | --- | --- |
| `ok` | boolean | `true` when the after-action succeeded and no origin has errors |
| `startedAt`, `finishedAt`, `durationMs` | number | Epoch ms and elapsed ms |
| `perOrigin[]` | object | `{ origin, types, cookies, errors }` |
| `perOrigin[].types` | object | Data type key to `ok`, `skipped` or `error` |
| `perOrigin[].cookies` | object or null | `{ removed, kept, failed }` counts (Exact Cookie Mode) |
| `perOrigin[].errors[]` | object | `{ type, code, message }`; codes: `SESSION_STORAGE_FAILED`, `COOKIE_PERMISSION_MISSING`, `COOKIE_READ_FAILED`, `COOKIE_REMOVE_FAILED`, `BROWSING_DATA_FAILED` |
| `after` | object | `{ action, ok, error? }`; `deferred: true` when the caller runs the after-action later |

## Snapshot

Counts taken from inside the top frame of a tab on the origin (`snapshotProbe` in `page-probes.js`), plus the cookie count. Every field is a number, or `null` when it cannot be measured.

| Field | Meaning |
| --- | --- |
| `cookies` | Number of cookies that apply to the origin. Added by the popup from the cookie engine, not by the page probe; `null` when per-origin cookie access has not been granted |
| `sessionStorage`, `localStorage` | Number of keys |
| `indexedDB` | Number of databases (`indexedDB.databases()`) |
| `cacheStorage` | Number of caches |
| `serviceWorkers` | Number of registrations |
| `fileSystems` | Number of top-level OPFS entries |
| `cache` | Always `null` (the HTTP cache cannot be counted); shown as "–" |
| `usage`, `quota` | Bytes from `navigator.storage.estimate()` |
| `persisted` | `navigator.storage.persisted()` or `null` |

## Evidence report (JSON)

Built by `buildReport` in `report.js`; exported as JSON, Markdown or a short clipboard summary. File name pattern `aw-cleaner-<host>-<YYYYMMDD-HHmmss>.<json|md>`, where `<host>` is the first origin's hostname lowercased, with `-<port>` appended when a port is present, and the time is local time in the report's `timeZone`.

| Field | Type | Notes |
| --- | --- | --- |
| `format` | string | `aw-browser-cleaner-report` |
| `version` | number | `1` |
| `generatedAt` | string | ISO 8601 UTC |
| `timeZone` | string | IANA zone used for the file name and the Markdown footer |
| `extension.version` | string or null | From the manifest |
| `browser` | object | `{ chromeVersion: string or null, userAgent?: string }` |
| `ok` | boolean | `true` only when the run succeeded and `errors` is empty |
| `origins` | string[] | Exact origins |
| `preset` | string | Preset id |
| `scope` | string | `exact` or `wide` |
| `dataTypes` | string[] | From the plan |
| `cookieMode` | string | `exact` or `domainWide` |
| `since` | number | `0` or epoch ms |
| `after` | object | `{ action, ok: boolean or null, error? }` |
| `durationMs` | number | |
| `perOrigin[]` | object | `{ origin, rows, cookies, errors }` |
| `perOrigin[].rows[]` | object | `{ type, before, after, status, note? }` for each data type and a trailing `usage` row. `status`: `cleared`, `kept`, `unchanged`, `unknown`. `note`: `notMeasurable`, `partial`, `increased`, `keptCookies` |
| `perOrigin[].cookies` | object or null | `{ removed, kept, failed }` |
| `errors[]` | object | `{ origin?, type?, code, message }`; messages are cut to 300 characters |

The keys `value`, `cookieValue`, `storageValue`, `items` and `entries` are forbidden at any depth: `assertNoSensitiveValues` throws when building or serializing a report that contains one. The Markdown report ends with "This report contains counts and metadata only. No cookie values or storage contents are included."

## History entry

Stored in `aw.history`. `addHistoryEntry` copies only these fields (a whitelist) and drops everything else.

| Field | Type | Limit |
| --- | --- | --- |
| `id` | string | 64 characters |
| `at` | string | ISO 8601, 40 characters |
| `origins` | string[] | Exact origins only, at most 10; an entry without a valid origin is not stored |
| `presetId` | string | 40 characters, default `custom` |
| `durationMs` | number | `0` when not finite |
| `ok` | boolean | `false` only when explicitly `false` |

History export (Options → Export all, file `aw-cleaner-history-<YYYYMMDD-HHmmss>.json`):

```json
{
  "format": "aw-browser-cleaner-history",
  "version": 1,
  "exportedAt": "2026-10-23T08:00:00.000Z",
  "history": [ { "id": "...", "at": "...", "origins": ["https://app.example.test"], "presetId": "logout", "durationMs": 14, "ok": true } ]
}
```

## Test Mode message protocol

Sent with `chrome.runtime.sendMessage(EXTENSION_ID, message)` from a page matching `externally_connectable` (`http://localhost/*`, `http://127.0.0.1/*`). Full description, error table and examples: [automation.md](automation.md).

| Request | Response |
| --- | --- |
| `{ action: 'ping' }` | `{ ok: true, enabled: boolean }` |
| `{ action: 'clean', preset: '<id>' }` | `{ ok, origin, presetId, result, dropped, ignoredPayloadOrigin? }` or `{ ok: false, error, ... }` |

`result` is the value-free view of the execution result: `{ ok, durationMs, perOrigin: [{ origin, types, cookies, errors }], after: { action, ok } }`. `error` is one of `BAD_REQUEST`, `UNKNOWN_ACTION`, `TEST_MODE_DISABLED`, `ORIGIN_NOT_ALLOWED`, `PRESET_NOT_FOUND`, `DOMAIN_WIDE_NOT_ALLOWED`, `PLAN_INVALID`, `SCOPE_GUARD`, `INTERNAL_ERROR`.

## Where data lives

| Data | Lives in | Leaves the device? |
| --- | --- | --- |
| Presets and last preset | `chrome.storage.sync` | Only through Chrome sync, if the user enabled it; AhliWeb never receives it |
| Origins, history, grants, Test Mode | `chrome.storage.local` | No |
| Session start, pending confirmation | `chrome.storage.session` | No |
| Reports, preset and history exports | Memory, then a file the user chooses to save | Only if the user shares the file |
| Cookie metadata | Memory of the popup or worker during a cleanup | No; values are never read |
