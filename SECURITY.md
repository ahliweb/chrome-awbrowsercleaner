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

**browser@ahliweb.com**

Include, when possible:
- affected version,
- browser/Chrome version,
- reproduction steps,
- expected and actual behavior,
- security/privacy impact,
- proof of concept if safe to share.

## High-priority security classes

Examples include:
- deleting data outside the scope explicitly disclosed to the user,
- bypassing confirmation for cookie-inclusive cleanup,
- arbitrary/invalid target injection into destructive APIs,
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

## Coordinated disclosure

After validation, maintainers should:
1. assess severity and affected versions,
2. create a private or minimally disclosed remediation plan when appropriate,
3. implement and test the fix,
4. publish a patched extension,
5. disclose relevant details after users can update safely.
