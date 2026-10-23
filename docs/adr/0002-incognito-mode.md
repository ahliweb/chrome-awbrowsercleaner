# ADR 0002: Incognito mode

- **Status:** Accepted
- **Date:** 2026-10-23
- **Scope:** How the extension behaves in incognito windows and across Chrome
  profiles, and the verification still outstanding.

## Context

### Manifest

`manifest.json` does not declare the `incognito` key. Chrome therefore applies
its default mode, `spanning`. The extension runs in incognito windows only when
the user turns on "Allow in Incognito" for it on `chrome://extensions`.

### Spanning mode

In `spanning` mode one extension process (one service worker) serves both the
regular and the incognito profile. The popup and the service worker see the
same code and the same extension storage, but they run in the context of the
window that opened them.

### Cookie stores

Each browsing context reads and writes cookies from a cookie store. The regular
profile uses a store whose id varies by platform. The incognito store id is
typically `"1"`. This is common behaviour, not a guaranteed value, so the code
does not hard-code it.

The extension finds the store for a tab at runtime:

- `chrome-helpers.js`, `getCookieStoreId(api, tabId)` calls
  `cookies.getAllCookieStores()` and returns the id of the store whose `tabIds`
  contains the tab. It returns `undefined` if the lookup fails.
- `tabContext()` in the same file stores that id as `storeId` on the tab
  descriptor. The service worker reads it through `getCookieStoreId` as well
  (`background.js`).
- `cleanup-core.js`, `collectCookies(api, origin, storeId)` adds `storeId` to
  every `cookies.getAll` query (the origin URL query and the domain queries).
  When `storeId` is undefined the query has no store key.
- `cookie-engine.js`, `cookieRemovalDetails` copies the cookie's `storeId` into
  each `cookies.remove` call, so removals stay in the store they were read from.

### browsingData

`cleanup-core.js`, `runBrowsingData` calls
`browsingData.remove(options, dataTypeSet)`. The options built by
`buildRemovalOptions` are `origins`, `originTypes` and `since`. The API has no
store selector, so the extension cannot choose a cookie store or a profile in
this call.

What is known from the code:

- The call contains no store or profile key, so the extension does not say
  which profile it means.

What is not verified:

- **To be verified by E2E:** whether `browsingData.remove` called from the
  service worker or popup in an incognito window removes data from the incognito
  profile, from the regular profile, or from both, when the extension is in
  spanning mode.

## Decision

1. **Keep `spanning` mode for now.** The extension has no separate incognito
   state to manage, and the cookie-store handling above already keeps cookie
   reads and removals in the store of the active tab.
2. **Track an E2E verification as a follow-up.** The E2E suite must cover:
   - an incognito window with "Allow in Incognito" enabled, clean a site with
     cookies and storage in both profiles, and confirm which profile lost data;
   - that cookies in the regular store survive an incognito cleanup of the same
     origin, and the reverse;
   - the case where `getCookieStoreId` returns `undefined`, and confirm which
     store the fallback query (no `storeId`) reads.
3. **Do not change the manifest** (no `incognito: "split"` or
   `"not_allowed"`) until the E2E result is known.

## Consequences

- With "Allow in Incognito" off (the default), the extension does nothing in
  incognito windows.
- With it on, the popup works in incognito, but the `browsingData` result is
  not yet verified. The UI must not claim that incognito data is cleared until
  the E2E follow-up is closed.
- Cookie handling depends on `getAllCookieStores()` returning a `tabIds` entry
  for the active tab. If that lookup fails, the cookie query falls back to a
  query without `storeId`. Which store that query reads in an incognito window
  is part of the E2E follow-up.

## Multiple Chrome profiles

- Each Chrome profile has its own installation of the extension and its own
  extension storage. Settings are not shared between profiles.
- A cleanup runs in the profile whose popup the user opened. The popup and the
  service worker belong to that profile.
- Whether a `browsingData` call scopes exactly to that profile is part of the
  same **to be verified by E2E** item above.

## References

- `manifest.json` (no `incognito` key)
- `chrome-helpers.js` (`getCookieStoreId`, `tabContext`)
- `cleanup-core.js` (`collectCookies`, `runBrowsingData`, `buildRemovalOptions`)
- `cookie-engine.js` (`cookieRemovalDetails`)
- `background.js` (service worker, `getCookieStoreId` use)
- Chrome extensions reference, `incognito` manifest key:
  <https://developer.chrome.com/docs/extensions/reference/manifest/incognito>
- Chrome extensions reference, `cookies` API (`getAllCookieStores`):
  <https://developer.chrome.com/docs/extensions/reference/api/cookies>
- Chrome extensions reference, `browsingData` API:
  <https://developer.chrome.com/docs/extensions/reference/api/browsingData>
