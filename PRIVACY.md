# Privacy Policy — AW Browser Cleaner

This repository document describes the intended privacy behavior of the packaged AW Browser Cleaner extension. The public Chrome Web Store privacy-policy page must remain synchronized with the final shipped release.

Public policy URL: https://ahliweb.com/privacy-browser-ext/

## Summary

AW Browser Cleaner is designed as a local-first browser utility.

The extension does not intentionally:
- collect personal information for AhliWeb,
- transmit browsing history to AhliWeb,
- transmit website content to AhliWeb,
- use analytics or advertising tracking,
- sell user data,
- require an AhliWeb account.

Cleanup actions are performed locally through Chrome extension APIs after a user explicitly initiates them.

## Information processed locally

To perform its function, the extension may process locally:
- the URL/origin of the active tab,
- a target manually entered by the user,
- the data-type selections chosen by the user.

This information is used to determine what site data should be removed and is not intentionally transmitted to AhliWeb.

## Site data affected

Depending on the user's selections and the final release implementation, AW Browser Cleaner can remove:
- Cookies
- Local Storage
- IndexedDB
- Cache Storage
- Service Workers

The release documentation and UI must not claim support for a data type that is not implemented.

## Cookie scope

Cookies have different scope semantics from origin-scoped storage. A cookie may be associated with a registrable domain and shared with related subdomains. Consequently, clearing cookies for a selected site can sign the user out of related subdomains.

The product must disclose this behavior before cookie-inclusive cleanup.

## Permissions

The exact permission list is defined by the final release `manifest.json`.

Each permission must:
1. be required for core functionality,
2. be documented in the README and Chrome Web Store disclosures,
3. be removed if real-browser validation shows it is unnecessary.

The extension must not claim to use a permission that is absent from the shipped manifest.

## Remote code and third parties

The extension's executable code must be packaged with the extension. It must not download or execute remotely hosted application logic.

If third-party libraries are introduced in the future, their privacy and security behavior must be reviewed before release.

## Data sharing

Because the extension is designed not to transmit user browsing/site data to AhliWeb, AhliWeb does not intentionally share such extension-derived browsing/site data with third parties.

## Security

The project follows these principles:
- least privilege,
- explicit user action before destructive cleanup,
- accurate disclosure of deletion scope,
- local processing,
- no unnecessary remote services,
- review and automated testing before release.

Security issues should be reported using the process in `SECURITY.md`.

## Changes

This document should be updated whenever the extension's data handling, permissions, telemetry, remote services, or supported cleanup types change.
