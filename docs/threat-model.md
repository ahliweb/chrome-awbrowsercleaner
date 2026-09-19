# Threat Model — AW Browser Cleaner

## Security objective

The core safety property is:

> The extension must not delete browser data beyond what the user has explicitly selected and what Chrome's documented storage/cookie semantics make technically unavoidable.

## Assets

- User authentication/session cookies
- Local Storage
- IndexedDB
- Cache Storage
- Service Worker registrations/state
- User intent
- Current tab/origin information
- Extension integrity

## Trust boundaries

1. User ↔ popup UI
2. Popup input ↔ target validation
3. Validated target ↔ Chrome extension APIs
4. Packaged extension ↔ Chrome Web Store distribution
5. Repository/release process ↔ packaged artifact

## Primary threats

### T1 — Overbroad target selection

A hostname-only implementation can drop scheme/port and delete data from an unintended origin.

**Mitigation:** exact-origin parsing and tests (#2, #6).

### T2 — Cookie scope is broader than user expects

Cookies may apply to a registrable domain and related subdomains.

**Mitigation:** explicit warning and confirmation (#4).

### T3 — Malformed manual target

A malformed string reaches `chrome.browsingData.remove`.

**Mitigation:** strict parser; no raw fallback (#6).

### T4 — Excessive permissions

The extension requests permissions or host access not necessary for its single purpose.

**Mitigation:** real Chromium permission validation and least privilege (#3).

### T5 — Release/package drift

The reviewed source differs from the Store package or the version metadata is inconsistent.

**Mitigation:** deterministic package workflow, checksum, CI and synchronized versioning (#5, #8).

### T6 — Privacy disclosure drift

Public policy, Web Store Privacy tab, README, and actual manifest/code diverge.

**Mitigation:** canonical repository privacy/store documents and release checklist (#9, #12).

### T7 — Remote/supply-chain executable code

A future dependency or remote script introduces unreviewed behavior.

**Mitigation:** no remote code, package inspection, dependency review, CI checks.

## Risk treatment priority

P0:
- deletion scope correctness,
- cookie disclosure,
- permission minimization,
- version/release consistency.

P1:
- real-browser regression tests,
- CI/package controls,
- privacy/security documentation,
- accessibility and terminology.

## Validation

Every production release should include tests for:
- HTTPS exact origin
- HTTP/localhost with explicit port
- each supported data type
- cookies/subdomain warning
- invalid input
- unsupported schemes
- error handling
