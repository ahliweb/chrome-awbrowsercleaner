# Chrome Web Store Release Checklist

Target item: AW Browser Cleaner  
Extension ID: `njflkejajbifofomeebakgebgcincepf`  
Current published version: `1.1`  
Planned next version: `1.2.0`

## 1. Blocking engineering checks

- [ ] #2 Exact-origin targeting completed.
- [ ] #3 Permission minimization validated in real Chromium.
- [ ] #4 Cookie registrable-domain warning/confirmation completed.
- [ ] #5 Version source of truth completed.
- [ ] #7 Chromium E2E tests completed and green.
- [ ] #9 Privacy/security disclosure documentation completed.
- [ ] #10 Storage terminology/accessibility completed.

Do not upload a release candidate while any blocking item above is unresolved.

## 2. Manifest

- [ ] `manifest_version` remains 3.
- [ ] `version` is greater than the currently published Web Store version.
- [ ] Release cut sets `version` to `1.2.0`.
- [ ] Description accurately describes the extension's single purpose.
- [ ] Every permission is required and documented.
- [ ] No unused host permission remains.
- [ ] No remotely hosted executable code is used.
- [ ] Icons referenced in the manifest exist and are correct.

## 3. Privacy and disclosure

- [ ] Repository `PRIVACY.md` matches shipped behavior.
- [ ] Public privacy policy at https://ahliweb.com/privacy-browser-ext/ matches shipped behavior.
- [ ] Remove any public claim that the extension uses the `storage` permission unless the release actually requests it.
- [ ] Remove any public claim that Session Storage is cleared unless the release actually implements it.
- [ ] Store Privacy tab matches final permissions and data handling.
- [ ] Cookie behavior is disclosed accurately: cookie removal may affect a registrable domain and related subdomains.
- [ ] No analytics/tracking claim is made unless verified against all packaged code.

## 4. Store listing

- [ ] Name: AW Browser Cleaner.
- [ ] Category remains appropriate for developer tools.
- [ ] Short/long description reflects exact-origin behavior implemented by the release.
- [ ] Do not claim cookies are always isolated to one hostname.
- [ ] Screenshots reflect the current popup UI.
- [ ] At least one current screenshot is uploaded.
- [ ] Support/contact information remains valid.
- [ ] Privacy-policy URL resolves publicly over HTTPS.

## 5. Package integrity

The Web Store ZIP must contain runtime assets only.

Expected runtime files are normally limited to:
- `manifest.json`
- `popup.html`
- `popup.js`
- `styles.css`
- `icons/`
- localized runtime assets if introduced by #11

Exclude:
- `.git/`
- `.github/`
- `docs/`
- tests
- screenshots/source assets not used by the extension
- development caches
- secrets/tokens
- editor files
- local build artifacts

- [ ] Clean package generated from a clean checkout.
- [ ] SHA-256 checksum generated.
- [ ] Release ZIP manually inspected.
- [ ] Release ZIP loaded/tested in Chromium before submission.

## 6. Regression tests

Verify at minimum:
- [ ] active HTTPS origin
- [ ] HTTP origin
- [ ] explicit port / localhost
- [ ] Local Storage
- [ ] IndexedDB
- [ ] Cache Storage
- [ ] Service Workers
- [ ] Cookies
- [ ] related-subdomain cookie warning
- [ ] malformed target rejection
- [ ] unsupported schemes rejected
- [ ] no cleanup occurs after validation failure

## 7. Release cut

Only after all checks above pass:

1. Set manifest version to `1.2.0`.
2. Synchronize `VERSION` and `CHANGELOG.md`.
3. Run all CI/release checks.
4. Create artifact `aw-browser-cleaner-v1.2.0.zip`.
5. Generate SHA-256.
6. Create Git tag `v1.2.0`.
7. Create GitHub Release.
8. Upload the ZIP to the existing Chrome Web Store item.
9. Review Store Listing and Privacy tabs once more.
10. Submit for review.

## 8. Publisher prerequisites

- [ ] Google publisher account has 2-Step Verification enabled.
- [ ] Publisher/contact details are current.
- [ ] Developer Dashboard access is confirmed before release day.

## Official references

- Chrome Web Store API/update flow: https://developer.chrome.com/docs/webstore/using-api
- browsingData API: https://developer.chrome.com/docs/extensions/reference/api/browsingData
- Permissions: https://developer.chrome.com/docs/extensions/reference/permissions-list
- Manifest V3: https://developer.chrome.com/docs/extensions/develop/migrate
