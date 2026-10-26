# Contributing to AW Browser Cleaner

Thank you for helping. This extension deletes data, so the bar is correctness first: a change that widens what can be deleted, or that leaks a cookie value, will not be merged however useful it is.

Read these first:

- [docs/architecture.md](docs/architecture.md): module map, plan object, Scope Guard, popup DOM contract.
- [docs/threat-model.md](docs/threat-model.md): what we defend against.
- [docs/data-dictionary.md](docs/data-dictionary.md): every stored key, the plan, the report and the Test Mode protocol.
- [AGENTS.md](AGENTS.md): a short rule sheet that also applies to people.

## Principles

1. **Exact origins only.** Every deletion targets an explicit list of `scheme://host:port` origins. Never global, never a wildcard, never "everything except". The Scope Guard rejects `excludeOrigins`, wildcards and empty lists.
2. **One deletion gate.** Only `cleanup-core.js` may call `chrome.browsingData.*` or `chrome.cookies.remove`. ESLint enforces this (`no-restricted-syntax`); do not disable the rule outside `cleanup-core.js`.
3. **Local and value-free.** Nothing leaves the device. Cookie values and storage contents are never read into the UI, reports, history, logs or messages.
4. **Least privilege.** No new install-time permission that produces a warning, no `host_permissions`, no `tabs`, no `downloads`.
5. **Plain DOM.** Build UI with `createElement` and `textContent`. No `innerHTML`.

## Development setup

You need [Bun](https://bun.sh/); the exact version is in `.bun-version` (CI uses the same file). Node.js, npm and pnpm are not needed.

```bash
git clone https://github.com/ahliweb/chrome-awbrowsercleaner.git
cd chrome-awbrowsercleaner
bun install
```

Load the extension for manual testing: open `chrome://extensions/`, enable **Developer mode**, choose **Load unpacked** and select the repository folder. Branded Google Chrome 137 and later ignores command-line extension flags, so automated tests use Chrome for Testing or Chromium:

```bash
bunx @puppeteer/browsers install chrome@stable --path ~/.cache/chrome-for-testing
export AW_CHROME_PATH=/path/printed/above/chrome
```

### Scripts

| Script | Description |
| --- | --- |
| `bun run test` | Unit tests, then E2E and automation tests |
| `bun run test:unit` | Unit tests only (`tests/unit`) |
| `bun run test:e2e` | E2E (`tests/e2e`) and automation examples (`tests/automation`); needs `AW_CHROME_PATH` |
| `bun run lint` | ESLint on the root `*.js` files |
| `bun run check:version` | Version sources agree (`manifest.json`, `package.json`, `VERSION`) |
| `bun run check:permissions` | `manifest.json` agrees with `docs/PERMISSION_MATRIX.md` and `PRIVACY.md`; no `host_permissions` |
| `bun run build:package` | Deterministic release ZIP and SHA-256 file in `dist/` |
| `bun run validate:package` | Check the ZIP contents and checksum |
| `bun run upload:cws`, `bun run setup:cws` | Chrome Web Store upload tools (maintainers) |

Without `AW_CHROME_PATH`, browser tests are skipped locally with a visible banner. With `CI=true` they fail instead, so a green CI run always means they ran.

### Before you commit

```bash
bun run lint
bun run check:version
bun run check:permissions
bun run test:unit
bun run test:e2e        # when you touched cleanup, cookies, the service worker or the manifest
bun run build:package && bun run validate:package   # when you added or renamed a runtime file
```

## Branches and commits

- Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `design/<topic>`. Open a pull request into `main`; CI must pass.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) with the issue number in the scope, as in the history:
  - `feat(#35, #39): background worker for shortcuts, context menu and Test Mode`
  - `fix(test): align E2E test server port and resolve chromium binary path`
  - `refactor(#27, #33): pure cleanup-core module with Scope Guard as the single deletion gate`
  - `test(#33): assert cookie removal URLs by exact origin, not prefix`
  - `ci(#40): harden supply chain with pinned actions, provenance and SBOM`
  - `docs(design, #37, #38): time range and origin set boards`
  - `chore(release): bump version to 1.2.0 and finalize changelog (#24)`
- Types in use: `feat`, `fix`, `refactor`, `test`, `ci`, `docs`, `style`, `chore`. Write the subject in the imperative, lower case after the colon, no trailing period.
- Keep one logical change per commit. Update tests and documentation in the same commit as the code.

## Tests

- Pure modules (`origin-utils.js`, `cleanup-core.js`, `cookie-engine.js`, `presets.js`, `report.js`, `page-probes.js`, `settings.js`) are tested directly with `bun test` and fake Chrome APIs. Add a unit test for every behavior change.
- Deletion is proven end to end in `tests/e2e/`: it seeds several origins, runs the popup, and checks that the target origin is empty while the canary origin is untouched. The deletion matrix is written to `test-artifacts/e2e-matrix.md`.
- Documentation snippets in [docs/automation.md](docs/automation.md) are copied from `tests/automation/cdp-example.test.js` (`// docs:begin` / `// docs:end` blocks); `tests/unit/docs-snippets.test.js` fails if they drift.
- Destructive paths need negative tests: empty origins, wildcards, `excludeOrigins`, other origins, malformed input.

## How to add a data type

Add one only if Chrome can limit it to an origin. `history`, `downloads`, `formData`, `passwords`, `pluginData`, `appcache` and `webSQL` are on `FORBIDDEN_TYPES` and must stay there.

1. **Registry.** Add an entry to `DATA_TYPES` in `cleanup-core.js` (`key`, `group`, `api`, `labelKey`, `risk`, `countable`). `api` is the `chrome.browsingData` `DataTypeSet` key, or `null` when another mechanism removes it (as `sessionStorage` does with `chrome.scripting`). Order in the array is the UI order. `DATA_TYPE_KEYS`, plan validation, preset validation and the built-in "Everything" preset follow from the registry.
2. **Execution.** If `api` is not enough, extend `executePlan` (one function per mechanism, results recorded in `perOrigin[].types`, errors never thrown).
3. **Counting.** If it is countable, add the count to `snapshotProbe` in `page-probes.js` (counts only, never values), and to `TYPE_LABELS` in `report.js`.
4. **Internationalization.** Add the `dataType<Name>` label key to **both** `_locales/en/messages.json` and `_locales/id/messages.json`. `tests/unit/locales.test.js` enforces EN/ID key parity and placeholder parity.
5. **UI.** Add the checkbox (and its `data-count-for` slot) to `popup.html` following the DOM contract in `docs/architecture.md`; the Options preset editor reads the registry.
6. **Packaging.** `scripts/package-files.js` lists every runtime file. A new file must be added there, otherwise `validate:package` fails; a type that needs no new file needs no change.
7. **E2E matrix.** Extend `seedOrigin` and `readState` in `tests/e2e/helpers.js` (and `STATE_KINDS`) so the new type appears as a row in the data type × origin matrix, and assert that the canary origin keeps it. Review expects every type to have an E2E row.
8. **Documentation.** Update the data type table in `docs/architecture.md`, `docs/data-dictionary.md`, `docs/automation.md` (CDP/Playwright/Cypress mapping), `PRIVACY.md`, `docs/chrome-web-store/PUBLIC_PRIVACY_POLICY.md` and the Store listing. If it needs a permission, see below.

## How to change a permission

You almost never should. If you must, in the same pull request: change `manifest.json`, `docs/PERMISSION_MATRIX.md` (the marked table and the reason), `PRIVACY.md`, the public policy and the Store listing justification, and run `bun run check:permissions`. A new install-time warning needs an explicit maintainer decision and a changelog entry.

## Privacy rules

- No network requests of our own, no analytics, no remote code, no CDN fonts or scripts.
- Do not log, store, display or export cookie values or storage contents. `assertNoSensitiveValues` guards reports; keep it on every new output path.
- Store only what `docs/data-dictionary.md` lists. A new key needs a cap, a retention rule and an entry in that document and in `PRIVACY.md`.
- Origins in storage are origins only: no paths, no query strings.
- History must stay switchable and clearable.

## Release flow

Releases are cut by maintainers.

1. Choose the version `X.Y.Z` and set it in **all** of `manifest.json` (`version`), `package.json` (`version`) and `VERSION`.
2. Move the `[Unreleased]` entries of `CHANGELOG.md` under a new heading `## [vX.Y.Z] - YYYY-MM-DD`. The release notes are taken from that section.
3. Run `bun run check:version vX.Y.Z` (also checks the changelog heading), `bun run check:permissions`, `bun run lint`, `bun run test`, `bun run build:package` and `bun run validate:package`. Walk through [docs/chrome-web-store/RELEASE_CHECKLIST.md](docs/chrome-web-store/RELEASE_CHECKLIST.md).
4. Commit as `chore(release): bump version to X.Y.Z and finalize changelog`, merge to `main`.
5. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`. The release
   workflow builds, validates, attests provenance, attaches the ZIP, its
   SHA-256 file, an SBOM and the two provenance assets (`.sigstore.json`,
   `.intoto.jsonl`) to the GitHub Release, and then waits in the protected
   `chrome-web-store` environment. A maintainer approves the upload to the
   Chrome Web Store there. See [docs/SUPPLY_CHAIN.md](docs/SUPPLY_CHAIN.md).
6. Verify the release (checksum and `gh attestation verify`, see the same document), update the public privacy policy page if it changed, and confirm the Store listing.

## Reporting security problems

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).
