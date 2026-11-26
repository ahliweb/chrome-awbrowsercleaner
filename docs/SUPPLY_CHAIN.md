# Supply Chain Security

This document describes the controls that protect the AW Browser Cleaner build and release pipeline, how to verify a published release, and how the controls map to ISO/IEC 27001:2022 Annex A and SLSA v1.0.

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/ahliweb/chrome-awbrowsercleaner/badge)](https://scorecard.dev/viewer/?uri=github.com/ahliweb/chrome-awbrowsercleaner)

## Controls

### Dependabot (`.github/dependabot.yml`)

- Checks the Bun dependencies (ecosystem `bun`, because `bun.lock` is the only
  lockfile) and the GitHub Actions weekly.
- Minor and patch updates to development dependencies are grouped into a
  single pull request.
- Updates to pinned GitHub Actions SHAs are proposed automatically (see [Updating pinned SHAs](#updating-pinned-shas)).

### Security leg: gitleaks, `bun audit`, OpenGrep (`.github/workflows/keamanan.yml`)

Job `keamanan / sast-rahasia-dependensi`, run on pull requests to `main`, pushes to `main` and manual dispatch. It replaced CodeQL under the internal cross-portfolio standard (DL-098): GitHub's CodeQL terms restrict use on non-open-source code and in CI without GitHub Advanced Security, and one path is used for every repository.

- **gitleaks** (version pinned, checksum verified, `--redact`) scans only the commit range of the event (`base..head` on pull requests, the pushed range on pushes), never the whole history.
- **`bun audit --audit-level=high`** checks the Bun dependencies. This is the only dependency audit in the pipeline.
- **OpenGrep** (v2.1.0, binary pinned by SHA256) runs `tools/ci/sast/opengrep-scan.ts` with a vendored copy of `opengrep/opengrep-rules` (commit `f1d2b562b414`: 203 JavaScript and TypeScript rules plus 9 `yaml/github-actions` rules for workflows, 212 in total) plus local rules in `tools/ci/sast/rules/lokal/`. No registry rules are used and no telemetry is sent.
- The gate fails only on new ERROR findings that are not in `tools/ci/sast/baseline.json`. The baseline only shrinks: existing entries may be removed (`baseline --rapikan`), and an entry may be added only by hand, with a non-empty reason, reviewed in the pull request. WARNING and INFO findings are reported, not gated.
- Results are not uploaded to GitHub code scanning. They are in the job log and in `ringkasan.json` under the runner temp directory.
- Compared with CodeQL, OpenGrep has limited inter-procedural dataflow analysis, so it can miss taint paths that CodeQL finds across functions.
- Workflow analysis that CodeQL provided is replaced by the nine `yaml/github-actions` pattern rules. They match patterns in the workflow files; their depth is not equivalent to CodeQL dataflow analysis.

### OpenSSF Scorecard (`.github/workflows/scorecard.yml`)

- Evaluates the repository against the OpenSSF Scorecard checks (branch protection, pinned dependencies, token permissions, code review, vulnerabilities, and others).
- Runs on pushes to `main`, weekly, and on branch protection rule changes.
- Results are published to the public Scorecard API, uploaded to code scanning (SARIF, through `github/codeql-action/upload-sarif`; this is only an uploader, not CodeQL analysis), and kept as a workflow artifact for 5 days.

### Branch protection on `main`

`main` requires these status checks before a change can land: `Lint, Unit Tests & Package Validation`, `E2E (Chrome stable)`, `E2E (Chrome beta)` and `keamanan / sast-rahasia-dependensi`. It also requires **one approving review** from someone other than the author (stale approvals are dismissed on new pushes). Force-pushes and branch deletion are blocked and conversations must be resolved. Administrators are not forced to follow these rules, so the maintainer can bypass them in an emergency; the bypass should stay the exception, because Scorecard's Code-Review check only counts changesets that someone else approved and reaches a high score only as reviewed pull requests accumulate.

### SHA pinning

- Every `uses:` reference in the release and security workflows is pinned to a full 40-character commit SHA, with the release version kept in a trailing comment (for example `# v7.0.1`).
- A tag can be moved by its owner; a commit SHA cannot. Pinning means the code that runs is the code that was reviewed.

### Minimal permissions

- Every workflow sets `permissions: {}` at the top level, so each job starts with no token permissions.
- Each job then declares only what it needs. For example, the `build` job has `contents: read` only, and the `release` job is the only one with `contents: write`.
- `actions/checkout` runs with `persist-credentials: false`, so the Git credential is not left on disk for later steps.

### Release pipeline (`.github/workflows/release.yml`)

Releases run only for tags matching `v*`, in this order:

1. **`build`**: version check against the source files, ESLint, unit tests (`bun run test:unit`), packaging, package validation, and a CycloneDX SBOM of the dependencies. Outputs the zip, its SHA-256 file, and the SBOM as a single artifact.
2. **`attest`**: generates a signed build provenance attestation for the zip (`actions/attest-build-provenance`). This job is separate from `build` so the OIDC token (`id-token: write`) is never available to the dependency install or build steps. It also exports the attestation as two release assets. A single provenance statement lists every zip of the release (Chrome and Edge) as a subject, so the assets are named after the release, not after one zip:
   - `aw-browser-cleaner-vX.Y.Z.sigstore.json`: the full Sigstore bundle.
   - `aw-browser-cleaner-vX.Y.Z.intoto.jsonl`: the DSSE envelope with the
     in-toto SLSA provenance statement.
3. **`release`**: runs only after `build` and `attest` succeed. Creates the
   GitHub release with the zip, the SHA-256 file, the SBOM, and the two
   provenance assets. The attestation store alone is not enough, because
   offline verifiers and OpenSSF Scorecard's Signed-Releases check look for the
   provenance on the release itself. Release notes are taken from the matching
   `## [vX.Y.Z]` section of `CHANGELOG.md`.
4. **`publish-cws`**: uploads the zip to the Chrome Web Store. It runs in the protected `chrome-web-store` environment (see below).

The `build` and `publish-cws` jobs run `oven-sh/setup-bun` with
`no-cache: true`, so a release build never restores a dependency cache that
another workflow could have written.

#### Protected `chrome-web-store` environment

The Chrome Web Store upload waits for approval from a required reviewer. This gate exists because the upload uses store credentials and can publish to users.

- Current configuration (**Settings → Environments → `chrome-web-store`**): required reviewer `ahliweb`, and a deployment rule that only allows tags matching `v*`. A run from any other ref is rejected.
- Add further maintainers who may approve store uploads as required reviewers there.
- Store credentials (`CWS_*` secrets) and the extension ID (`CWS_EXTENSION_ID` variable) remain repository-level settings.
- `CWS_AUTO_PUBLISH` is `true`, so an approved upload is also submitted for publishing. Approval is the last human check before users receive the build.

If the environment is ever deleted, GitHub recreates it on the next release run without protection rules, and `publish-cws` then runs without the approval gate.

### Build provenance (SLSA Build L2)

- Each release zip has a signed provenance attestation generated by the GitHub-hosted runner through Sigstore.
- The attestation records the repository, the commit, the workflow file, and the runner, so the build can be traced back to its source.
- This meets SLSA Build Level 2: the build runs on a hosted platform and the provenance is generated and signed by the platform, not by the build steps.

### SBOM

- A CycloneDX JSON SBOM (`sbom.cdx.json`) lists the dependencies included in the build.
- It is generated with `anchore/sbom-action` and attached to every GitHub release next to the zip.

## Verifying a release

Download the zip, its `.sha256` file, the `sbom.cdx.json` file, and the
`.sigstore.json` and `.intoto.jsonl` provenance files from the release page.
Replace `X.Y.Z` with the version you are checking. To download all release
assets at once:

```bash
gh release download vX.Y.Z --repo ahliweb/chrome-awbrowsercleaner
```

1. **Check the file integrity** (run in the folder that holds the downloaded files):

   ```bash
   sha256sum -c aw-browser-cleaner-vX.Y.Z.zip.sha256
   ```

   The output must end with `aw-browser-cleaner-vX.Y.Z.zip: OK`.

2. **Check the build provenance** (requires the [GitHub CLI](https://cli.github.com/)):

   ```bash
   gh attestation verify dist/aw-browser-cleaner-vX.Y.Z.zip --repo ahliweb/chrome-awbrowsercleaner
   ```

   A successful check confirms that the zip was built by this repository's release workflow from a tagged commit.

   To verify offline with the downloaded provenance bundle, pass the
   `.sigstore.json` release asset:

   ```bash
   gh attestation verify aw-browser-cleaner-vX.Y.Z.zip --repo ahliweb/chrome-awbrowsercleaner --bundle aw-browser-cleaner-vX.Y.Z.sigstore.json
   ```

## Updating pinned SHAs

- Dependabot opens a pull request when a newer release of a pinned action is available. The pull request replaces the SHA and updates the version comment.
- To update an action by hand, look up the release tag, resolve it to its commit SHA (for annotated tags, use the `^{}` commit SHA), and replace both the SHA and the `# vX.Y.Z` comment together.
- Never reference an action by a tag or branch name (`@v4`, `@main`) in a workflow.

## Mapping to ISO/IEC 27001:2022 Annex A and SLSA v1.0

These mappings describe how the controls support each requirement. They are not a certification statement.

| Control | ISO/IEC 27001:2022 Annex A | SLSA v1.0 |
|---|---|---|
| Dependabot, SHA pinning of actions, SBOM | 5.21 Managing information security in the ICT supply chain | Source and build dependencies are known and pinned |
| Build provenance attestation (`attest` job) | 5.21 Managing information security in the ICT supply chain | Build L2: signed provenance from a hosted build platform |
| gitleaks, `bun audit`, OpenGrep, OpenSSF Scorecard, lint and unit tests in `build` | 8.25 Secure development life cycle | Build steps verify the code before packaging |
| Protected `chrome-web-store` environment with required reviewers, release only after build and attest succeed | 8.32 Change management | Release is gated on a reviewed, traceable build |
| Minimal `permissions`, `persist-credentials: false`, release jobs limited to version tags | 8.25 Secure development life cycle (least privilege) | Build platform isolates the build from the release credentials |

## Related files

- `.github/dependabot.yml`
- `.github/workflows/release.yml`
- `.github/workflows/keamanan.yml`
- `tools/ci/sast/`
- `.github/workflows/scorecard.yml`
