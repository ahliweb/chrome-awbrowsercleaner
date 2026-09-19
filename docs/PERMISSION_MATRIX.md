# Extension Permission Matrix — AW Browser Cleaner

## Overview

AW Browser Cleaner strictly adheres to the principle of **least privilege**. The extension requires only the minimum permissions necessary to identify the active tab's origin and clear browsing data for that specific origin.

## Final Manifest Permissions (v1.2.0+)

```json
{
  "permissions": [
    "browsingData",
    "activeTab"
  ]
}
```

No `host_permissions` or optional permissions are requested.

---

## Feature to Permission Mapping

| Feature / Operation | API Used | Permission Required | Justification |
|---|---|---|---|
| Detect active tab origin upon popup open | `chrome.tabs.query({ active: true, currentWindow: true })` | `activeTab` | Grants temporary, user-invoked access to the active tab's URL without granting broad access to all tabs or background browsing activity. |
| Clear site storage (cache, cookies, localStorage, indexedDB, serviceWorkers) | `chrome.browsingData.remove({ origins: [origin] }, dataTypes)` | `browsingData` | Named Chrome permission required to invoke `chrome.browsingData.remove` targeted to specific origins. |
| Manual origin input | DOM input & `origin-utils.js` | *None* | Evaluated entirely in-memory within popup execution context. No network or system permissions needed. |

---

## Permissions Evaluated and Removed

### 1. `tabs` (Removed)
- **Previous state**: Declared in `permissions: ["tabs"]` in v1.1.
- **Why removed**: The broad `tabs` permission grants permanent access to inspect all tabs in all windows, tab URLs, and navigation events at any time. AW Browser Cleaner only needs to inspect the current active tab when the user explicitly clicks the extension icon.
- **Replacement**: `activeTab` provides ephemeral access to the current tab's URL strictly when invoked by the user, satisfying the requirement without broad access.
- **Security gain**: Eliminates persistent visibility into user's overall browsing session and other open tabs/windows.

### 2. `<all_urls>` Host Permissions (Removed)
- **Previous state**: Declared in `host_permissions: ["<all_urls>"]` in v1.1.
- **Why removed**: Host permissions are required for injecting content scripts or executing cross-origin `fetch()` requests. AW Browser Cleaner does neither; cleanup is executed entirely by Chrome's browser engine via the `chrome.browsingData` API.
- **Replacement**: None needed. `chrome.browsingData.remove` with `{ origins: [...] }` operates natively under the `browsingData` permission without requiring host permissions.
- **Security gain**: Eliminates broad host access warning during installation ("Read and change all your data on all websites"), vastly improving user trust and privacy.

---

## Chrome Web Store Policy Compliance

| Policy Area | Status | Impact |
|---|---|---|
| **Least Privilege (Single Purpose)** | Compliant | The extension serves only one purpose: clearing browsing data for a chosen origin. All unused permissions eliminated. |
| **Permission Justification** | Clear & Minimal | Only two standard API permissions requested (`browsingData` and `activeTab`). |
| **User Install Warnings** | Minimal | Eliminating `<all_urls>` removes the high-severity install warning, expediting Web Store review and boosting user adoption. |

---

## Verification & Testing

- **Automated Tests**: Unit tests in `tests/unit/popup-logic.test.js` verify tab origin resolution from tab URL objects provided by `chrome.tabs.query`.
- **E2E Infrastructure**: `tests/e2e/extension.test.js` verifies unpacked extension loading and tab detection.
- **Manual Smoke Verification**: Verified active tab URL extraction and cleanup dispatch with `activeTab` + `browsingData` permissions only.
