/**
 * AW Browser Cleaner - Options page controller
 *
 * Sections: presets, per-origin permissions, Test Mode, history & evidence,
 * keyboard shortcuts. Every dynamic string reaches the DOM through
 * createElement/textContent (never innerHTML). Chrome APIs are optional: when one
 * is missing the page renders with defaults and hides the sections that cannot work.
 *
 * Pure helpers are exported for unit tests; the page only boots when a document exists.
 */

import { getMessage, localizeDocument, setFallbackMessages } from './i18n.js';
import { createSettings } from './settings.js';
import { BUILTIN_PRESETS, validatePreset, exportPresets, importPresets } from './presets.js';
import { DATA_TYPES } from './cleanup-core.js';
import { normalizeTarget } from './origin-utils.js';
import { assertNoSensitiveValues } from './report.js';

const MAX_IMPORT_BYTES = 1024 * 1024;
const HISTORY_FORMAT = 'aw-browser-cleaner-history';
const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

/** Install-time permission to the i18n key of its one-line purpose. */
const PERMISSION_PURPOSE_KEYS = Object.freeze({
    browsingData: 'optionsPermBrowsingData',
    activeTab: 'optionsPermActiveTab',
    scripting: 'optionsPermScripting',
    cookies: 'optionsPermCookies',
    storage: 'optionsPermStorage',
    contextMenus: 'optionsPermContextMenus'
});

const AFTER_LABEL_KEYS = Object.freeze({
    none: 'optionsAfterNone',
    reload: 'optionsAfterReload',
    hard: 'optionsAfterHard',
    start: 'optionsAfterStart'
});

/** Editor field to its error element and the control that receives focus. */
const FIELD_MAP = Object.freeze({
    name: { error: 'fNameError', control: 'fName' },
    id: { error: 'fIdError', control: 'fId' },
    types: { error: 'fTypesError', control: 'fTypes' },
    cookieMode: { error: 'fCookieModeError', control: 'fCookieModeGroup' },
    after: { error: 'fAfterError', control: 'fAfter' },
    startPath: { error: 'fStartPathError', control: 'fStartPath' },
    bound: { error: 'fBoundError', control: 'fBound' },
    origins: { error: 'fOriginsError', control: 'fOrigins' },
    keep: { error: 'fKeepError', control: 'fKeep' },
    general: { error: 'fGeneralError', control: null }
});

// ---------------------------------------------------------------------------
// Pure helpers (no DOM, no chrome.*)
// ---------------------------------------------------------------------------

/**
 * Turns a preset name into an id candidate (lowercase letters, digits, hyphens, max 40).
 *
 * @param {string} name
 * @returns {string} Possibly empty.
 */
export function slugify(name) {
    return String(name ?? '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/g, '');
}

/**
 * Returns `base`, or `base-2`, `base-3`... when it is already taken. Stays within 40 characters.
 *
 * @param {string} base
 * @param {Iterable<string>} taken
 * @returns {string}
 */
export function uniqueId(base, taken) {
    const used = new Set(taken);
    const root = String(base || '').slice(0, 40).replace(/-+$/g, '');
    if (!root || !used.has(root)) return root;
    for (let n = 2; n < 1000; n++) {
        const suffix = `-${n}`;
        const candidate = root.slice(0, 40 - suffix.length).replace(/-+$/g, '') + suffix;
        if (!used.has(candidate)) return candidate;
    }
    return root;
}

/**
 * Splits a comma/whitespace separated list (origins, cookie names).
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseList(text) {
    return String(text ?? '').split(/[\s,]+/).filter(Boolean);
}

/**
 * Splits the Test Mode "Allowed origins" field (comma or newline separated).
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseOriginList(text) {
    return parseList(text);
}

/**
 * Splits a one-origin-per-line textarea. Blank lines are ignored.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseOriginLines(text) {
    return String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

/**
 * Exact origin of a granted match pattern such as `https://app.example.test/*`.
 *
 * @param {string} pattern
 * @returns {string|null} Null for wildcard or non-http(s) patterns.
 */
export function originFromPattern(pattern) {
    const match = /^(https?:\/\/[^/*\s]+)\/\*$/i.exec(String(pattern ?? ''));
    return match ? match[1].toLowerCase() : null;
}

/**
 * Whether a recorded grant belongs to a granted pattern origin. Match patterns
 * ignore ports, so `http://localhost` also covers a grant for `http://localhost:5173`.
 *
 * @param {string} grantOrigin
 * @param {string} patternOrigin
 * @returns {boolean}
 */
export function grantMatchesPattern(grantOrigin, patternOrigin) {
    if (grantOrigin === patternOrigin) return true;
    try {
        const g = new URL(grantOrigin);
        const p = new URL(patternOrigin);
        return !/:\d+$/.test(patternOrigin) && g.protocol === p.protocol && g.hostname === p.hostname;
    } catch (e) {
        return false;
    }
}

/**
 * @param {number} n
 * @returns {string} Two digits.
 */
const pad2 = n => String(n).padStart(2, '0');

/**
 * Local `HH:mm`.
 *
 * @param {number|Date} when
 * @returns {string}
 */
export function formatClock(when) {
    const d = new Date(when);
    if (Number.isNaN(d.getTime())) return '--:--';
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Time of a history entry: `HH:mm` for today, otherwise `d MMM HH:mm`.
 *
 * @param {string|number} at - ISO string or epoch ms.
 * @param {number} [now]
 * @param {string} [locale]
 * @returns {string}
 */
export function formatEntryTime(at, now = Date.now(), locale) {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return '--:--';
    const clock = formatClock(d);
    if (d.toDateString() === new Date(now).toDateString()) return clock;
    let day = `${d.getDate()}/${d.getMonth() + 1}`;
    try {
        day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d);
    } catch (e) {
        // keep the numeric fallback
    }
    return `${day} ${clock}`;
}

/**
 * @param {number} ms
 * @param {string} [locale]
 * @returns {string} e.g. "21 Oct 2026".
 */
export function formatDate(ms, locale) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    try {
        return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    } catch (e) {
        return d.toDateString();
    }
}

/**
 * @param {number} ms
 * @returns {string} "420 ms", "1.2 s" or "2 min 5 s".
 */
export function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '-';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)} min ${total % 60} s`;
}

/**
 * @param {Date|number} [when]
 * @returns {string} Local `YYYYMMDD`.
 */
export function formatDateStamp(when = new Date()) {
    const d = new Date(when);
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

/**
 * @param {Date|number} [when]
 * @returns {string} Local `YYYYMMDD-HHmmss`.
 */
export function formatDateTimeStamp(when = new Date()) {
    const d = new Date(when);
    return `${formatDateStamp(d)}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/**
 * @param {Date|number} [when]
 * @returns {string}
 */
export function presetsFileName(when = new Date()) {
    return `aw-cleaner-presets-${formatDateStamp(when)}.json`;
}

/**
 * @param {Date|number} [when]
 * @returns {string}
 */
export function historyFileName(when = new Date()) {
    return `aw-cleaner-history-${formatDateTimeStamp(when)}.json`;
}

/**
 * Value-free JSON of the stored history. Only the whitelisted summary fields are
 * copied, and the result is checked with the report module's sensitive-value guard.
 *
 * @param {Array<Object>} history
 * @param {Date|number} [now]
 * @returns {string}
 */
export function buildHistoryExport(history, now = new Date()) {
    const list = (Array.isArray(history) ? history : []).map(e => ({
        id: String(e?.id ?? ''),
        at: String(e?.at ?? ''),
        origins: Array.isArray(e?.origins) ? e.origins.map(String) : [],
        presetId: String(e?.presetId ?? ''),
        durationMs: Number.isFinite(e?.durationMs) ? e.durationMs : 0,
        ok: e?.ok !== false
    }));
    const payload = { format: HISTORY_FORMAT, version: 1, exportedAt: new Date(now).toISOString(), history: list };
    assertNoSensitiveValues(payload);
    return JSON.stringify(payload, null, 2);
}

/**
 * Converts a messages.json object into the flat map i18n.setFallbackMessages
 * expects ($NAME$ placeholders become $1, $2...).
 *
 * @param {Record<string, {message: string, placeholders?: Object}>} json
 * @returns {Record<string, string>}
 */
export function messagesToFallback(json) {
    const map = {};
    if (!json || typeof json !== 'object') return map;
    for (const [key, entry] of Object.entries(json)) {
        if (!entry || typeof entry.message !== 'string') continue;
        const placeholders = {};
        for (const [name, def] of Object.entries(entry.placeholders || {})) {
            placeholders[name.toLowerCase()] = def && typeof def.content === 'string' ? def.content : '';
        }
        map[key] = entry.message.replace(/\$([A-Za-z0-9_@]+)\$/g, (m, name) => {
            const content = placeholders[name.toLowerCase()];
            return content === undefined ? m : content;
        });
    }
    return map;
}

/**
 * Sorts validation messages (from presets.validatePreset or the editor) into the
 * editor field they belong to. Unmatched messages go to `general`.
 *
 * @param {string[]} errors
 * @returns {Record<string, string[]>}
 */
export function routeErrors(errors) {
    const routes = {};
    const rules = [
        ['name', /^name\b/],
        ['id', /^id\b/],
        ['types', /^(dataTypes\b|Unknown or unsupported data types)/],
        ['cookieMode', /^cookieMode\b/],
        ['after', /^after\b/],
        ['startPath', /^startPath\b/],
        ['bound', /^boundOrigin\b/],
        ['origins', /^(origins\b|At most \d+ origins)/],
        ['keep', /^keepCookieNames\b/]
    ];
    for (const message of Array.isArray(errors) ? errors : []) {
        const text = String(message);
        const rule = rules.find(([, re]) => re.test(text));
        const field = rule ? rule[0] : 'general';
        (routes[field] ||= []).push(text);
    }
    return routes;
}

// ---------------------------------------------------------------------------
// Page controller
// ---------------------------------------------------------------------------

/** Mutable page state. */
const state = {
    custom: [],
    testMode: { enabled: false, allowedOrigins: [] },
    editor: { mode: 'new', original: null, idTouched: false },
    statusTimers: new Map()
};

let settings = null;

/**
 * Calls an async function; returns the fallback when it throws.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {T} fallback
 * @returns {Promise<T>}
 */
async function safe(fn, fallback) {
    try {
        const value = await fn();
        return value === undefined ? fallback : value;
    } catch (e) {
        return fallback;
    }
}

const $ = id => document.getElementById(id);

/**
 * Builds an element. Strings become text nodes, never markup.
 *
 * @param {string} tag
 * @param {Object} [props] - `class`, `text`, `on` ({event: handler}), other keys become attributes.
 * @param {...(Node|string|null)} children
 * @returns {HTMLElement}
 */
function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'on') {
            for (const [name, handler] of Object.entries(value)) node.addEventListener(name, handler);
        } else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children) if (child !== null && child !== undefined) node.append(child);
    return node;
}

/**
 * Shows a message in a status element.
 *
 * @param {HTMLElement} node
 * @param {'success'|'error'|'info'} kind
 * @param {string|{heading: string, items: string[]}} content
 * @returns {void}
 */
function showStatus(node, kind, content) {
    if (!node) return;
    clearTimeout(state.statusTimers.get(node));
    node.className = `status-message ${kind}`;
    node.replaceChildren();
    if (typeof content === 'string') {
        node.append(content);
    } else {
        const box = el('div', {}, el('strong', { text: content.heading }));
        const list = el('ul', { class: 'status-list' });
        for (const item of content.items) list.append(el('li', { text: item }));
        box.append(list);
        node.append(box);
    }
    if (kind === 'success') {
        state.statusTimers.set(node, setTimeout(() => hideStatus(node), 6000));
    }
}

/**
 * @param {HTMLElement} node
 * @returns {void}
 */
function hideStatus(node) {
    if (!node) return;
    clearTimeout(state.statusTimers.get(node));
    node.className = 'status-message hidden';
    node.replaceChildren();
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorText(err) {
    return getMessage('errorPrefix', String(err && err.message ? err.message : err));
}

/**
 * Moves focus to a section heading after the focused control was removed.
 *
 * @param {string} sectionId
 * @returns {void}
 */
function refocusSection(sectionId) {
    if (document.activeElement && document.activeElement !== document.body) return;
    const heading = $(sectionId)?.querySelector('.card-title');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
}

/**
 * Hides or shows a whole section and its navigation entry.
 *
 * @param {string} id
 * @param {boolean} available
 * @returns {void}
 */
function setSectionAvailable(id, available) {
    const section = $(id);
    if (section) section.hidden = !available;
    const link = document.querySelector(`#sideNav a[data-section="${id}"]`);
    if (link && link.parentElement) link.parentElement.hidden = !available;
}

/**
 * @returns {string|undefined} UI language for Intl formatting.
 */
function uiLocale() {
    try {
        return globalThis.chrome?.i18n?.getUILanguage?.() || undefined;
    } catch (e) {
        return undefined;
    }
}

/**
 * Starts a file download from text (no downloads permission needed).
 *
 * @param {string} fileName
 * @param {string} text
 * @returns {void}
 */
function downloadJson(fileName, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = el('a', { href: url, download: fileName, hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---- presets --------------------------------------------------------------

/**
 * @param {Object} preset
 * @returns {string}
 */
function presetDisplayName(preset) {
    return preset.builtin ? getMessage(preset.nameKey) : preset.name;
}

/**
 * @param {string[]} types
 * @returns {string} Comma separated, localized labels in registry order.
 */
function typeLabels(types) {
    return DATA_TYPES.filter(def => types.includes(def.key)).map(def => getMessage(def.labelKey)).join(', ');
}

/**
 * @param {string[]} types
 * @returns {string}
 */
function dataTypesSummary(types) {
    if (types.length === DATA_TYPES.length) return getMessage('optionsAllTypes', String(types.length));
    if (types.length > 5) return getMessage('optionsTypesCount', String(types.length));
    return typeLabels(types);
}

/**
 * @returns {Set<string>} Ids that cannot be used for a new preset.
 */
function takenPresetIds() {
    return new Set([...BUILTIN_PRESETS.map(p => p.id), ...state.custom.map(p => p.id)]);
}

/**
 * @param {Object} preset
 * @returns {HTMLTableRowElement}
 */
function presetRow(preset) {
    const name = presetDisplayName(preset);
    const nameCell = el('th', { scope: 'row', class: 'preset-name' }, name);
    if (preset.builtin) nameCell.append(el('span', { class: 'badge', text: getMessage('optionsBuiltinBadge') }));

    const typesCell = el('td', { text: dataTypesSummary(preset.dataTypes) });
    if (preset.dataTypes.length > 5) {
        // The short summary hides the list; keep it available to hover and screen readers.
        typesCell.setAttribute('title', typeLabels(preset.dataTypes));
        typesCell.append(el('span', { class: 'sr-only', text: `: ${typeLabels(preset.dataTypes)}` }));
    }

    const hasCookies = preset.dataTypes.includes('cookies');
    const cookieCell = el('td');
    if (!hasCookies) {
        cookieCell.append(el('span', { class: 'cell-muted', text: '—' }));
    } else if (preset.cookieMode === 'domainWide') {
        cookieCell.append(el('span', { class: 'cookie-wide', text: getMessage('optionsCookieDomainWide') }));
    } else {
        cookieCell.append(el('span', { class: 'cookie-exact', text: getMessage('optionsCookieExact') }));
    }

    const afterCell = el('td', { class: 'col-nowrap' });
    if (preset.after === 'start') {
        const path = preset.startPath || '/';
        if (preset.builtin) {
            afterCell.append(getMessage('optionsAfterStart'));
        } else {
            afterCell.append(el('span', { class: 'cell-mono', text: getMessage('optionsAfterStartPath', path) }));
        }
    } else {
        afterCell.append(getMessage(AFTER_LABEL_KEYS[preset.after] || AFTER_LABEL_KEYS.none));
    }

    const boundCell = el('td', { class: 'col-bound' });
    if (preset.boundOrigin) {
        boundCell.append(el('span', { class: 'cell-mono', text: preset.boundOrigin }));
        const extra = (preset.origins || []).filter(o => o !== preset.boundOrigin).length;
        if (extra > 0) boundCell.append(el('span', { class: 'badge', text: `+${extra}` }));
    } else if (preset.origins && preset.origins.length) {
        boundCell.append(el('span', { class: 'cell-mono', text: preset.origins[0] }));
        if (preset.origins.length > 1) boundCell.append(el('span', { class: 'badge', text: `+${preset.origins.length - 1}` }));
    } else {
        boundCell.append(el('span', { class: 'cell-muted', text: getMessage('optionsBoundAny') }));
    }

    const actions = el('td', { class: 'cell-actions' });
    if (preset.builtin) {
        actions.append(el('button', {
            type: 'button',
            class: 'link-btn',
            'data-action': 'duplicate',
            'aria-label': getMessage('optionsDuplicateAria', name),
            text: getMessage('optionsDuplicate'),
            on: { click: () => openEditor('duplicate', preset) }
        }));
    } else {
        actions.append(
            el('button', {
                type: 'button',
                class: 'link-btn',
                'data-action': 'edit',
                'aria-label': getMessage('optionsEditAria', name),
                text: getMessage('optionsEdit'),
                on: { click: () => openEditor('edit', preset) }
            }),
            ' ',
            el('button', {
                type: 'button',
                class: 'link-btn link-btn-danger',
                'data-action': 'delete',
                'aria-label': getMessage('optionsDeleteAria', name),
                text: getMessage('optionsDelete'),
                on: { click: () => deletePreset(preset) }
            })
        );
    }

    return el('tr', { 'data-preset-id': preset.id, 'data-builtin': String(Boolean(preset.builtin)) },
        nameCell,
        typesCell,
        cookieCell,
        afterCell,
        boundCell,
        actions);
}

function renderPresets() {
    const body = $('presetRows');
    body.replaceChildren(...[...BUILTIN_PRESETS, ...state.custom].map(presetRow));
    const exportBtn = $('exportPresetsBtn');
    const none = state.custom.length === 0;
    exportBtn.disabled = none;
    if (none) exportBtn.setAttribute('title', getMessage('optionsExportNone'));
    else exportBtn.removeAttribute('title');
}

async function refreshPresets() {
    state.custom = await safe(() => settings.getCustomPresets(), []);
    renderPresets();
}

async function deletePreset(preset) {
    if (!globalThis.confirm(getMessage('optionsDeleteConfirm', presetDisplayName(preset)))) return;
    try {
        await settings.deleteCustomPreset(preset.id);
        await refreshPresets();
        showStatus($('presetsStatus'), 'success', getMessage('optionsPresetDeleted'));
        refocusSection('presets');
    } catch (e) {
        showStatus($('presetsStatus'), 'error', errorText(e));
    }
}

function exportCustomPresets() {
    try {
        downloadJson(presetsFileName(), exportPresets(state.custom));
        showStatus($('presetsStatus'), 'success', getMessage('optionsExported'));
    } catch (e) {
        showStatus($('presetsStatus'), 'error', errorText(e));
    }
}

/**
 * @param {File|undefined} file
 * @returns {Promise<void>}
 */
async function importPresetFile(file) {
    const status = $('presetsStatus');
    if (!file) return;
    const failHeading = getMessage('optionsImportFailed');
    if (file.size > MAX_IMPORT_BYTES) {
        showStatus(status, 'error', { heading: failHeading, items: [`${file.name}: > 1 MB`] });
        return;
    }
    try {
        const text = await file.text();
        const result = importPresets(text, state.custom);
        if (!result.ok) {
            showStatus(status, 'error', { heading: failHeading, items: result.errors.slice(0, 12) });
            return;
        }
        const failures = [];
        for (const preset of result.imported) {
            const saved = await settings.saveCustomPreset(preset);
            if (!saved.ok) failures.push(...saved.errors);
        }
        await refreshPresets();
        if (failures.length) showStatus(status, 'error', { heading: failHeading, items: failures.slice(0, 12) });
        else showStatus(status, 'success', getMessage('optionsPresetsImported', String(result.imported.length)));
    } catch (e) {
        showStatus(status, 'error', { heading: failHeading, items: [String(e && e.message ? e.message : e)] });
    }
}

// ---- preset editor --------------------------------------------------------

function buildTypeGrid() {
    const grid = $('fTypes');
    grid.replaceChildren(...DATA_TYPES.map(def => el('label', { class: 'check-row' },
        el('input', { type: 'checkbox', value: def.key, name: 'dataType', id: `fType-${def.key}` }),
        el('span', { text: getMessage(def.labelKey) }))));
    grid.setAttribute('tabindex', '-1');
}

function selectedTypes() {
    return [...document.querySelectorAll('#fTypes input[type="checkbox"]:checked')].map(i => i.value);
}

function syncEditorVisibility() {
    const hasCookies = selectedTypes().includes('cookies');
    for (const radio of document.querySelectorAll('input[name="cookieMode"]')) radio.disabled = !hasCookies;
    $('fStartPathField').hidden = $('fAfter').value !== 'start';
}

function updateBoundPreview() {
    const raw = $('fBound').value.trim();
    const preview = $('fBoundPreview');
    const error = $('fBoundError');
    $('fBound').removeAttribute('aria-invalid');
    error.hidden = true;
    error.textContent = '';
    if (!raw) {
        preview.hidden = true;
        preview.textContent = '';
        return;
    }
    const result = normalizeTarget(raw);
    if (result.valid) {
        preview.hidden = false;
        preview.textContent = getMessage('optionsBoundPreview', result.origin);
    } else {
        preview.hidden = true;
        preview.textContent = '';
        error.hidden = false;
        error.textContent = result.error;
        $('fBound').setAttribute('aria-invalid', 'true');
    }
}

function autoFillId() {
    if (state.editor.mode === 'edit' || state.editor.idTouched) return;
    const slug = slugify($('fName').value);
    $('fId').value = slug ? uniqueId(slug, takenPresetIds()) : '';
}

function clearEditorErrors() {
    for (const { error, control } of Object.values(FIELD_MAP)) {
        const node = $(error);
        node.hidden = true;
        node.textContent = '';
        if (control) $(control)?.removeAttribute('aria-invalid');
    }
}

/**
 * @param {Record<string, string[]>} routes
 * @returns {void}
 */
function showEditorErrors(routes) {
    let first = null;
    for (const [field, messages] of Object.entries(routes)) {
        const map = FIELD_MAP[field] || FIELD_MAP.general;
        const node = $(map.error);
        node.hidden = false;
        node.replaceChildren(...messages.flatMap((m, i) => (i ? [el('br'), m] : [m])));
        if (map.control) {
            $(map.control)?.setAttribute('aria-invalid', 'true');
            if (!first) first = map.control;
        }
    }
    const target = first && $(first);
    if (target) {
        // Groups (fieldset / grid) are not focusable: focus their first control.
        const focusable = target.matches('input, select, textarea, button')
            ? target
            : target.querySelector('input:not(:disabled), select, textarea');
        (focusable || target).focus();
    }
}

/**
 * @param {'new'|'edit'|'duplicate'} mode
 * @param {Object|null} [preset]
 * @returns {void}
 */
function openEditor(mode, preset = null) {
    clearEditorErrors();
    state.editor = { mode, original: mode === 'edit' ? preset : null, idTouched: false };
    $('editorTitle').textContent = getMessage(mode === 'edit' ? 'optionsEditorEditTitle' : 'optionsEditorNewTitle');

    const source = preset || { dataTypes: ['localStorage'], cookieMode: 'exact', after: 'none', startPath: '/' };
    let name = '';
    if (mode === 'edit') name = preset.name;
    else if (mode === 'duplicate') name = getMessage('optionsCopySuffix', presetDisplayName(preset)).slice(0, 60);
    $('fName').value = name;

    const idField = $('fId');
    idField.readOnly = mode === 'edit';
    idField.value = mode === 'edit' ? preset.id : '';
    if (mode === 'duplicate') idField.value = uniqueId(slugify(name) || 'preset', takenPresetIds());

    for (const box of document.querySelectorAll('#fTypes input[type="checkbox"]')) {
        box.checked = source.dataTypes.includes(box.value);
    }
    for (const radio of document.querySelectorAll('input[name="cookieMode"]')) {
        radio.checked = radio.value === (source.cookieMode || 'exact');
    }
    $('fAfter').value = source.after || 'none';
    $('fStartPath').value = source.startPath || '/';
    $('fBound').value = source.boundOrigin || '';
    $('fOrigins').value = (source.origins || []).join('\n');
    $('fKeep').value = (source.keepCookieNames || []).join(', ');
    syncEditorVisibility();
    updateBoundPreview();

    const dialog = $('presetDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    $('fName').focus();
}

function closeEditor() {
    const dialog = $('presetDialog');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
}

/**
 * Reads the form into a preset candidate. Problems found while reading are
 * added to `local` (field to messages).
 *
 * @param {Record<string, string[]>} local
 * @returns {Object}
 */
function readEditor(local) {
    const after = $('fAfter').value;
    const candidate = {
        id: $('fId').value.trim(),
        name: $('fName').value,
        dataTypes: selectedTypes(),
        cookieMode: document.querySelector('input[name="cookieMode"]:checked')?.value || 'exact',
        after,
        startPath: after === 'start' ? $('fStartPath').value.trim() : (state.editor.original?.startPath || '/')
    };
    const bound = $('fBound').value.trim();
    if (bound) {
        const result = normalizeTarget(bound);
        if (result.valid) candidate.boundOrigin = result.origin;
        else (local.bound ||= []).push(result.error);
    }
    const origins = parseOriginLines($('fOrigins').value);
    if (origins.length) candidate.origins = origins;
    const keep = parseList($('fKeep').value);
    if (keep.length) candidate.keepCookieNames = keep;
    return candidate;
}

/**
 * @param {Event} event
 * @returns {Promise<void>}
 */
async function submitEditor(event) {
    event.preventDefault();
    clearEditorErrors();
    const local = {};
    const candidate = readEditor(local);
    const checked = validatePreset(candidate);
    const routes = checked.ok ? {} : routeErrors(checked.errors);
    for (const [field, messages] of Object.entries(local)) routes[field] = [...messages, ...(routes[field] || [])];
    if (state.editor.mode !== 'edit' && candidate.id && state.custom.some(p => p.id === candidate.id)) {
        (routes.id ||= []).push(getMessage('optionsIdTaken'));
    }
    if (Object.keys(routes).length) {
        showEditorErrors(routes);
        return;
    }
    try {
        const saved = await settings.saveCustomPreset(checked.preset);
        if (!saved.ok) {
            const savedRoutes = routeErrors(saved.errors);
            if (!Object.keys(savedRoutes).length) savedRoutes.general = [getMessage('optionsSaveFailed')];
            showEditorErrors(savedRoutes);
            return;
        }
        closeEditor();
        await refreshPresets();
        showStatus($('presetsStatus'), 'success', getMessage('optionsPresetSaved'));
    } catch (e) {
        showEditorErrors({ general: [errorText(e)] });
    }
}

// ---- permissions ----------------------------------------------------------

/**
 * @param {Object} entry - {pattern, origin, grant}
 * @returns {HTMLLIElement}
 */
function grantRow({ pattern, origin, grant }) {
    const kind = !grant || grant.kind === 'cookies' ? getMessage('optionsGrantKindCookies') : grant.kind;
    const parts = [kind];
    if (grant && Number.isFinite(grant.at)) parts.push(getMessage('optionsGrantedOn', formatDate(grant.at, uiLocale())));
    const label = origin || pattern;
    return el('li', { 'data-pattern': pattern },
        el('span', { class: 'grant-origin', text: label }),
        el('span', { class: 'grant-meta', text: parts.join(' · ') }),
        el('button', {
            type: 'button',
            class: 'btn btn-secondary btn-sm',
            'aria-label': getMessage('optionsRevokeAria', label),
            text: getMessage('optionsRevoke'),
            on: { click: () => revokeGrant({ pattern, origin }) }
        }));
}

async function renderPermissions() {
    const perms = globalThis.chrome?.permissions;
    const available = Boolean(perms && typeof perms.getAll === 'function');
    setSectionAvailable('permissions', available);
    if (!available) return;

    let manifest = {};
    try {
        manifest = globalThis.chrome.runtime.getManifest() || {};
    } catch (e) {
        manifest = {};
    }
    const fixedHosts = new Set(manifest.host_permissions || []);
    const all = await safe(() => perms.getAll(), { origins: [] });
    const patterns = (all.origins || []).filter(p => !fixedHosts.has(p));
    const grants = await safe(() => settings.listPermissionGrants(), []);

    const rows = patterns.map(pattern => {
        const origin = originFromPattern(pattern);
        const matching = origin ? grants.filter(g => grantMatchesPattern(g.origin, origin)) : [];
        const grant = matching.sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null;
        return { pattern, origin, grant };
    });
    $('grantList').replaceChildren(...rows.map(grantRow));
    $('grantEmpty').hidden = rows.length > 0;

    const names = Array.isArray(manifest.permissions) ? manifest.permissions : [];
    $('installPerms').replaceChildren(...names.map(name => el('li', {},
        el('span', { class: 'perm-name', text: name }),
        el('span', { text: getMessage(PERMISSION_PURPOSE_KEYS[name] || 'optionsPermUnknown') }))));
    document.querySelector('.install-perms').hidden = names.length === 0;
}

/**
 * @param {{pattern: string, origin: string|null}} entry
 * @returns {Promise<void>}
 */
async function revokeGrant({ pattern, origin }) {
    const status = $('permissionsStatus');
    const label = origin || pattern;
    try {
        const removed = await globalThis.chrome.permissions.remove({ origins: [pattern] });
        if (removed === false) {
            showStatus(status, 'error', getMessage('optionsRevokeFailed', label));
            return;
        }
        if (origin) {
            const grants = await safe(() => settings.listPermissionGrants(), []);
            for (const g of grants) {
                if (grantMatchesPattern(g.origin, origin)) await safe(() => settings.removePermissionGrant(g.origin), false);
            }
        }
        await renderPermissions();
        showStatus(status, 'success', getMessage('optionsRevoked', label));
        refocusSection('permissions');
    } catch (e) {
        showStatus(status, 'error', errorText(e));
    }
}

// ---- Test Mode ------------------------------------------------------------

function renderTestMode() {
    const { enabled, allowedOrigins } = state.testMode;
    const toggle = $('testModeSwitch');
    toggle.setAttribute('aria-checked', String(enabled));
    const field = $('testOrigins');
    field.value = allowedOrigins.join(', ');
    field.disabled = !enabled;
    field.removeAttribute('aria-invalid');
    $('saveTestOriginsBtn').disabled = !enabled;
}

async function refreshTestMode() {
    state.testMode = await safe(() => settings.getTestMode(), { enabled: false, allowedOrigins: ['http://localhost', 'http://127.0.0.1'] });
    renderTestMode();
}

/**
 * @param {boolean} enabled
 * @param {string[]} origins
 * @returns {Promise<void>}
 */
async function applyTestMode(enabled, origins) {
    const status = $('testModeError');
    try {
        const result = await settings.setTestMode({ enabled, allowedOrigins: origins });
        if (!result.ok) {
            showStatus(status, 'error', { heading: getMessage('optionsTestModeInvalid'), items: result.errors.slice(0, 8) });
            $('testOrigins').setAttribute('aria-invalid', 'true');
            if (enabled !== state.testMode.enabled) renderTestMode();
            return;
        }
        state.testMode = result.config;
        renderTestMode();
        showStatus(status, 'success', getMessage('optionsTestModeSaved'));
    } catch (e) {
        renderTestMode();
        showStatus(status, 'error', errorText(e));
    }
}

// ---- history & evidence ---------------------------------------------------

/**
 * @param {string} id
 * @param {Object[]} custom
 * @returns {string}
 */
function presetNameForId(id, custom) {
    const builtin = BUILTIN_PRESETS.find(p => p.id === id);
    if (builtin) return getMessage(builtin.nameKey);
    const found = custom.find(p => p.id === id);
    if (found) return found.name;
    return id === 'custom' ? getMessage('presetCustom') : id;
}

/**
 * @param {Object} entry
 * @param {Object[]} custom
 * @returns {HTMLLIElement}
 */
function historyRow(entry, custom) {
    const origins = Array.isArray(entry.origins) ? entry.origins : [];
    let originText = origins[0] || '';
    if (origins.length > 1) originText += ` ${getMessage('optionsMoreOrigins', String(origins.length - 1))}`;
    const ok = entry.ok !== false;
    return el('li', {},
        el('span', { class: 'h-time', text: formatEntryTime(entry.at, Date.now(), uiLocale()) }),
        el('span', { class: 'h-origin', title: origins.join('\n'), text: originText }),
        el('span', { class: 'h-preset', text: presetNameForId(entry.presetId, custom) }),
        el('span', { class: 'h-duration', text: formatDuration(entry.durationMs) }),
        el('span', { class: ok ? 'h-status' : 'h-status failed', text: getMessage(ok ? 'optionsStatusOk' : 'optionsStatusFailed') }));
}

async function renderHistory() {
    const enabled = await safe(() => settings.getHistoryEnabled(), true);
    const history = await safe(() => settings.getHistory(), []);
    $('historySwitch').setAttribute('aria-checked', String(enabled));
    $('historyList').replaceChildren(...history.map(e => historyRow(e, state.custom)));
    const empty = $('historyEmpty');
    empty.hidden = history.length > 0;
    empty.textContent = getMessage(enabled ? 'optionsHistoryEmpty' : 'optionsHistoryOff');
    $('exportHistoryBtn').disabled = history.length === 0;
    $('clearHistoryBtn').disabled = history.length === 0;

    const recent = await safe(() => settings.getRecentOrigins(), []);
    $('recentList').replaceChildren(...recent.map(r => el('li', { text: r.origin })));
    $('recentEmpty').hidden = recent.length > 0;
    $('clearRecentBtn').disabled = recent.length === 0;
}

async function renderSession() {
    const start = await safe(() => settings.getSessionStart(), null);
    const running = Number.isFinite(start);
    $('sessionState').textContent = running
        ? getMessage('optionsSessionStartedAt', formatClock(start))
        : getMessage('optionsSessionNone');
    $('sessionStartBtn').hidden = running;
    $('sessionEndBtn').hidden = !running;
}

async function toggleHistory() {
    const next = $('historySwitch').getAttribute('aria-checked') !== 'true';
    try {
        await settings.setHistoryEnabled(next);
        await renderHistory();
    } catch (e) {
        showStatus($('historyStatus'), 'error', errorText(e));
    }
}

async function exportHistory() {
    const status = $('historyStatus');
    try {
        const history = await settings.getHistory();
        downloadJson(historyFileName(), buildHistoryExport(history));
        showStatus(status, 'success', getMessage('optionsHistoryExported'));
    } catch (e) {
        showStatus(status, 'error', errorText(e));
    }
}

async function clearHistory() {
    if (!globalThis.confirm(getMessage('optionsClearHistoryConfirm'))) return;
    try {
        await settings.clearHistory();
        await renderHistory();
        showStatus($('historyStatus'), 'success', getMessage('optionsHistoryCleared'));
        refocusSection('history');
    } catch (e) {
        showStatus($('historyStatus'), 'error', errorText(e));
    }
}

async function clearRecent() {
    try {
        await settings.clearRecentOrigins();
        await renderHistory();
        showStatus($('historyStatus'), 'success', getMessage('optionsRecentCleared'));
        refocusSection('history');
    } catch (e) {
        showStatus($('historyStatus'), 'error', errorText(e));
    }
}

/**
 * @param {boolean} start
 * @returns {Promise<void>}
 */
async function setSession(start) {
    try {
        if (start) await settings.startSession(Date.now());
        else await settings.clearSession();
        await renderSession();
        (start ? $('sessionEndBtn') : $('sessionStartBtn')).focus();
    } catch (e) {
        showStatus($('historyStatus'), 'error', errorText(e));
    }
}

// ---- shortcuts ------------------------------------------------------------

async function renderShortcuts() {
    const api = globalThis.chrome?.commands;
    let commands = null;
    if (api && typeof api.getAll === 'function') {
        try {
            commands = await api.getAll();
        } catch (e) {
            commands = null;
        }
    }
    setSectionAvailable('shortcuts', Array.isArray(commands));
    if (!Array.isArray(commands)) return;

    $('shortcutList').replaceChildren(...commands.map(cmd => {
        const description = cmd.description
            || (cmd.name === '_execute_action' ? getMessage('optionsShortcutExecuteAction') : cmd.name);
        const key = cmd.shortcut
            ? el('kbd', { class: 'shortcut-key', text: cmd.shortcut })
            : el('span', { class: 'shortcut-key unset', text: getMessage('optionsShortcutNotSet') });
        return el('li', {}, key, el('span', { text: description }));
    }));
    $('shortcutsEmpty').hidden = commands.length > 0;
    $('openShortcutsBtn').hidden = typeof globalThis.chrome?.tabs?.create !== 'function';
}

function openShortcutsPage() {
    try {
        globalThis.chrome.tabs.create({ url: SHORTCUTS_URL });
    } catch (e) {
        // the tabs API is unavailable; the page address is shown next to the button
    }
}

// ---- navigation -----------------------------------------------------------

function initNavigation() {
    const links = [...document.querySelectorAll('#sideNav a[data-section]')];

    const setActive = id => {
        for (const link of links) {
            if (link.dataset.section === id) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        }
    };

    const visibleSections = () => links
        .map(link => $(link.dataset.section))
        .filter(section => section && !section.hidden);

    // A clicked link stays active at the very bottom of the page, where the last
    // sections cannot reach the top. Any manual scroll input releases it.
    let lockedId = null;

    const update = () => {
        const sections = visibleSections();
        if (!sections.length) return;
        let current = sections[0];
        for (const section of sections) {
            if (section.getBoundingClientRect().top <= 120) current = section;
        }
        const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
        if (atBottom && window.scrollY > 0) {
            const locked = sections.find(s => s.id === lockedId);
            current = locked && locked.getBoundingClientRect().top < window.innerHeight * 0.6 ? locked : sections[sections.length - 1];
        }
        setActive(current.id);
    };

    let frame = 0;
    const schedule = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            update();
        });
    };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', () => {
        const id = location.hash.slice(1);
        if (links.some(l => l.dataset.section === id)) {
            lockedId = id;
            setActive(id);
        }
        schedule();
    });
    for (const type of ['wheel', 'touchmove', 'keydown']) {
        window.addEventListener(type, () => { lockedId = null; }, { passive: true });
    }
    for (const link of links) {
        link.addEventListener('click', () => {
            lockedId = link.dataset.section;
            setActive(lockedId);
        });
    }
    update();
}

// ---- boot -----------------------------------------------------------------

async function loadFallbackMessages() {
    if (typeof globalThis.chrome?.i18n?.getMessage === 'function') return;
    try {
        const response = await fetch('_locales/en/messages.json');
        setFallbackMessages(messagesToFallback(await response.json()));
    } catch (e) {
        // keys stay visible, which is acceptable outside an extension context
    }
}

function renderVersion() {
    let version = '';
    try {
        version = globalThis.chrome?.runtime?.getManifest?.().version || '';
    } catch (e) {
        version = '';
    }
    const tag = $('versionTag');
    tag.hidden = !version;
    tag.textContent = version ? `v${version}` : '';
}

function bindEvents() {
    $('newPresetBtn').addEventListener('click', () => openEditor('new'));
    $('exportPresetsBtn').addEventListener('click', exportCustomPresets);
    $('importPresetsBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', async event => {
        const input = event.target;
        await importPresetFile(input.files && input.files[0]);
        input.value = '';
    });

    $('presetForm').addEventListener('submit', submitEditor);
    $('editorCancelBtn').addEventListener('click', closeEditor);
    $('fName').addEventListener('input', autoFillId);
    $('fId').addEventListener('input', () => { state.editor.idTouched = true; });
    $('fTypes').addEventListener('change', syncEditorVisibility);
    $('fAfter').addEventListener('change', syncEditorVisibility);
    $('fBound').addEventListener('input', updateBoundPreview);

    $('testModeSwitch').addEventListener('click', () => {
        const next = !state.testMode.enabled;
        applyTestMode(next, next ? parseOriginList($('testOrigins').value) : state.testMode.allowedOrigins);
    });
    $('saveTestOriginsBtn').addEventListener('click', () => {
        applyTestMode(true, parseOriginList($('testOrigins').value));
    });

    $('historySwitch').addEventListener('click', toggleHistory);
    $('exportHistoryBtn').addEventListener('click', exportHistory);
    $('clearHistoryBtn').addEventListener('click', clearHistory);
    $('clearRecentBtn').addEventListener('click', clearRecent);
    $('sessionStartBtn').addEventListener('click', () => setSession(true));
    $('sessionEndBtn').addEventListener('click', () => setSession(false));
    $('openShortcutsBtn').addEventListener('click', openShortcutsPage);
}

function watchChrome() {
    let timer = 0;
    const refresh = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            await refreshPresets();
            await renderHistory();
            await renderSession();
            await renderPermissions();
        }, 120);
    };
    try {
        globalThis.chrome?.permissions?.onAdded?.addListener(refresh);
        globalThis.chrome?.permissions?.onRemoved?.addListener(refresh);
        globalThis.chrome?.storage?.onChanged?.addListener(changes => {
            // Test Mode is left alone so unsaved edits are not overwritten.
            if (Object.keys(changes || {}).some(k => !k.startsWith('aw.testMode'))) refresh();
        });
    } catch (e) {
        // listeners are optional
    }
}

async function init() {
    settings = createSettings();
    await loadFallbackMessages();
    localizeDocument(document);
    buildTypeGrid();
    renderVersion();
    bindEvents();
    initNavigation();

    await refreshPresets();
    await Promise.all([
        refreshTestMode(),
        renderHistory(),
        renderSession(),
        renderPermissions(),
        renderShortcuts()
    ]);
    // Section availability may have changed the active navigation entry.
    window.dispatchEvent(new Event('scroll'));
    watchChrome();
}

if (typeof document !== 'undefined' && document.getElementById('presetRows')) {
    init().catch(err => {
        showStatus($('presetsStatus'), 'error', getMessage('optionsLoadFailed', String(err && err.message ? err.message : err)));
    });
}
