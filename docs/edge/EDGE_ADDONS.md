# Microsoft Edge Add-ons: build, submit and test

AW Browser Cleaner is a Chromium Manifest V3 extension. The same package that
ships to the Chrome Web Store runs in Microsoft Edge, so the Edge release uses
the same code, the same `manifest.json` and the same file list. The only
difference is the artifact name, so the two uploads can be told apart.

Edge uses the same `chrome.*` APIs as Chrome. No Edge-specific code path or
`browser.*` polyfill is needed.

## 1. Build and validate the Edge package

Run from the repository root:

```sh
bun scripts/build-package.js --target=edge
bun scripts/validate-package.js --target=edge
```

Output in `dist/`:

- `aw-browser-cleaner-edge-v<version>.zip`
- `aw-browser-cleaner-edge-v<version>.zip.sha256`

The default target is Chrome and keeps its own names
(`aw-browser-cleaner-v<version>.zip`). Targets:

| Target   | Artifact name                              |
| -------- | ------------------------------------------ |
| `chrome` | `aw-browser-cleaner-v<version>.zip` (default) |
| `edge`   | `aw-browser-cleaner-edge-v<version>.zip`  |

Pass a version to validate an older build, in either order:

```sh
bun scripts/validate-package.js 1.2.0 --target=edge
bun scripts/validate-package.js --target=edge 1.2.0
```

An unknown target exits with status 1. Both scripts list the supported targets.

`package.json` has no `edge` script; use the commands above directly.

To check that the zip has only runtime files:

```sh
unzip -Z1 dist/aw-browser-cleaner-edge-v<version>.zip
```

## 2. Submit in Partner Center

Edge Add-ons are submitted in the Microsoft Partner Center. The form labels
below are a guide; check them against the current Partner Center form before
submitting.

1. **Create or open the extension.** Sign in to Partner Center with the Edge
   Add-ons developer account and start a new extension submission (or update
   the existing one).
2. **Upload the package.** Upload `dist/aw-browser-cleaner-edge-v<version>.zip`
   for the release version. Do not upload the Chrome zip.
3. **Store listing.** Use the text in
   [`docs/chrome-web-store/STORE_LISTING.md`](../chrome-web-store/STORE_LISTING.md):
   name, short description, detailed description, category (Developer Tools)
   and the support contact. Make sure the description describes exact-origin
   behaviour and the cookie warning, as that file requires.
4. **Screenshots.** Upload current screenshots of the real popup UI. Do not
   use mock-ups. See the screenshot plan in `STORE_LISTING.md`.
5. **Privacy policy URL.** Enter
   `https://ahliweb.com/privacy-browser-ext/`. The URL must resolve publicly
   over HTTPS. It must match what the shipped package does.
6. **Permission justifications.** Use the same wording as the Chrome Web Store.
   See the "Permission justifications" section of
   [`STORE_LISTING.md`](../chrome-web-store/STORE_LISTING.md) and
   [`docs/PERMISSION_MATRIX.md`](../PERMISSION_MATRIX.md).
7. **Certification notes.** Describe how to test the extension: open an HTTP(S)
   page, open the popup, pick a preset and clean the site. Say that cookie
   cleanup can sign the user out of related subdomains.
8. **Submit** for certification, then check the status in Partner Center.

### Known gap before submission: permission justifications

The manifest declares more permissions than the store copy justifies:

- `activeTab`, `browsingData`, `contextMenus`, `cookies`, `scripting`, `storage`
- `optional_host_permissions`: `http://*/*`, `https://*/*`

`PERMISSION_MATRIX.md` now maps each of these to a feature. However, the
"Permission justifications for Developer Dashboard" section of
`STORE_LISTING.md` still covers only `browsingData` and `activeTab`, and it says
that no host permissions are requested. Before the Edge submission, add the
justifications for `contextMenus`, `cookies`, `scripting`, `storage` and the
optional host permissions to the Partner Center form, using the matrix as the
source. Correct the "host_permissions not requested" wording as well, because
the manifest declares optional host permissions. Do not submit Edge with the
current `STORE_LISTING.md` wording.

## 3. Test checklist

Use an unzipped copy of the Edge package, or the repository root.

### Load the extension

1. Open `edge://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose the folder that contains `manifest.json`.
4. Confirm the extension loads with no errors on its card.

### Presets

Run each preset from the popup on a test page that you have set up with
cookies, Local Storage, IndexedDB, Cache Storage and a Service Worker. The
presets are `logout`, `fresh`, `stale` and `full`.

- [ ] `logout`: runs, and only the chosen data is removed
- [ ] `fresh`: runs, and only the chosen data is removed
- [ ] `stale`: runs, and only the chosen data is removed
- [ ] `full`: runs, and only the chosen data is removed

### Exact cookies

- [ ] Clean a page on `https://example.test`. Cookies for that origin are removed.
- [ ] Cookies for a different host (for example a sibling subdomain) are not
      removed in exact mode.
- [ ] Note: cookies are scoped by host, not by port. A cookie set on
      `localhost:3000` is also sent to `localhost:8080`, so a port change does
      not isolate cookies. See [ADR 0001](../adr/0001-firefox-port.md).
- [ ] The related-subdomain warning is shown before cookie-inclusive cleanup.
- [ ] Cookies set by the cleaned site are removed when the cleanup includes
      cookies.

### Other data types

- [ ] Local Storage, IndexedDB, Cache Storage and Service Workers are cleared
      for the selected origin only.
- [ ] sessionStorage is cleared for the active tab only (this needs the active
      tab and `scripting`).
- [ ] Unsupported pages (`edge://`, `chrome://`, `file://`, `about:`) are
      rejected, and nothing is deleted.
- [ ] Pages on `chromewebstore.google.com` are rejected. The code lists only
      that host as a blocked store page (`WEB_STORE_HOSTS` in
      `chrome-helpers.js`). Behaviour on the Microsoft Edge Add-ons store page
      is to be verified, because it is not in that list.

### Keyboard shortcuts

Open `edge://extensions/shortcuts` and check the shortcuts for this extension.

- [ ] `clean-last-preset`: suggested key `Alt+Shift+K`
- [ ] `clean-logout`: suggested key `Alt+Shift+L`
- [ ] Each shortcut runs its command on the active tab
- [ ] Edge may assign a different key or leave the shortcut unset. Record what
      Edge shows, and keep the store listing's wording consistent with it.

### Incognito

- [ ] With "Allow in Incognito" off, the extension does nothing in an InPrivate
      window. This is the default.
- [ ] With it on, the behaviour matches
      [ADR 0002](../adr/0002-incognito-mode.md). The `browsingData` effect is
      still to be verified there.

## References

- [`docs/chrome-web-store/STORE_LISTING.md`](../chrome-web-store/STORE_LISTING.md)
- [`docs/PERMISSION_MATRIX.md`](../PERMISSION_MATRIX.md)
- [`docs/chrome-web-store/RELEASE_CHECKLIST.md`](../chrome-web-store/RELEASE_CHECKLIST.md)
- [`docs/adr/0002-incognito-mode.md`](../adr/0002-incognito-mode.md)
- Microsoft Edge Add-ons publishing documentation (Microsoft Learn). Look up the
  current page from the Partner Center help links; the exact URL is not pinned here.
