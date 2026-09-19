# Chrome Web Store Listing — AW Browser Cleaner

This file is the canonical draft for the next Chrome Web Store listing update. It must be reviewed against the final packaged release before submission.

## Product identity

**Name:** AW Browser Cleaner  
**Publisher:** AhliWeb.com / PT Ahli Web Internasional  
**Extension ID:** `njflkejajbifofomeebakgebgcincepf`  
**Category:** Developer Tools

## Recommended short description

Clear selected site data for the current website with precise, local-only controls for cookies, Local Storage, IndexedDB, Cache Storage, and Service Workers.

## Recommended detailed description

AW Browser Cleaner is a lightweight, privacy-focused Chrome extension for developers, QA engineers, support teams, security professionals, and advanced users who need to reset site data without clearing unrelated browser data.

### Core capabilities

- Detect the current HTTP(S) site automatically.
- Clear selected site data using Chrome's native browsing-data APIs.
- Choose between Cookies, Local Storage, IndexedDB, Cache Storage, and Service Workers.
- Keep cleanup operations local to the browser.
- No account required.
- No analytics or behavioral tracking in the extension.
- No browsing-data transmission to AhliWeb servers.

### Important cookie behavior

Most supported storage types are targeted using the selected origin. Cookies are different: browser cookie scoping can apply to the registrable domain and related subdomains. Clearing cookies may therefore sign you out of related subdomains. The extension must show this warning before cookie-inclusive cleanup.

### Privacy

AW Browser Cleaner is designed as a local-first utility. The extension uses browser APIs only to identify the selected target and perform the cleanup you explicitly request.

Privacy policy:
https://ahliweb.com/privacy-browser-ext/

Source:
https://github.com/ahliweb/chrome-awbrowsercleaner

## Single purpose statement for Developer Dashboard

AW Browser Cleaner's single purpose is to let a user selectively remove browser site data associated with a user-selected/current website using Chrome's native browsing-data functionality.

## Permission justification draft

Final wording must be synchronized with the release manifest after #3 is completed.

### browsingData

Required to remove the site-data categories explicitly selected by the user.

### activeTab

Used to identify the user-invoked current tab so the extension can prefill the cleanup target.

### tabs

Include this justification only if real Chromium testing in #3 proves the permission remains required. Otherwise remove both the permission and this disclosure.

### Host permissions

Include a host-permission justification only if #3 proves persistent host permission is required. Do not retain `<all_urls>` merely for convenience.

## Data-use declaration draft

Subject to final package verification:

- No personally identifiable information is collected by AhliWeb through the extension.
- No browsing history is collected or transmitted.
- No website content is collected or transmitted.
- No analytics/tracking SDK is included.
- No user data is sold.
- No data is used for advertising, creditworthiness, or unrelated purposes.
- Cleanup operations execute locally using Chrome APIs.

## Screenshot plan

Refresh screenshots after #2, #4, and #10 are complete.

Recommended screenshots:
1. Popup showing the exact selected origin.
2. Granular storage-type selection.
3. Cookie warning / confirmation state.
4. Successful cleanup state.

Screenshots must reflect the actual release UI; do not submit mockups that materially differ from the extension.

## Current live-listing audit

The currently published listing is version 1.1 and describes domain-specific cleaning, local operation, and no tracking/data collection.

Before v1.2.0 submission:
- replace "per domain" language where it overstates cookie isolation;
- align wording with exact-origin behavior for origin-scoped storage;
- ensure Privacy tab and public privacy policy match the final permission set.
