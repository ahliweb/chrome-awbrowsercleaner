# ADR 0001: Firefox port of AW Browser Cleaner

- **Status:** Accepted
- **Date:** 2026-10-23
- **Scope:** Whether to ship a Firefox build of the extension now.

## Context

AW Browser Cleaner's core rule is exact-origin scope. Every deletion targets an
explicit list of exact origins, written as `scheme://host:port`
(see `cleanup-core.js`, which is the only module allowed to call
`chrome.browsingData.*` or `chrome.cookies.remove`).

Chromium's `browsingData.remove` accepts `origins` in its RemovalOptions, so the
extension can pass `{ origins: [origin], originTypes: { unprotectedWeb: true } }`.
The `origins` key matches the exact scheme, host and port.

Firefox's `browsingData.RemovalOptions` supports `hostnames`, not `origins`
(see the MDN reference below). A hostname-based filter does not separate
`http://example.com`, `https://example.com` and `https://example.com:8443`. Those
three origins all share the hostname `example.com`. A Firefox port that used
`hostnames` would therefore delete data outside the selected exact origin. That
contradicts the exact-origin principle.

Firefox also has no origin-scoped removal for some storage types, and some
Chrome data types have no Firefox equivalent. The table below records what the
Firefox API can and cannot limit to an exact origin. Entries marked "to be
verified" are not yet checked against a Firefox release.

### Per data type

| Data type (`DATA_TYPES` key) | Can Firefox limit it to an exact origin? | How | Notes |
| --- | --- | --- | --- |
| `cookies` | **partial** | `cookies.getAll` / `cookies.remove` with `url` plus `storeId` (cookie store) and, where supported, `firstPartyDomain`. The extension already removes cookies by URL in exact mode (`cookie-engine.js`, `cookieRemovalDetails`). | Cookies are scoped by host and path, not by scheme or port, in both browsers (RFC 6265). Exact-origin cookie removal is therefore not guaranteed in any browser. Whether Firefox accepts `partitionKey` is to be verified. |
| `sessionStorage` | **yes** | `scripting.executeScript` runs a function in each frame whose origin matches the target, then calls `sessionStorage.clear()` (`clearSessionStorageInFrame` in `cleanup-core.js`). | Requires the active tab and the `scripting` permission. Scripting support in the Firefox MV3 runtime is to be verified. |
| `localStorage` | **no** | `browsingData.remove` with `hostnames` only. | Host-level filter. Cannot separate schemes or ports. |
| `indexedDB` | **no** | `browsingData.remove` with `hostnames` only. | Host-level filter. |
| `fileSystems` | **no** | Not a documented Firefox `browsingData` data type. | To be verified against MDN. |
| `cache` | **no** | HTTP cache removal has no origin filter. | To be verified against MDN. |
| `cacheStorage` | **no** | Not a documented Firefox `browsingData` data type. Firefox's `cache` type does not cover Cache Storage. | To be verified against MDN. |
| `serviceWorkers` | **no** | `browsingData.remove` with `hostnames` only. | Host-level filter. Whether it can be narrowed further is to be verified. |

Summary: only `sessionStorage` can be limited to an exact origin on Firefox
today. `cookies` is partial, and the rest are host-level or unfiltered.

Options other than `origins` that the Chromium code relies on (for example
`originTypes`) are Chromium-specific. Any Firefox build would need its own
options builder. This is to be verified against MDN.

## Decision

1. **Do not port to Firefox now.** The Firefox API cannot remove the six
   non-session data types for an exact origin, so a Firefox build would either
   break the exact-origin guarantee or ship a reduced feature set.
2. **Revisit this decision** if Firefox adds origin-scoped removal to
   `browsingData` (for example an `origins` key), or if a verified alternative
   exists for `localStorage`, `indexedDB`, `serviceWorkers` and `cache`.
3. **Any future port must reject data types that cannot be limited to an exact
   origin.** The Firefox build must refuse those types at the same gate that
   `buildDataTypeSet` and `validatePlan` use today. It must not silently fall back
   to `hostnames`. The rule is the same as for `FORBIDDEN_TYPES`: an unscopable
   type is an error, not a broader deletion.

## Consequences

- The Firefox store listing and the Chrome/Edge store listings stay separate.
  No Firefox package is produced by `scripts/build-package.js`.
- Users on Firefox are not offered a cleaner that could remove data from other
  origins on the same host.
- A future port has a clear acceptance test: for every data type the Firefox
  build offers, the E2E suite must show that data from a neighbouring origin
  (different scheme or port on the same host) is not removed.
- Cookie behaviour is documented as host-scoped in every browser, as the store
  listing already states. This ADR does not change that claim.

## References

- MDN, `browsingData.RemovalOptions`:
  <https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/browsingData/RemovalOptions>
- RFC 6454, The Web Origin Concept: <https://www.rfc-editor.org/rfc/rfc6454>
- Repository: `docs/PERMISSION_MATRIX.md`, `docs/architecture.md`,
  `cleanup-core.js` (`DATA_TYPES`, `FORBIDDEN_TYPES`, `buildDataTypeSet`,
  `buildRemovalOptions`, `clearSessionStorageInFrame`).
