# Threat Model — AW Browser Cleaner

## Security objective

The core safety property is:

> The extension must not delete browser data beyond what the user has explicitly selected and what Chrome's documented storage/cookie semantics make technically unavoidable.

In ISO/IEC 15408 (Common Criteria) terms this is the security objective of the target of evaluation (TOE). The TOE is the packaged extension: the pure modules, the single deletion gate (`executePlan` in `cleanup-core.js`), the service worker and the UI pages. Everything outside it is the operational environment and is assumed, not controlled: Chrome and its storage semantics, the operating system, the Chrome Web Store, and the websites being cleaned. This document describes the design; it is not a Common Criteria evaluation.

## Scope principle

The extension cleans **exact origins** (`scheme://host:port`) and nothing else. It never touches history, downloads, passwords, form data or other sites, and it has no "everything except" mode. Cookies are the one technical exception: they do not isolate by port (RFC 6265 §8.5) and can be shared across a registrable domain, which is why Exact Cookie Mode classifies them and the domain-wide mode needs a red confirmation.

## Assets

- User authentication/session cookies
- Local Storage
- Session Storage (current tab only)
- IndexedDB
- Cache Storage
- HTTP cache
- OPFS (File System) data
- Service Worker registrations/state
- Stored history and evidence: custom presets, recent origins, up to 20 history summaries, permission grant log, Test Mode settings (see [data-dictionary.md](data-dictionary.md))
- Evidence reports and exports (counts and metadata; must never contain cookie values or storage contents)
- User intent
- Current tab/origin information
- Extension integrity

## Trust boundaries

1. User ↔ popup / Options UI
2. Popup input ↔ target validation
3. Validated plan ↔ single deletion gate (`executePlan` + Scope Guard)
4. Gate ↔ Chrome extension APIs
5. Keyboard shortcut / context menu ↔ service worker
6. Web page ↔ service worker (`runtime.onMessageExternal`, Test Mode)
7. Packaged extension ↔ Chrome Web Store distribution
8. Repository/release process ↔ packaged artifact

## Primary threats

### T1 — Overbroad target selection

A hostname-only implementation can drop scheme/port and delete data from an unintended origin.

**Mitigation:** exact-origin parsing and tests (#2, #6); `validateOrigin()` must return the same string it was given.

### T2 — Cookie scope is broader than user expects

Cookies may apply to a registrable domain and related subdomains, and are not isolated by port.

**Mitigation:** **Exact Cookie Mode is the default**. It classifies cookies as host-only, partitioned, shared or ignored, removes host-only and partitioned cookies by default, and keeps shared domain cookies unless the user selects them. The domain-wide mode (`chrome.browsingData` cookie removal) is available only behind a **red confirmation** (`confirmationLevel` = `danger`); shortcuts and Test Mode never run such a plan. Without the per-origin host grant, exact removal fails with `COOKIE_PERMISSION_MISSING` instead of falling back to domain-wide. Cookie values are never read into the UI, reports or storage (#4, #32).

### T3 — Malformed manual target

A malformed string reaches `chrome.browsingData.remove`.

**Mitigation:** strict parser; no raw fallback (#6). `createPlan` rejects anything that is not already a bare origin.

### T4 — Excessive permissions

The extension requests permissions or host access not necessary for its single purpose.

**Mitigation:** real Chromium permission validation and least privilege (#3). No `host_permissions`; host access is optional, per origin and revocable; `bun run check:permissions` keeps manifest and documentation in sync and fails if `host_permissions` appears.

### T5 — Release/package drift

The reviewed source differs from the Store package or the version metadata is inconsistent.

**Mitigation:** deterministic package workflow, checksum, CI and synchronized versioning (#5, #8).

### T6 — Privacy disclosure drift

Public policy, Web Store Privacy tab, README, and actual manifest/code diverge.

**Mitigation:** canonical repository privacy/store documents, `check:permissions`, the data dictionary and the release checklist (#9, #12).

### T7 — Remote/supply-chain executable code

A future dependency or remote script introduces unreviewed behavior.

**Mitigation:** no remote code, package inspection, dependency review, CI checks. See T12 for the pipeline controls.

### T8 — Scope escalation via new entry points

Shortcuts, the context menu, Test Mode and presets each add a way to start a cleanup that bypasses the popup. A preset could be crafted (or imported) to name wildcard or excluded origins, run domain-wide cookie removal without confirmation, or retarget another origin.

**Mitigation:**

- A **single gate**: every entry point builds a plan and calls `executePlan`, which runs the Scope Guard (`validatePlan`) before any Chrome API call.
- An **ESLint rule** (`no-restricted-syntax`) forbids `chrome.browsingData.*` and `chrome.cookies.remove` outside `cleanup-core.js`.
- **Confirmation for danger plans**: a plan with domain-wide or shared cookies is never run by a shortcut, menu click or Test Mode. The service worker stores a **pending confirmation** (60 seconds, session storage, bound to the origin) and opens the popup, which shows the red confirmation.
- Presets only pre-select data types, cookie mode and the after-action. Origins are always explicit and exact; a preset's `boundOrigin` never redirects a cleanup; unknown properties and any property name containing `exclude` are rejected on save and import.

### T9 — Global deletion by empty or invalid filter

A call to `chrome.browsingData.remove` with an empty `origins` list, a wildcard or an `excludeOrigins` filter removes data globally or for "everything except" a list.

**Mitigation:** `validatePlan` rejects empty, wildcard and `excludeOrigins` inputs **before any API call**; `buildRemovalOptions` always emits an explicit origin array with `originTypes.unprotectedWeb` and never `excludeOrigins`; one API call is made per origin. A **4000-input fuzz test** (`tests/unit/scope-guard.fuzz.test.js`) checks that no accepted input is anything other than an exact origin.

### T10 — Untrusted page triggers deletion (Test Mode)

A web page uses `externally_connectable` to make the extension delete data, for example of another site or of the user's real session.

**Mitigation:** Test Mode is **off by default**. The target is the `sender.origin` only; origins named in the payload are ignored (and reported as `ignoredPayloadOrigin`). The sender must be on the user's allow-list, `externally_connectable` only matches `localhost` and `127.0.0.1`, domain-wide cookies are refused (`DOMAIN_WIDE_NOT_ALLOWED`), extra preset origins are dropped, and replies never contain cookie values.

### T11 — Sensitive data in reports

Cookie values or storage contents leak into the evidence report, history, exports or logs and then into bug trackers or chat.

**Mitigation:** **redaction** by construction (`redactCookie()` drops values; probes return counts only), `assertNoSensitiveValues` blocks forbidden keys (`value`, `cookieValue`, `storageValue`, `items`, `entries`) at any depth when a report is built or serialized, the history store whitelists six fields, and unit tests cover the report, history export and Test Mode replies.

### T12 — Supply-chain compromise

A compromised dependency, GitHub Action or release credential ships malicious code to users.

**Mitigation:** actions pinned to commit **SHAs**, build **provenance** attestation, a CycloneDX **SBOM**, **CodeQL**, OpenSSF **Scorecard**, Dependabot, minimal workflow permissions, and the Chrome Web Store upload behind a **protected environment** with required reviewers. See [SUPPLY_CHAIN.md](SUPPLY_CHAIN.md).

## Control mapping

Mapping describes how controls support the clause; it is not a certification statement.

| Control | Threats | ISO/IEC 27002:2022 | ISO/IEC 15408 concept |
| --- | --- | --- | --- |
| Scope Guard, single `executePlan` gate, ESLint rule, fuzz test | T1, T3, T8, T9 | 8.25 Secure development life cycle; 8.28 Secure coding | Security objective: no deletion outside the selected exact origins; TOE boundary is the gate |
| Unit and E2E deletion matrix, permission checks | T1, T2, T4, T9 | 8.29 Security testing in development and acceptance | Verification that the objective holds |
| Confirmation levels, Exact Cookie Mode, Test Mode limits | T2, T8, T10 | 8.26 Application security requirements | Security functional requirements derived from the objective |
| Redaction and report guard | T11 | 8.26 Application security requirements; 8.28 Secure coding | Information flow: no values leave the TOE |
| Pinned actions, provenance, SBOM, CodeQL, Scorecard, protected environment | T5, T7, T12 | 5.21 Managing information security in the ICT supply chain; 8.25 Secure development life cycle | Operational environment assumptions made explicit and checked |
| `check:permissions`, privacy and store documentation | T4, T6 | 8.26 Application security requirements | Security problem definition kept in sync with the TOE |

## Risk treatment priority

P0:

- deletion scope correctness,
- cookie disclosure,
- permission minimization,
- version/release consistency,
- no cookie values or storage contents in any output.

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
- Exact Cookie Mode and the domain-wide confirmation
- invalid input, empty input, wildcard input and `excludeOrigins`
- unsupported schemes
- error handling
- Test Mode: disabled, not allow-listed, domain-wide refused, payload origin ignored
- reports and history contain no values
