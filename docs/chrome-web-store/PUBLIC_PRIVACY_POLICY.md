# Public Privacy Policy Draft — AW Browser Cleaner

Use this document to update the public privacy-policy page currently served at:

https://ahliweb.com/privacy-browser-ext/

Review it against the final v1.2.0 manifest and package immediately before publication.

---

# Privacy Policy — AW Browser Cleaner

**Developer:** AhliWeb.com / PT Ahli Web Internasional

AW Browser Cleaner is a Chrome extension that lets users selectively clear site data for a website using Chrome's native browser APIs.

## Summary

- We do not sell personal data.
- The extension does not intentionally transmit your browsing history or website content to AhliWeb servers.
- The extension does not use analytics or advertising tracking.
- Cleanup actions occur locally in your browser after you explicitly request them.

## Information processed locally

To perform its function, AW Browser Cleaner may process locally on your device:

- the URL/origin of the active tab,
- a target website/origin you manually enter,
- the site-data categories you select for removal.

This information is used only to perform the requested cleanup and is not intentionally transmitted to AhliWeb.

## Site data the extension can clear

Depending on your selection and the capabilities included in the current release, the extension can remove:

- Cookies
- Local Storage
- IndexedDB
- Cache Storage
- Service Workers

The extension does not claim to clear a data category unless that capability is included in the shipped release.

## Important cookie behavior

Cookies differ from origin-scoped browser storage. Cookies can be associated with a registrable domain and shared by related subdomains.

As a result, clearing cookies for a selected website may sign you out of related subdomains. AW Browser Cleaner is designed to warn you about this before cookie-inclusive cleanup.

## Permissions

AW Browser Cleaner requests only permissions required for its core purpose. The exact permissions are defined in the extension's current `manifest.json` and Chrome Web Store listing.

Typical permissions may include:

- `browsingData` — used to remove browser site data that you explicitly select.
- `activeTab` — used to identify the current tab when you invoke the extension.

Additional permissions will be disclosed only if they are actually included in the current release and required for its functionality.

## Data collection and sharing

AW Browser Cleaner is designed not to collect or transmit:

- browsing history,
- website content,
- authentication/session data,
- personal information entered into websites,
- behavioral analytics.

Because this information is not intentionally collected by AhliWeb through the extension, it is not sold or used for advertising, creditworthiness, or purposes unrelated to the extension's functionality.

## Remote code

AW Browser Cleaner does not intentionally download or execute remotely hosted application code. Core executable logic is packaged with the Chrome extension.

## Security

The project follows security principles including:

- least-privilege permissions,
- local processing,
- explicit user initiation,
- validation before destructive actions,
- no unnecessary remote services,
- review and testing before release.

Security reports may be sent to **browser@ahliweb.com**.

## Children's privacy

The extension is not designed to collect personal information from children. Because it is designed not to transmit user browsing/site data to AhliWeb, AhliWeb does not knowingly collect such data from children through the extension.

## Your choices

You can:

- choose which supported site-data types to clear,
- cancel before destructive cleanup where confirmation is required,
- review extension permissions in Chrome,
- uninstall the extension at any time.

## Changes to this policy

This policy may be updated when the extension's permissions, functionality, data handling, or applicable requirements change. The public page should display the date of its most recent revision.

## Contact

AhliWeb.com / PT Ahli Web Internasional  
Email: browser@ahliweb.com  
Website: https://ahliweb.com/

---

## Release-maintainer note

Before copying this draft to the public website:
1. compare it against the final `manifest.json`;
2. remove any permission not actually requested;
3. add any required permission that is actually requested;
4. verify the supported cleanup types against the release UI/code;
5. update the public page's "Last updated" date.
