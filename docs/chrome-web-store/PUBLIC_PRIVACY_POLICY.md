<!-- markdownlint-disable MD025 -->

# Public Privacy Policy Draft — AW Browser Cleaner

Use this document to update the public privacy-policy page currently served at:

<https://ahliweb.com/privacy-browser-ext/>

Review it against the final manifest and package immediately before publication.

---

# Privacy Policy — AW Browser Cleaner

**Developer:** AhliWeb.com / PT Ahli Web Internasional

AW Browser Cleaner is a Chrome extension that lets users selectively clear site data for a website using Chrome's native browser APIs.

## Summary

- All processing is local. Nothing is ever sent off your device.
- We do not sell personal data.
- The extension does not transmit your browsing history or website content to AhliWeb servers.
- The extension does not use analytics or advertising tracking.
- Cleanup actions occur locally in your browser after you explicitly request them.

## Information processed locally

To perform its function, AW Browser Cleaner may process locally on your device:

- the URL/origin of the active tab,
- a target website/origin you manually enter,
- the site-data categories you select for removal,
- counts of what a website stores (for the before/after report).

This information is used only to perform the requested cleanup and is not transmitted to AhliWeb.

## Information the extension stores on your device

The extension keeps a small amount of its own data in Chrome extension storage (`chrome.storage`):

- your custom presets and the last preset you used (`chrome.storage.sync`; if you use Chrome sync, Chrome may copy these to your other devices through your Google account, and AhliWeb cannot see them),
- the last preset used per website (origin),
- your most recent websites (up to 3, stored as origins only: scheme, host and port, never page paths),
- up to 20 history summaries (time, website origin, preset name, duration, success or failure),
- your Test Mode settings (off by default) and its list of allowed local origins,
- a log of the websites for which you granted cookie access,
- the start time of a test session (kept only until the browser closes).

The extension never stores or exports cookie values, the contents of website storage, full URLs or page content. Snapshots and reports contain counts and metadata only: the interface states "Cookie values are never shown" and "No cookie values or storage contents".

You can turn history off, clear history and recent websites, delete presets and revoke cookie access at any time in the extension's Options page. Uninstalling the extension removes its local storage.

## Site data the extension can clear

Depending on your selection, the extension can remove the following for the exact website (origin) you choose:

- Cookies
- Session Storage
- Local Storage
- IndexedDB
- File Systems (OPFS)
- HTTP cache
- Cache Storage
- Service Workers

It does not touch your browsing history, downloads, saved passwords, form data or other websites.

## Important cookie behavior

Cookies differ from origin-scoped browser storage. Cookies can be associated with a registrable domain and shared by related subdomains, and browsers do not isolate cookies by port.

By default the extension removes only the cookies that apply to the website you selected and keeps cookies shared with other subdomains unless you choose them. A domain-wide option exists behind a red confirmation. Clearing shared cookies may sign you out of related subdomains.

## Permissions

AW Browser Cleaner strictly adheres to the principle of least privilege. The extension requests these standard Chrome permissions:

- `activeTab` — used temporarily to identify the current tab when you click the toolbar icon, use a keyboard shortcut or use the context menu.
- `browsingData` — used to remove the site data you explicitly select.
- `contextMenus` — used to add the "Clean this origin with preset…" menu.
- `cookies` — used to list cookie metadata (never values) and remove the cookies that apply to the website you selected.
- `scripting` — used to count what a website stores and to clear Session Storage in the page you selected.
- `storage` — used to store the settings listed above.

Access to a specific website for cookie removal is an optional permission: Chrome asks you for one website at a time, you can revoke it in Options, and the extension never asks for access to all websites.

The extension does not request:

- `tabs` (no persistent browsing or all-tab monitoring),
- `downloads` (reports are saved through your browser's normal download of a generated file),
- `history`, `passwords` or similar,
- `host_permissions` / `<all_urls>` (no permanent access to any website).

## Test Mode

Test Mode is off by default. When you turn it on, a script on a local test page (`localhost` or `127.0.0.1`) that you allow can ask the extension to clean that page's own website. It cannot clean other websites and cannot remove domain-wide cookies.

## Data collection and sharing

AW Browser Cleaner is designed not to collect or transmit:

- browsing history,
- website content,
- authentication/session data,
- personal information entered into websites,
- behavioral analytics.

Use of any data handled by the extension is limited to providing its single purpose. It is not sold, not used for advertising, not used to determine creditworthiness, and not used for purposes unrelated to the extension's functionality.

## Remote code

AW Browser Cleaner does not download or execute remotely hosted application code. Core executable logic and fonts are packaged with the Chrome extension.

## Security

The project follows security principles including:

- least-privilege permissions,
- local processing,
- explicit user initiation,
- validation before destructive actions,
- no unnecessary remote services,
- review, automated testing and a signed release pipeline before release.

Security reports may be sent to **<browser@ahliweb.com>**.

## Standards and regulations

The extension is designed in line with the purpose-limitation and data-minimisation principles of Indonesia's Personal Data Protection Law (UU No. 27 Tahun 2022) and GDPR Article 5(1), with the Chrome Web Store User Data Policy (including Limited Use), and with the privacy principles of ISO/IEC 29100 and ISO/IEC 27701. This is a statement of design intent, not a certification.

## Children's privacy

The extension is not designed to collect personal information from children. Because it does not transmit user browsing/site data to AhliWeb, AhliWeb does not knowingly collect such data from children through the extension.

## Your choices

You can:

- choose which supported site-data types to clear,
- cancel before destructive cleanup where confirmation is required,
- turn history off and clear history and recent websites,
- turn Test Mode on or off,
- review and revoke extension permissions in Chrome and in the extension's Options page,
- uninstall the extension at any time.

## Changes to this policy

This policy may be updated when the extension's permissions, functionality, data handling, or applicable requirements change. The public page should display the date of its most recent revision.

## Contact

AhliWeb.com / PT Ahli Web Internasional  
Email: <browser@ahliweb.com>  
Website: <https://ahliweb.com/>

---

## Release-maintainer note

Before copying this draft to the public website:

1. compare it against the final `manifest.json` (`bun run check:permissions` checks the repository copy in `PRIVACY.md`);
2. remove any permission not actually requested;
3. add any required permission that is actually requested;
4. verify the supported cleanup types and the stored keys against the release UI/code (`docs/data-dictionary.md`);
5. update the public page's "Last updated" date.
