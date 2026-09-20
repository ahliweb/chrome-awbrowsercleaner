# Chrome Web Store Release Checklist

Target item: AW Browser Cleaner  
Extension ID: `njflkejajbifofomeebakgebgcincepf`  
Current published version: `1.2.0`

> This checklist is a reusable template. Copy it into a new issue or PR description
> for each release, then check off items as they are completed.

## 1. Blocking engineering checks

- [ ] All open P0/P1 issues are resolved or explicitly deferred.
- [ ] CI pipeline passes on the release branch/tag.
- [ ] All automated tests pass (`bun test`).
- [ ] ESLint passes (`bun run lint`).
- [ ] Version consistency passes (`bun run check:version vX.Y.Z`).

## 2. Manifest

- [ ] `manifest_version` remains 3.
- [ ] `version` is greater than the currently published Web Store version.
- [ ] `name` and `description` use `__MSG_*__` i18n placeholders.
- [ ] `default_locale` is set to `en`.
- [ ] Every permission is required and documented in `docs/PERMISSION_MATRIX.md`.
- [ ] No unused host permission remains.
- [ ] No remotely hosted executable code is used.
- [ ] Icons referenced in the manifest exist and are correct.

## 3. Privacy and disclosure

- [ ] Repository `PRIVACY.md` matches shipped behavior.
- [ ] Public privacy policy at https://ahliweb.com/privacy-browser-ext/ matches shipped behavior.
- [ ] Store Privacy tab matches final permissions and data handling.
- [ ] Cookie behavior is disclosed accurately: cookie removal may affect a registrable domain and related subdomains.
- [ ] No analytics/tracking claim is made unless verified against all packaged code.

## 4. Store listing

- [ ] Name: AW Browser Cleaner.
- [ ] Category remains appropriate for developer tools.
- [ ] Short/long description reflects exact-origin behavior.
- [ ] Do not claim cookies are always isolated to one hostname.
- [ ] Screenshots reflect the current popup UI.
- [ ] At least one current screenshot is uploaded.
- [ ] Support/contact information remains valid.
- [ ] Privacy-policy URL resolves publicly over HTTPS.

## 5. Package integrity

The Web Store ZIP must contain runtime assets only.

Expected runtime files (11 total):
- `manifest.json`
- `popup.html`
- `popup.js`
- `origin-utils.js`
- `styles.css`
- `icons/icon16.png`
- `icons/icon48.png`
- `icons/icon128.png`
- `_locales/en/messages.json`
- `_locales/id/messages.json`
- `LICENSE`

Exclude: `.git/`, `.github/`, `docs/`, `tests/`, `scripts/`, `node_modules/`, `dist/`, `bun.lock`, `package.json`, `.eslintrc.json`, `verification_test.html`, `.env*`, secrets/tokens, editor files, local build artifacts.

- [ ] Clean package generated (`bun run build:package`).
- [ ] SHA-256 checksum generated.
- [ ] Package validated (`bun run validate:package`).
- [ ] Release ZIP manually inspected (`unzip -l dist/*.zip`).
- [ ] Release ZIP loaded/tested in Chromium before submission.

## 6. Regression tests

Verify at minimum:
- [ ] Active HTTPS origin
- [ ] HTTP origin
- [ ] Explicit port / localhost
- [ ] Local Storage
- [ ] IndexedDB
- [ ] Cache Storage
- [ ] Service Workers
- [ ] Cookies
- [ ] Related-subdomain cookie warning
- [ ] Malformed target rejection
- [ ] Unsupported schemes rejected
- [ ] No cleanup occurs after validation failure

## 7. Release cut

Only after all checks above pass:

1. Set manifest version to the new version.
2. Synchronize `VERSION`, `package.json`, and `CHANGELOG.md`.
3. Run all CI/release checks (`bun test && bun run lint && bun run check:version vX.Y.Z`).
4. Build and validate artifact (`bun run build:package && bun run validate:package`).
5. Create Git tag (`git tag -a vX.Y.Z -m "Release vX.Y.Z"`).
6. Push tag to remote (`git push origin vX.Y.Z`).
7. GitHub Actions `release.yml` will automatically:
   - Create GitHub Release with artifacts
   - Upload ZIP to Chrome Web Store (if CWS secrets are configured)
8. Verify GitHub Release artifacts and CWS upload status.
9. Review Store Listing and Privacy tabs once more.
10. Submit for review (if not auto-published).

## 8. Publisher prerequisites

- [ ] Google publisher account has 2-Step Verification enabled.
- [ ] Publisher/contact details are current.
- [ ] Developer Dashboard access is confirmed before release day.
- [ ] CWS API credentials (`CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`) are configured in GitHub Secrets.

## Official references

- Chrome Web Store API/update flow: https://developer.chrome.com/docs/webstore/using-api
- browsingData API: https://developer.chrome.com/docs/extensions/reference/api/browsingData
- Permissions: https://developer.chrome.com/docs/extensions/reference/permissions-list
- Manifest V3: https://developer.chrome.com/docs/extensions/develop/migrate

## Release History

| Version | Date | Tag | Notes |
|---------|------|-----|-------|
| 1.1 | 2026-08-22 | — | Initial Chrome Web Store release |
| 1.2.0 | 2026-09-20 | `v1.2.0` | Production hardening, permission minimization, localization |
