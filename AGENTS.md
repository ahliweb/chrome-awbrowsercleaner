# AGENTS.md — AW Browser Cleaner

Instructions for AI coding agents working in this repository. Humans: see [CONTRIBUTING.md](CONTRIBUTING.md); the rules are the same.

## What this is

A Chrome MV3 extension that deletes site data for **exact origins** (`scheme://host:port`). Because it deletes data, a mistake can log people out of everything. Correctness and scope come before features.

## Principles

1. Every deletion targets an explicit list of exact origins. Never global, never wildcard, never "everything except".
2. Only `cleanup-core.js` (`executePlan` after the Scope Guard `validatePlan`) may call `chrome.browsingData.*` or `chrome.cookies.remove`. ESLint enforces it.
3. Exact Cookie Mode is the default. Domain-wide cookies need a red confirmation and never run from shortcuts, the context menu or Test Mode.
4. Everything is local. No network calls, no analytics, no remote code.
5. Cookie values and storage contents are never read into the UI, reports, history, logs or messages.
6. Least privilege. No permanent host access.

## Module map

| File | Role |
| --- | --- |
| `origin-utils.js` | `normalizeTarget`, `validateOrigin` (pure) |
| `cleanup-core.js` | `DATA_TYPES`, `createPlan`, `validatePlan` (Scope Guard), `confirmationLevel`, `describePlan`, `executePlan` (single gate) |
| `cookie-engine.js` | Exact Cookie Mode classification and redaction (pure) |
| `presets.js` | Built-in and custom presets, import/export (pure) |
| `report.js` | Snapshot diff, evidence report, file names, history entry, `assertNoSensitiveValues` (pure) |
| `page-probes.js` | Self-contained functions for `chrome.scripting.executeScript` (no closures, no imports) |
| `settings.js` | `chrome.storage` adapter, all keys prefixed `aw.` |
| `chrome-helpers.js` | Tab and cookie-store helpers shared by popup and worker |
| `background.js` | Service worker: shortcuts, context menu, badge, Test Mode (`onMessageExternal`) |
| `popup.html/js`, `popup-result.js`, `popup-unsupported.js` | Popup screens; stable DOM hooks in `docs/architecture.md` |
| `options.html/js/css` | Options page: presets, per-origin permissions, Test Mode, history, shortcuts |
| `i18n.js`, `_locales/{en,id}` | Localization; EN and ID must stay in parity |
| `scripts/` | Version, permission, package, validate and Web Store tools |
| `tests/unit`, `tests/e2e`, `tests/automation` | Bun tests; E2E and automation need `AW_CHROME_PATH` |
| `docs/` | Architecture, permission matrix, threat model, data dictionary, QA playbook, automation |

## Commands to run before committing

```bash
bun install
bun run lint
bun run check:version
bun run check:permissions
bun run test:unit
```

Also run `AW_CHROME_PATH=/path/to/chromium bun run test:e2e` when you touch cleanup, cookies, the worker, the manifest or `docs/automation.md` snippets, and `bun run build:package && bun run validate:package` when you add or rename a runtime file. Do not skip failing tests; fix the cause.

## Files that must stay in sync

| When you change | Also update |
| --- | --- |
| `manifest.json` permissions, optional hosts or `externally_connectable` | `docs/PERMISSION_MATRIX.md` (marked table), `PRIVACY.md`, public policy, Store listing; run `check:permissions` |
| Version | `manifest.json`, `package.json`, `VERSION`, `CHANGELOG.md`; run `check:version` |
| A runtime file added or renamed | `scripts/package-files.js` |
| A user-visible string | `_locales/en/messages.json` **and** `_locales/id/messages.json` (same keys, same placeholders) |
| A storage key, plan, report, preset or Test Mode shape | `docs/data-dictionary.md`, and `PRIVACY.md` for stored data |
| A data type | `DATA_TYPES`, both locales, `page-probes.js`, `report.js`, popup checkbox, E2E seed and `readState`, `docs/architecture.md`, `docs/automation.md` mapping |
| Popup DOM ids or screens | `docs/architecture.md` ("Popup DOM contract"), `docs/qa-playbook.md` and `docs/qa-playbook.id.md`, E2E tests |
| A snippet in `docs/automation.md` | The marked block in `tests/automation/cdp-example.test.js` (unit test compares them) |
| Security-relevant behavior | `docs/threat-model.md`, `SECURITY.md` |

## Never do

- Do not use `innerHTML`, `outerHTML` or `insertAdjacentHTML`. Use `createElement` and `textContent`.
- Do not add an install-time permission that shows a warning, `host_permissions`, `<all_urls>`, `tabs` or `downloads`. Per-origin access stays optional and requested from a user click.
- Do not add `excludeOrigins`, a wildcard origin, an empty origin list, or any property whose name contains `exclude`.
- Do not call `chrome.browsingData` or `chrome.cookies.remove` outside `cleanup-core.js`, and do not turn off the ESLint rule elsewhere.
- Do not put cookie values, storage contents, full URLs or page paths into output, storage, logs, test fixtures or error messages. Origins only.
- Do not add a data type that cannot be limited to an origin (history, downloads, passwords, form data).
- Do not add network requests, analytics, CDN assets or remotely hosted code.
- Do not let a shortcut, context menu or Test Mode run a `danger` plan (domain-wide or shared cookies).
- Do not read the Test Mode target from the message payload; it is `sender.origin` only.
- Do not claim in docs a capability the code does not have; read the code first.
- Do not change release workflows, SHA-pinned actions or the protected environment without a maintainer asking for it. Pin new actions to a full commit SHA.

## Style

- ES modules, 4-space indentation, single quotes, JSDoc on exported functions, English identifiers and comments.
- Commit messages: Conventional Commits with issue numbers, for example `feat(#35, #39): ...`. See [CONTRIBUTING.md](CONTRIBUTING.md).
- Markdown: ATX headings with blank lines around them, lists surrounded by blank lines, tables with `| --- |` separators, URLs in `<angle brackets>` or links.

## Orchestrator & Agent (model AI)

> Standar lintas-portofolio dari [`ahliweb/personal-coding`](https://github.com/ahliweb/personal-coding/blob/main/docs/tingkatan-model-ai-claude-openai.md) (docs/tingkatan-model-ai-claude-openai.md, snapshot 2026-10-28). Harga, effort, dan lini model dipelihara di sana — jangan disalin ke repo ini.

Pekerjaan yang perlu dipecah ke beberapa agent memakai pola **orchestrator → agent**. Orchestrator memecah pekerjaan, membagi tugas, mengatur ketergantungan, lalu memeriksa dan menyatukan hasil; agent mengerjakan satu bagian yang sudah dibatasi.

| Peran | Claude Code | Codex / OpenAI |
| --- | --- | --- |
| Orchestrator | Opus 5.5, effort `high` | GPT-6.1 Sol, `high` |
| Agent kompleks — lintas komponen, keamanan, integrasi, risiko regresi | Sonnet 5.5, `medium` (subagent `pelaksana-kompleks`) | GPT-6.1 Sol atau Terra, `medium` |
| Agent sederhana — mekanis, terdefinisi jelas, risiko rendah | Haiku 5.5, `low` (subagent `pelaksana-sederhana`) | GPT-6 Luna atau Terra, `low` |

Pekerjaan kritis (arsitektur, keamanan, migrasi besar): orchestrator Fable 5.1 `high`–`xhigh`, agent kompleks Opus 5.5 `high`.

Aturan:

1. **Jangan memecah tugas kecil.** Coba satu model kuat (Opus 5.5 / GPT-6.1 Sol) dengan effort rendah lebih dulu.
2. **Naikkan, jangan menebak.** Agent sederhana yang menemukan ambiguitas, risiko, atau sentuhan arsitektur berhenti dan mengembalikan tugas ke orchestrator, yang memindahkannya ke agent kompleks.
3. **Agent paralel terisolasi.** Tidak boleh menyentuh file atau modul yang sama; tugas yang saling bergantung dijalankan berurutan.
4. **Verifikasi tetap di orchestrator.** Diff, uji, dan angka dicek sendiri sebelum dipakai; laporan agent bukan bukti.
5. **Agent tetap di scope-nya.** Tidak mengubah arsitektur, tidak mendelegasikan lagi, tidak menyentuh area di luar tugas.
6. **Aturan repo ini tetap berlaku** untuk setiap agent — alur kerja, gerbang, guardrail keamanan, konvensi commit.
