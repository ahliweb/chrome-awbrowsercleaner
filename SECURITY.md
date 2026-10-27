# Security Policy

## Scope

This policy covers AW Browser Cleaner and its packaged Chrome extension code.

## Supported version

Security fixes are targeted at:

- the latest Chrome Web Store release, and
- the current `main` development branch when applicable.

## Reporting a vulnerability

Please do not disclose an exploitable vulnerability publicly before maintainers have had a reasonable opportunity to assess it.

Report security issues to:

**<browser@ahliweb.com>**

You can also report privately through GitHub: <https://github.com/ahliweb/chrome-awbrowsercleaner/security/advisories/new>. Private reports are visible only to the maintainers.

**Response times.** The maintainers acknowledge a report within 14 days, usually sooner, and give a first assessment (accepted, needs more information, or not a vulnerability) in the same reply or shortly after. Confirmed vulnerabilities are fixed with priority and published as a Chrome Web Store update and a GitHub release whose notes describe the fix. Reporters are credited unless they ask not to be.

Use a subject that starts with `[security]` and include, when possible:

- affected version (Settings → Extensions, or `manifest.json`),
- browser/Chrome version,
- reproduction steps,
- expected and actual behavior,
- security/privacy impact,
- proof of concept if safe to share.

Please do not send real cookie values, tokens or personal data. An evidence report exported by the extension (Export JSON) is safe to attach: it contains counts and metadata only.

## High-priority security classes

Examples include:

- deleting data outside the scope explicitly disclosed to the user,
- bypassing confirmation for cookie-inclusive cleanup (including from shortcuts, the context menu or Test Mode),
- arbitrary/invalid target injection into destructive APIs (empty, wildcard or "everything except" filters),
- a web page causing deletion without Test Mode being on, or for an origin other than its own,
- cookie values or storage contents appearing in a report, history entry, log or message reply,
- unnecessary or escalated extension permissions,
- remote-code execution,
- transmission of browsing/site data contrary to the privacy policy,
- supply-chain compromise of packaged extension code.

## Security design principles

AW Browser Cleaner should maintain:

- least-privilege permissions,
- Manifest V3,
- no remotely hosted executable code,
- explicit user initiation,
- exact target validation,
- auditable release packages,
- regression tests for destructive behavior.

## Security controls

The controls below are described in detail in [docs/threat-model.md](docs/threat-model.md).

| Control | What it enforces |
| --- | --- |
| Exact origins only | Every deletion targets an explicit list of `scheme://host:port` origins. No wildcard, no bare host, no "everything except". |
| Scope Guard (`validatePlan`) | Rejects empty, wildcard, `exclude*` and malformed input before any Chrome API is called. Covered by a 4000-input fuzz test and fast-check property tests. |
| Single deletion gate | Only `executePlan` in `cleanup-core.js` may call `chrome.browsingData.*` or `chrome.cookies.remove`; an ESLint rule fails the build otherwise. |
| Exact Cookie Mode | The default. Domain-wide cookie removal needs a red confirmation. Cookie values are never read into the UI, reports or storage. |
| Confirmation and pending confirmation | Shortcuts and the context menu never run a dangerous plan; they open the popup with a 60-second pending confirmation. |
| Test Mode | Off by default; `sender.origin` only; allow-list; no domain-wide cookies; value-free replies. See [docs/automation.md](docs/automation.md). |
| No permanent host access | `host_permissions` must not exist. Per-origin access is optional and revocable. `bun run check:permissions` enforces this and keeps [docs/PERMISSION_MATRIX.md](docs/PERMISSION_MATRIX.md) and `PRIVACY.md` in sync with the manifest. |
| Report redaction | `assertNoSensitiveValues` blocks value-bearing keys; history stores a six-field whitelist. |
| No `innerHTML` | The UI is built with `createElement` and `textContent`; tests check the popup and Options sources. |
| Supply chain | Actions pinned to commit SHAs, build provenance, SBOM, CodeQL, OpenSSF Scorecard, Dependabot, and the Web Store upload behind a protected environment. See [docs/SUPPLY_CHAIN.md](docs/SUPPLY_CHAIN.md). |

## Coordinated disclosure

After validation, maintainers should:

1. assess severity and affected versions,
2. create a private or minimally disclosed remediation plan when appropriate,
3. implement and test the fix,
4. publish a patched extension,
5. disclose relevant details after users can update safely.
