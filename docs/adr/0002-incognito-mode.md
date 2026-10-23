# ADR 0002: Incognito mode

- **Status:** Accepted. Amended after E2E verification: the manifest now
  declares `"incognito": "split"`.
- **Date:** 2026-10-23
- **Scope:** How the extension behaves in incognito windows and across Chrome
  profiles. Verified by E2E (`tests/e2e/incognito.test.js`) on Chrome 141.

## Context

### Manifest

The first version of `manifest.json` did not declare the `incognito` key, so
Chrome applied its default mode, `spanning`; the verified outcome below changed
that to `split`. In both modes the extension runs in incognito windows only when
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

## Verified outcome (E2E, Chrome 141.0.7390.37)

`tests/e2e/incognito.test.js` turns on "Allow in Incognito" (through
`chrome.developerPrivate.updateExtensionConfiguration` from `chrome://extensions`;
the toggle in the `extensions-manager` shadow DOM works as well), opens a real
incognito window from the extension, seeds the same origin in both profiles with
different values, runs the "Fresh start" preset through the shortcut path
(`runPresetOnTab`) for the tab of one profile and reads both profiles back.

Result in the default `spanning` mode (the original decision) - a real scope bug:

| Data of origin A | Cleanup from the incognito tab | Result |
| --- | --- | --- |
| Cookies | removed in the incognito cookie store (store `"1"`), regular store `"0"` untouched | correct |
| sessionStorage | cleared in the incognito tab | correct |
| localStorage, IndexedDB, Cache Storage, Service Workers, OPFS | **incognito data stayed, the regular profile's data for the same origin was removed** (its tab's sessionStorage went with it) | wrong profile |

`browsingData.remove` has no profile selector and acts on the profile of the
extension instance that calls it. In spanning mode that is always the regular
profile, whichever window the user cleaned from. A cleanup started in an
incognito window therefore left the incognito data in place and silently
deleted regular-profile data. The reverse direction (cleaning from a regular
window) was correct.

A cookie query without `storeId` (the fallback when `getCookieStoreId` returns
`undefined`) is answered from the store of the calling instance: in spanning
mode the regular store, even for an incognito tab; in split mode the incognito
store from the incognito instance.

On Chrome for Testing 157 (beta, October 2026), `chrome.cookies.getAllCookieStores()`
inside the incognito instance does not list the incognito tab in `tabIds`, so
`getCookieStoreId` returns `undefined` there. With split mode this is safe:
the fallback query is answered from the incognito store, and the E2E suite
asserts the outcome (incognito cookies removed, regular profile unchanged)
rather than the lookup itself.

## Decision

1. **Use `"incognito": "split"`.** An incognito window then runs its own
   instance of the extension (its own service worker, popup and options), and
   every `browsingData` call from it acts on the incognito profile. E2E with
   split mode: cleaning from the incognito window removes all selected data of
   incognito A (cookies, sessionStorage, localStorage, IndexedDB, Cache Storage,
   Service Workers, OPFS) and leaves the regular profile byte-for-byte as it
   was; cleaning from the regular window leaves the incognito window untouched.
   The incognito tab uses its own cookie store and the fallback query reads that
   store.
2. **Settings are shared.** `chrome.storage.sync` and `chrome.storage.local`
   are visible to the incognito instance (verified), so custom presets, history
   and the other settings are the same in both windows. `chrome.storage.session`
   (the pending confirmation of a shortcut) is per instance, which is what the
   shortcut flow needs.
3. **Context menus are per instance, and `contextMenus.removeAll()` clears the
   items of both instances (verified).** The incognito instance never receives
   `onInstalled`, so `background.js` creates its menu at worker start, and its
   `rebuildContextMenus` skips `removeAll()`. Known limitation: when the
   regular instance rebuilds its menu (a custom preset changed), it clears the
   incognito items too; they come back the next time the incognito worker
   starts. Menus are a convenience; the toolbar popup and the shortcuts are not
   affected.
4. **"Allow in Incognito" stays the user's choice.** It is off by default and
   the extension does nothing in incognito windows until it is on. Chrome
   reloads the extension when the setting changes.

## Consequences

- With "Allow in Incognito" off (the default), the extension does nothing in
  incognito windows.
- With it on, a cleanup started in an incognito window only affects the
  incognito profile, and one started in a regular window only affects the
  regular profile.
- Not covered by E2E: the popup UI opened inside an incognito window (the
  worker path, `runPresetOnTab`, runs the same `executePlan`), and the stale
  incognito context-menu items after a preset change described above.

## Multiple Chrome profiles

- Each Chrome profile has its own installation of the extension and its own
  extension storage. Settings are not shared between profiles.
- A cleanup runs in the profile whose popup the user opened. The popup and the
  service worker belong to that profile.
- A cleanup runs in the profile whose popup the user opened. This holds for
  the incognito profile in split mode (see the verified outcome above); a
  different Chrome profile is a different installation and is not reachable
  from this one.

## References

- `manifest.json` (`"incognito": "split"`)
- `tests/e2e/incognito.test.js`, `tests/e2e/helpers.js` (`enableIncognitoAccess`, `openIncognitoPage`, `workerEvaluateIn`)
- `chrome-helpers.js` (`getCookieStoreId`, `tabContext`)
- `cleanup-core.js` (`collectCookies`, `runBrowsingData`, `buildRemovalOptions`)
- `cookie-engine.js` (`cookieRemovalDetails`)
- `background.js` (service worker, `getCookieStoreId` use, per-instance context menus)
- Chrome extensions reference, `incognito` manifest key:
  <https://developer.chrome.com/docs/extensions/reference/manifest/incognito>
- Chrome extensions reference, `cookies` API (`getAllCookieStores`):
  <https://developer.chrome.com/docs/extensions/reference/api/cookies>
- Chrome extensions reference, `browsingData` API:
  <https://developer.chrome.com/docs/extensions/reference/api/browsingData>
