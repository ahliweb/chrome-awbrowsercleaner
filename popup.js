/**
 * AW Browser Cleaner - Popup controller
 *
 * Screens: 1 main, 2 exact cookies, 3 confirm, 4 result (popup-result.js),
 * 5 unsupported page (popup-unsupported.js). Screens are <section>s toggled
 * with `hidden`; `body[data-screen]` names the active one.
 *
 * Design principles:
 * - The popup never calls browsing-data or cookie-removal APIs itself: every
 *   deletion is a plan built with createPlan() and run by executePlan() (Scope
 *   Guard inside) from cleanup-core.js; the after-action by runAfterAction().
 * - Targets are exact origins (scheme + host + port). Extra origins are exact
 *   too (never wildcards), at most MAX_ORIGINS in total.
 * - The confirmation screen renders only from describePlan() of the plan that
 *   passed createPlan().
 * - Cookie values are never read: cookies are classified by cookie-engine.js,
 *   which returns redacted metadata, and only names and attributes are shown.
 * - Dynamic text is rendered with createElement/textContent only (no innerHTML).
 */

import { normalizeTarget } from './origin-utils.js';
import {
    createPlan,
    describePlan,
    executePlan,
    runAfterAction,
    confirmationLevel,
    ScopeGuardError,
    DATA_TYPES,
    DATA_TYPE_KEYS,
    AFTER_ACTIONS,
    MAX_ORIGINS
} from './cleanup-core.js';
import { classifyCookies, candidateDomains, originHost } from './cookie-engine.js';
import { getPreset, presetMatchesSelection, presetToPlanInput } from './presets.js';
import { createSettings } from './settings.js';
import { buildReport, historyEntry } from './report.js';
import { snapshotProbe, mergeFrameResults } from './page-probes.js';
import { getActiveTab, tabContext } from './chrome-helpers.js';
import { getMessage as t, localizeDocument } from './i18n.js';
import { renderUnsupported, normalizationPreview } from './popup-unsupported.js';
import { renderResult } from './popup-result.js';

/** How long error/info messages stay visible. Success stays until the next action. */
const STATUS_TIMEOUT_MS = 6000;

/** Preset used when nothing was used before. */
const DEFAULT_PRESET_ID = 'fresh';

/** Storage key for the after-action chosen per preset (sync area). */
const AFTER_BY_PRESET_KEY = 'aw.afterByPreset';

/** Sign-in providers: clearing them can sign the user out of unrelated sites. */
const IDP_HOSTS = Object.freeze([
    'accounts.google.com',
    'login.microsoftonline.com',
    'login.live.com',
    'appleid.apple.com',
    'github.com'
]);

/** Time ranges: id to minutes (null = all time, 'session' = test session start). */
const RANGE_MINUTES = Object.freeze({ '15m': 15, '1h': 60 });

/** Message key of the tooltip of each data type. */
const TYPE_TIP_KEYS = Object.freeze({
    cookies: 'typeTipCookies',
    sessionStorage: 'typeTipSessionStorage',
    localStorage: 'typeTipLocalStorage',
    indexedDB: 'typeTipIndexedDB',
    fileSystems: 'typeTipFileSystems',
    cache: 'typeTipCache',
    cacheStorage: 'typeTipCacheStorage',
    serviceWorkers: 'typeTipServiceWorkers'
});

/** Unit message keys shown after the counts on the confirm screen. */
const UNIT_KEYS = Object.freeze({
    sessionStorage: 'unitKeys',
    localStorage: 'unitKeys',
    indexedDB: 'unitDb',
    cacheStorage: 'unitCaches'
});

/** @type {Object} chrome API object. */
const api = globalThis.chrome;

const settings = createSettings();

/** Shorthand for getElementById. */
const $ = id => document.getElementById(id);

/**
 * Mutable popup state. `selected` is what the user wants; the checkboxes show
 * what is effective (a disabled row is never checked).
 */
const state = {
    tab: null,
    tabCtx: null,
    origin: '',
    extraOrigins: [],
    customPresets: [],
    presetId: DEFAULT_PRESET_ID,
    selected: new Set(),
    cookieMode: 'exact',
    cookieSelection: { includeShared: [], keepNames: [] },
    afterWanted: 'hard',
    afterByPreset: {},
    startPath: '/',
    sessionStart: null,
    probe: null,
    cookies: null,
    countToken: 0,
    pending: null,
    busy: false,
    statusTimer: null,
    view: null
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Builds an element. Text goes through textContent only.
 * @param {string} tag - Tag name.
 * @param {{class?: string, text?: string, attrs?: Object<string, string>}} [opts] - Options.
 * @param {Array<Node|string>} [children] - Children.
 * @returns {HTMLElement} The element.
 */
function h(tag, opts = {}, children = []) {
    const node = document.createElement(tag);
    if (opts.class) node.className = opts.class;
    if (opts.text !== undefined) node.textContent = opts.text;
    for (const [name, value] of Object.entries(opts.attrs || {})) node.setAttribute(name, value);
    for (const child of children) node.append(child);
    return node;
}

/**
 * Normalizes a typed target. Wildcards are refused up front: Chrome's URL parser
 * percent-encodes "*" in hosts ("%2A"), which would slip past a plain "*" check.
 * @param {string} raw - User input.
 * @returns {{valid: boolean, origin: string, error: string}} Result of normalizeTarget().
 */
function checkTarget(raw) {
    if (/\*|%2a/i.test(String(raw))) {
        return { valid: false, origin: '', error: 'Wildcards are not allowed. Enter one exact origin.' };
    }
    return normalizeTarget(raw);
}

/**
 * Runs an async function and returns a fallback when it throws.
 * @param {Function} fn - Async function.
 * @param {*} fallback - Value on failure.
 * @returns {Promise<*>} Result or fallback.
 */
async function safe(fn, fallback) {
    try {
        return await fn();
    } catch (e) {
        return fallback;
    }
}

/**
 * Fills `parent` with a localized sentence whose $1..$n placeholders are
 * replaced by DOM nodes (used for bold or monospace fragments).
 * @param {HTMLElement} parent - Element to fill.
 * @param {string} key - Message key.
 * @param {Array<Node|string>} slots - Replacement nodes in placeholder order.
 * @returns {void}
 */
function fillTemplate(parent, key, slots) {
    const markers = slots.map((_, i) => String.fromCharCode(0xE000 + i));
    const message = t(key, markers);
    const pattern = new RegExp(`([${markers.join('')}])`);
    parent.replaceChildren();
    for (const part of String(message).split(pattern)) {
        if (!part) continue;
        const index = markers.indexOf(part);
        parent.append(index >= 0 ? slots[index] : part);
    }
}

/**
 * Displays a status message. Success stays until the next action; errors and
 * info messages disappear after STATUS_TIMEOUT_MS.
 * @param {string} msg - Message.
 * @param {'success'|'error'|'info'} type - Kind.
 * @returns {void}
 */
function showStatus(msg, type) {
    const el = $('statusMessage');
    if (state.statusTimer) clearTimeout(state.statusTimer);
    state.statusTimer = null;
    el.textContent = msg;
    el.className = `status-message ${type}`;
    if (type !== 'success') state.statusTimer = setTimeout(clearStatus, STATUS_TIMEOUT_MS);
}

/** Hides the status message. */
function clearStatus() {
    const el = $('statusMessage');
    if (state.statusTimer) clearTimeout(state.statusTimer);
    state.statusTimer = null;
    el.textContent = '';
    el.className = 'status-message hidden';
}

const SCREENS = Object.freeze({
    main: 'screenMain',
    cookies: 'screenCookies',
    confirm: 'screenConfirm',
    result: 'screenResult',
    unsupported: 'screenUnsupported'
});

/**
 * Shows one screen and hides the others.
 * @param {'main'|'cookies'|'confirm'|'result'|'unsupported'} name - Screen name.
 * @returns {void}
 */
function showScreen(name) {
    for (const [key, id] of Object.entries(SCREENS)) $(id).hidden = key !== name;
    document.body.dataset.screen = name;
    document.body.classList.toggle('is-confirming', name === 'confirm');
}

/**
 * All origins of the current selection: primary first.
 * @returns {string[]} Origins (empty when the primary one is not valid).
 */
function allOrigins() {
    return state.origin ? [state.origin, ...state.extraOrigins.filter(o => o !== state.origin)] : [];
}

/**
 * The active tab when its origin is one of the plan origins, else null.
 * @returns {{id: number, origin: string, storeId?: string}|null} Tab context.
 */
function tabInPlan() {
    return state.tabCtx && allOrigins().includes(state.tabCtx.origin) ? state.tabCtx : null;
}

/**
 * Cookie store of an origin (only known for the active tab's origin).
 * @param {string} origin - Origin.
 * @returns {string|undefined} Store id.
 */
function storeFor(origin) {
    return state.tabCtx && state.tabCtx.origin === origin ? state.tabCtx.storeId : undefined;
}

/**
 * Current time range as a `since` timestamp.
 * @returns {number} 0 for all time, else epoch ms.
 */
function rangeSince() {
    const value = $('rangeSelect').value;
    if (value === 'session' && state.sessionStart) return Math.min(state.sessionStart, Date.now());
    if (RANGE_MINUTES[value]) return Date.now() - RANGE_MINUTES[value] * 60000;
    return 0;
}

/**
 * Why a data type cannot be selected right now.
 * @param {string} type - Data type key.
 * @returns {string} Localized reason, or '' when selectable.
 */
function disabledReason(type) {
    if (type === 'sessionStorage' && !tabInPlan()) return t('onlyActiveTabTitle');
    if (type === 'cookies' && state.cookieMode === 'exact' && rangeSince() > 0) {
        return t('cookiesNoTimeRangeTitle');
    }
    return '';
}

/**
 * Whether the after-action can run (it needs the active tab).
 * @returns {boolean} True when selectable.
 */
function afterEnabled() {
    return Boolean(tabInPlan());
}

/**
 * The after-action that will really run.
 * @returns {string} 'none' when the tab is not part of the plan.
 */
function effectiveAfter() {
    return afterEnabled() ? state.afterWanted : 'none';
}

/**
 * Types that will be part of the plan, in UI order.
 * @returns {string[]} Data type keys.
 */
function effectiveTypes() {
    return DATA_TYPE_KEYS.filter(k => state.selected.has(k) && !disabledReason(k));
}

/**
 * Whether one of the origins is a third-party sign-in provider.
 * @returns {string} The matching host, or ''.
 */
function idpHost() {
    for (const origin of allOrigins()) {
        const host = originHost(origin);
        if (IDP_HOSTS.includes(host)) return host;
    }
    return '';
}

// ---------------------------------------------------------------------------
// Settings glue
// ---------------------------------------------------------------------------

/**
 * Loads the after-action chosen per preset.
 * @returns {Promise<Object<string, string>>} Map preset id to action.
 */
async function loadAfterMap() {
    const data = await safe(() => api.storage.sync.get(AFTER_BY_PRESET_KEY), {});
    const raw = data && data[AFTER_BY_PRESET_KEY];
    const map = {};
    if (raw && typeof raw === 'object') {
        for (const [id, value] of Object.entries(raw)) {
            if (AFTER_ACTIONS.includes(value)) map[id] = value;
        }
    }
    return map;
}

/**
 * Remembers the after-action for a preset.
 * @param {string} presetId - Preset id.
 * @param {string} after - Action.
 * @returns {Promise<void>}
 */
async function saveAfter(presetId, after) {
    state.afterByPreset[presetId] = after;
    await safe(() => api.storage.sync.set({ [AFTER_BY_PRESET_KEY]: { ...state.afterByPreset } }), null);
}

/**
 * The after-action of a preset: the saved choice, else the preset default.
 * @param {Object} preset - Preset.
 * @returns {string} Action.
 */
function afterFor(preset) {
    return state.afterByPreset[preset.id] || preset.after || 'none';
}

/**
 * Display name of a preset.
 * @param {Object} preset - Preset.
 * @returns {string} Name.
 */
function presetName(preset) {
    return preset.builtin && preset.nameKey ? t(preset.nameKey) : String(preset.name || preset.id);
}

/**
 * Picks the preset for an origin: last used there, else last used, else default.
 * @param {string} origin - Origin ('' when unknown).
 * @returns {Promise<string>} Preset id.
 */
async function resolveInitialPreset(origin) {
    const candidates = [];
    if (origin) candidates.push(await safe(() => settings.getLastPresetForOrigin(origin), null));
    candidates.push(await safe(() => settings.getLastPreset(), null));
    candidates.push(DEFAULT_PRESET_ID);
    return candidates.find(id => id && getPreset(id, state.customPresets)) || DEFAULT_PRESET_ID;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Applies a preset to the form: types, cookie mode, after-action, extra
 * origins and the cookie names to keep.
 * @param {string} id - Preset id.
 * @param {{announce?: boolean}} [options] - Show a note for skipped steps.
 * @returns {void}
 */
function applyPreset(id, { announce = false } = {}) {
    const preset = getPreset(id, state.customPresets) || getPreset(DEFAULT_PRESET_ID);
    state.presetId = preset.id;
    const primary = state.origin || 'https://placeholder.invalid';
    const { input, dropped } = presetToPlanInput(preset, {
        origin: primary,
        tab: tabInPlan(),
        source: 'popup'
    });
    state.selected = new Set(preset.dataTypes);
    state.cookieMode = input.cookieMode;
    state.afterWanted = afterFor(preset);
    state.startPath = preset.startPath || '/';
    state.cookieSelection = { includeShared: [], keepNames: [...input.cookieSelection.keepNames] };
    if (Array.isArray(preset.origins) && preset.origins.length > 0) {
        state.extraOrigins = input.origins.filter(o => o !== primary).slice(0, MAX_ORIGINS - 1);
    }
    syncUi();
    if (announce && dropped.length > 0) showStatus(t('presetDropped'), 'info');
}

/**
 * Whether the form still equals the active preset.
 * @returns {boolean} True when it matches.
 */
function presetMatches() {
    const preset = getPreset(state.presetId, state.customPresets);
    if (!preset) return false;
    const wanted = {
        ...preset,
        dataTypes: preset.dataTypes.filter(k => !disabledReason(k)),
        after: afterEnabled() ? afterFor(preset) : 'none'
    };
    return presetMatchesSelection(wanted, {
        dataTypes: effectiveTypes(),
        cookieMode: state.cookieMode,
        after: effectiveAfter()
    });
}

/**
 * Whether the form equals the active preset apart from the after-action.
 * @returns {boolean} True when only `after` may differ.
 */
function presetMatchesIgnoringAfter() {
    const preset = getPreset(state.presetId, state.customPresets);
    if (!preset) return false;
    return presetMatchesSelection(
        { ...preset, dataTypes: preset.dataTypes.filter(k => !disabledReason(k)), after: 'none' },
        { dataTypes: effectiveTypes(), cookieMode: state.cookieMode, after: 'none' }
    );
}

/** Renders the preset buttons, the "more" select and the status line. */
function renderPresets() {
    const matches = presetMatches();
    const buttons = Array.from(document.querySelectorAll('#presetBar [data-preset]'));
    const activeIsBuiltin = buttons.some(b => b.dataset.preset === state.presetId);
    buttons.forEach((button, index) => {
        const pressed = matches && button.dataset.preset === state.presetId;
        button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
        const focusable = activeIsBuiltin ? button.dataset.preset === state.presetId : index === 0;
        button.tabIndex = focusable ? 0 : -1;
        const preset = getPreset(button.dataset.preset);
        if (preset) button.title = t(preset.descriptionKey);
    });

    const more = $('presetMore');
    more.hidden = state.customPresets.length === 0;
    more.value = matches && state.customPresets.some(p => p.id === state.presetId) ? state.presetId : '';

    const status = $('presetStatus');
    const total = DATA_TYPE_KEYS.length;
    status.hidden = matches;
    status.textContent = matches ? '' : t('presetStatusCustom', [String(effectiveTypes().length), String(total)]);
}

/** Fills the "more presets" select with the custom presets. */
function renderMoreSelect() {
    const more = $('presetMore');
    more.replaceChildren(h('option', { text: t('presetMoreOption'), attrs: { value: '' } }));
    for (const preset of state.customPresets) {
        more.append(h('option', { text: presetName(preset), attrs: { value: preset.id } }));
    }
}

// ---------------------------------------------------------------------------
// Counts (snapshot taken when the popup opens)
// ---------------------------------------------------------------------------

/**
 * Counts what an origin stores, from the active tab (top frame only).
 * @param {string} origin - Target origin; must equal the tab origin.
 * @returns {Promise<Object|null>} Probe result or null.
 */
async function takeProbe(origin) {
    if (!state.tabCtx || state.tabCtx.origin !== origin) return null;
    return safe(async () => {
        const results = await api.scripting.executeScript({
            target: { tabId: state.tabCtx.id },
            func: snapshotProbe,
            args: [origin]
        });
        return mergeFrameResults(results);
    }, null);
}

/**
 * Whether the extension already holds host access for origins.
 * @param {string[]} origins - Exact origins.
 * @returns {Promise<boolean>} True when all are granted.
 */
async function hasHostAccess(origins) {
    if (origins.length === 0) return false;
    return safe(() => api.permissions.contains({ origins: origins.map(o => `${o}/*`) }), false);
}

/**
 * Reads and classifies the cookies of an origin. Only redacted metadata is
 * returned (cookie-engine never copies values).
 * @param {string} origin - Exact origin.
 * @returns {Promise<Object>} Classification {hostOnly, partitioned, shared, ignored}.
 */
async function readCookies(origin) {
    const storeId = storeFor(origin);
    const base = storeId ? { storeId } : {};
    const queries = [{ url: `${origin}/`, partitionKey: {}, ...base }];
    for (const domain of candidateDomains(originHost(origin))) {
        queries.push({ domain, partitionKey: {}, ...base });
    }
    const found = [];
    for (const query of queries) {
        const list = await api.cookies.getAll(query);
        if (Array.isArray(list)) found.push(...list);
    }
    return classifyCookies(found, origin);
}

/**
 * Classified cookies, but only when host access is already granted.
 * @param {string} origin - Origin.
 * @returns {Promise<Object|null>} Classification or null.
 */
async function readCookiesIfGranted(origin) {
    if (!(await hasHostAccess([origin]))) return null;
    return safe(() => readCookies(origin), null);
}

/** Takes the counts snapshot of the primary origin and refreshes the UI. */
async function loadCounts() {
    const token = ++state.countToken;
    const origin = state.origin;
    state.probe = null;
    state.cookies = null;
    syncUi();
    if (!origin) return;
    const [probe, cookies] = await Promise.all([takeProbe(origin), readCookiesIfGranted(origin)]);
    if (token !== state.countToken) return;
    state.probe = probe;
    state.cookies = cookies;
    syncUi();
}

/**
 * Number of cookies that apply to the origin (host-only + partitioned + shared).
 * @returns {number|null} Count, or null when not measurable.
 */
function cookieTotal() {
    const c = state.cookies;
    return c ? c.hostOnly.length + c.partitioned.length + c.shared.length : null;
}

/**
 * Count shown for a data type.
 * @param {string} type - Data type key.
 * @returns {number|null} Count or null.
 */
function countFor(type) {
    if (type === 'cookies') return cookieTotal();
    if (type === 'cache') return null;
    const value = state.probe ? state.probe[type] : null;
    return typeof value === 'number' ? value : null;
}

/**
 * Cookie numbers for the summary and the confirmation.
 * @returns {{removed: number, keptShared: number, total: number}|null} Numbers, or null when unknown.
 */
function cookieStats() {
    const c = state.cookies;
    if (!c) return null;
    const total = c.hostOnly.length + c.partitioned.length + c.shared.length;
    if (state.cookieMode === 'domainWide') return { removed: total, keptShared: 0, total };
    const keep = new Set(state.cookieSelection.keepNames);
    const include = new Set(state.cookieSelection.includeShared);
    const candidates = [...c.hostOnly, ...c.partitioned, ...c.shared.filter(m => include.has(m.id))];
    const removed = candidates.filter(m => !keep.has(m.name)).length;
    const sharedIncluded = c.shared.filter(m => include.has(m.id)).length;
    return { removed, keptShared: c.shared.length - sharedIncluded, total };
}

/**
 * Domain of the shared cookies (with a leading dot), if any.
 * @returns {string} Domain or ''.
 */
function sharedDomain() {
    const first = state.cookies && state.cookies.shared[0];
    if (!first) return '';
    return first.domain.startsWith('.') ? first.domain : `.${first.domain}`;
}

// ---------------------------------------------------------------------------
// Main screen rendering
// ---------------------------------------------------------------------------

/**
 * Whether cookies would be removed beyond the exact host.
 * @returns {boolean} True for domain-wide mode or selected shared cookies.
 */
function cookiesWide() {
    if (!effectiveTypes().includes('cookies')) return false;
    return state.cookieMode === 'domainWide' || state.cookieSelection.includeShared.length > 0;
}

/** Syncs every part of the main screen with the state. */
function syncUi() {
    const checkboxes = Array.from(document.querySelectorAll('.checkbox-grid input[type="checkbox"]'));
    for (const cb of checkboxes) {
        const reason = disabledReason(cb.value);
        const row = cb.closest('.check-row');
        cb.disabled = Boolean(reason);
        cb.checked = state.selected.has(cb.value) && !reason;
        row.classList.toggle('is-disabled', Boolean(reason));
        const tip = t(TYPE_TIP_KEYS[cb.value]);
        row.title = reason ? `${reason}\n${tip}` : tip;
        const countEl = row.querySelector('[data-count-for]');
        const count = countFor(cb.value);
        countEl.textContent = count === null ? '–' : String(count);
    }

    const enabled = checkboxes.filter(cb => !cb.disabled);
    const checkedCount = checkboxes.filter(cb => cb.checked).length;
    const allChecked = enabled.length > 0 && enabled.every(cb => cb.checked);
    $('selectAll').textContent = allChecked ? t('deselectAll') : t('selectAll');
    $('selectedCount').textContent = t('selectedCount', [String(checkedCount), String(checkboxes.length)]);

    const wide = cookiesWide();
    const scopeNote = $('scopeNote');
    scopeNote.dataset.scope = wide ? 'wide' : 'exact';
    $('scopeNoteText').textContent = t(wide ? 'scopeWide' : 'scopeExact');
    document.querySelector('[data-row="cookies"] .scope-tag').hidden =
        !(state.cookieMode === 'domainWide' || state.cookieSelection.includeShared.length > 0);

    renderCookieSummary();
    renderPresets();
    renderOrigins();
    renderFooter();
}

/** Renders the blue cookie summary line. */
function renderCookieSummary() {
    const box = $('cookieSummary');
    const text = $('cookieSummaryText');
    const active = effectiveTypes().includes('cookies');
    // The line stays visible so "Manage" is always reachable: with a time range, exact cookies cannot
    // be selected and the scope can only be changed here.
    box.hidden = false;
    if (!active) {
        const blockedByRange = state.selected.has('cookies') && disabledReason('cookies') !== '';
        text.textContent = t(blockedByRange ? 'cookieSummaryTimeLimited' : 'cookieSummaryOff');
        return;
    }
    const stats = cookieStats();
    if (state.cookieMode === 'domainWide') {
        text.textContent = t('cookieSummaryWide');
    } else if (stats) {
        fillTemplate(text, 'cookieSummaryExact', [
            h('strong', { text: t('cookieSummaryRemoved', [String(stats.removed)]) }),
            t('cookieSummaryKept', [String(stats.keptShared)])
        ]);
    } else {
        text.textContent = t('cookieSummaryUnknown');
    }
}

/** Renders the origin field helpers: preview, error, chips, warning, buttons. */
function renderOrigins() {
    const raw = $('originInput').value;
    const preview = /\*|%2a/i.test(raw) ? { show: false, valid: false, origin: '', error: checkTarget(raw).error, notes: [] }
        : normalizationPreview(raw);
    const error = $('originError');
    error.hidden = !preview.error;
    error.textContent = preview.error;
    $('originInput').setAttribute('aria-invalid', preview.error ? 'true' : 'false');
    $('normalizedPreview').hidden = !(preview.show && preview.valid);
    $('normalizedOrigin').textContent = preview.valid ? preview.origin : '';

    const chips = $('extraOrigins');
    chips.hidden = state.extraOrigins.length === 0;
    chips.replaceChildren(...state.extraOrigins.map(origin => {
        const remove = h('button', {
            class: 'chip-remove',
            text: '×',
            attrs: { type: 'button', 'aria-label': t('removeOriginAria', [origin]), title: t('removeOriginAria', [origin]) }
        });
        remove.addEventListener('click', () => {
            state.extraOrigins = state.extraOrigins.filter(o => o !== origin);
            syncUi();
            $('addOriginBtn').focus();
        });
        return h('li', { class: 'chip' }, [h('span', { class: 'mono', text: origin }), remove]);
    }));

    const host = idpHost();
    const warning = $('idpWarning');
    warning.hidden = !host;
    warning.textContent = host ? t('idpWarning', [host]) : '';

    const full = allOrigins().length >= MAX_ORIGINS;
    const add = $('addOriginBtn');
    add.disabled = full && $('addOriginRow').hidden;
    add.title = full ? t('extraOriginsLimit', [String(MAX_ORIGINS)]) : t('addOriginTitle');
}

/** Renders the footer: range, after-action, clear button, shortcut. */
function renderFooter() {
    const rangeSelect = $('rangeSelect');
    const sessionOption = rangeSelect.querySelector('option[value="session"]');
    sessionOption.disabled = !state.sessionStart;
    if (state.sessionStart) {
        const time = new Date(state.sessionStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        sessionOption.textContent = t('rangeSessionAt', [time]);
    } else {
        sessionOption.textContent = t('rangeSession');
        if (rangeSelect.value === 'session') rangeSelect.value = 'all';
    }
    const note = $('rangeNote');
    const limited = rangeSince() > 0;
    note.hidden = !limited;
    note.textContent = limited ? t('rangeNote') : '';

    const afterSelect = $('afterSelect');
    const enabled = afterEnabled();
    afterSelect.disabled = !enabled;
    afterSelect.value = effectiveAfter();
    const chosen = afterSelect.options[afterSelect.selectedIndex];
    afterSelect.title = enabled ? (chosen ? chosen.textContent : '') : t('onlyActiveTabTitle');
    afterSelect.classList.toggle('is-disabled', !enabled);

    $('clearBtn').disabled = state.busy || !state.origin;
    $('fillCurrent').disabled = !state.tabCtx;
    $('fillCurrent').title = state.tabCtx ? t('useCurrentTabTitle') : t('noActiveTabTitle');
    const label = $('clearBtn').querySelector('.btn-text');
    if (!state.busy) {
        const count = allOrigins().length;
        label.textContent = count > 1 ? t('clearOriginsBtn', [String(count)]) : t('clearOriginBtn');
    }
}

// ---------------------------------------------------------------------------
// Origin handling
// ---------------------------------------------------------------------------

/** Reads the input and updates the primary origin; reloads counts on change. */
function onOriginInput() {
    invalidateConfirm();
    const result = checkTarget($('originInput').value);
    const next = result.valid ? result.origin : '';
    const changed = next !== state.origin;
    state.origin = next;
    if (changed) {
        state.cookieSelection = { includeShared: [], keepNames: state.cookieSelection.keepNames };
        state.extraOrigins = state.extraOrigins.filter(o => o !== next);
        loadCounts();
    } else {
        syncUi();
    }
}

/**
 * Adds an extra exact origin.
 * @param {string} raw - Text typed by the user.
 * @returns {boolean} True when added.
 */
function addExtraOrigin(raw) {
    const result = checkTarget(raw);
    if (!result.valid) {
        showStatus(result.error, 'error');
        return false;
    }
    if (allOrigins().includes(result.origin)) {
        showStatus(t('extraOriginDuplicate'), 'info');
        return false;
    }
    if (!state.origin) {
        showStatus(t('extraOriginNeedsPrimary'), 'error');
        return false;
    }
    if (allOrigins().length >= MAX_ORIGINS) {
        showStatus(t('extraOriginsLimit', [String(MAX_ORIGINS)]), 'error');
        return false;
    }
    state.extraOrigins.push(result.origin);
    syncUi();
    return true;
}

/**
 * Opens or closes the inline "add origin" row.
 * @param {boolean} open - Whether to show it.
 * @returns {void}
 */
function toggleAddRow(open) {
    $('addOriginRow').hidden = !open;
    $('addOriginBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) $('extraOriginInput').focus();
    else $('extraOriginInput').value = '';
    renderOrigins();
}

// ---------------------------------------------------------------------------
// Plan, confirmation, execution
// ---------------------------------------------------------------------------

/**
 * Builds and validates the plan from the form.
 * @returns {{plan: Object}|null} The plan, or null after showing an error.
 */
function buildPlan() {
    const origins = allOrigins();
    if (origins.length === 0) {
        showStatus(checkTarget($('originInput').value).error || t('errorEnterOrigin'), 'error');
        return null;
    }
    const dataTypes = effectiveTypes();
    if (dataTypes.length === 0) {
        showStatus(t('errorSelectDataType'), 'error');
        return null;
    }
    const tab = tabInPlan();
    const created = createPlan({
        source: 'popup',
        origins,
        dataTypes,
        cookieMode: state.cookieMode,
        cookieSelection: {
            includeShared: [...state.cookieSelection.includeShared],
            keepNames: [...state.cookieSelection.keepNames]
        },
        since: rangeSince(),
        after: tab ? state.afterWanted : 'none',
        startPath: state.startPath,
        presetId: presetMatches() ? state.presetId : 'custom',
        tab
    });
    if (!created.ok) {
        showStatus(t('errorPrefix', [created.error]), 'error');
        return null;
    }
    return { plan: created.plan };
}

/** Handles a click on the clear button. */
async function onClear() {
    clearStatus();
    const built = buildPlan();
    if (!built) return;
    await proceedWithPlan(built.plan);
}

/**
 * Runs the plan directly, or opens the confirmation first.
 * @param {Object} plan - Plan that passed createPlan().
 * @returns {Promise<void>}
 */
async function proceedWithPlan(plan) {
    const level = confirmationLevel(plan);
    if (level === 'none') {
        await runCleanup(plan);
        return;
    }
    if (plan.cookieMode === 'exact' && plan.dataTypes.includes('cookies') && !(await hasHostAccess(plan.origins))) {
        // Exact cookies need host access, which can only be requested from a click on screen 2.
        await openCookies({ needAccess: true });
        return;
    }
    openConfirm(plan);
}

/**
 * Extras for describePlan: counts (single origin only) and kept shared cookies.
 * @param {Object} plan - Plan.
 * @returns {Object} Extras.
 */
function describeExtras(plan) {
    const extras = {};
    if (plan.origins.length === 1) {
        const counts = {};
        for (const type of plan.dataTypes) {
            const count = countFor(type);
            if (count !== null) counts[type] = count;
        }
        const stats = cookieStats();
        if (stats && plan.dataTypes.includes('cookies')) counts.cookies = stats.removed;
        extras.counts = counts;
        if (state.cookies && state.cookies.shared.length > 0) {
            extras.sharedCookies = { count: stats ? stats.keptShared : state.cookies.shared.length, domain: sharedDomain() };
        }
    }
    return extras;
}

/**
 * Text of the after-action phrase on the confirm screen.
 * @param {string} after - Plan after-action.
 * @returns {string} Phrase, or ''.
 */
function afterPhrase(after) {
    const keys = { reload: 'confirmThenReload', hard: 'confirmThenHard', start: 'confirmThenStart' };
    return keys[after] ? t(keys[after]) : '';
}

/**
 * Label of the time range for the confirm screen.
 * @returns {string} Label of the selected option.
 */
function rangeLabel() {
    const select = $('rangeSelect');
    const option = select.options[select.selectedIndex];
    return option ? option.textContent : '';
}

/**
 * Shows the confirmation screen. Everything shown comes from describePlan().
 * @param {Object} plan - Plan that passed createPlan().
 * @returns {void}
 */
function openConfirm(plan) {
    const description = describePlan(plan, describeExtras(plan));
    state.pending = { plan, description };

    const wide = description.scope === 'wide';
    const badge = $('confirmScope');
    badge.dataset.scope = wide ? 'wide' : 'exact';
    badge.textContent = t(wide ? 'confirmScopeWide' : 'confirmScopeExact');
    $('confirmWideNote').hidden = !wide;

    const originBox = $('confirmOrigin');
    originBox.replaceChildren(...description.origins.map(origin => {
        const applicable = description.remove.length -
            description.notApplicable.filter(n => n.origin === origin).length;
        const row = h('div', { class: 'origin-row' }, [h('span', { class: 'mono', text: origin })]);
        if (description.origins.length > 1) {
            row.append(h('span', { class: 'origin-count mono', text: t('confirmTypesCount', [String(applicable)]) }));
        }
        return row;
    }));

    const presetKnown = getPreset(description.preset, state.customPresets);
    const presetText = presetKnown ? presetName(presetKnown) : t('presetCustom');
    const then = afterPhrase(description.after);
    const line = $('confirmPreset');
    line.textContent = then ? t('confirmPresetThen', [presetText, then]) : t('confirmPresetOnly', [presetText]);
    if (description.since > 0) line.textContent += ` · ${t('confirmRange', [rangeLabel()])}`;

    $('confirmTypes').replaceChildren(...description.remove.map(item => {
        let label = t(item.labelKey);
        if (item.type === 'cookies') label = t(wide ? 'confirmCookiesWide' : 'confirmCookiesExact');
        let count = '';
        if (typeof item.count === 'number') {
            count = UNIT_KEYS[item.type] ? t(UNIT_KEYS[item.type], [String(item.count)]) : String(item.count);
        }
        return h('li', { class: 'confirm-row', attrs: { 'data-type': item.type } }, [
            h('span', { text: label }),
            h('span', { class: 'mono confirm-count', text: count })
        ]);
    }));

    const keepItems = [];
    for (const keep of description.keep) {
        if (keep.kind === 'sharedCookies') {
            const li = h('li');
            fillTemplate(li, 'confirmKeepShared', [String(keep.count), h('span', { class: 'mono', text: keep.domain })]);
            keepItems.push(li);
        } else if (keep.kind === 'otherOrigins') {
            keepItems.push(h('li', { text: t('confirmKeepOtherOrigins') }));
        } else if (keep.kind === 'browserData') {
            keepItems.push(h('li', { text: t('confirmUntouchedBrowser') }));
        }
    }
    for (const item of description.notApplicable) {
        keepItems.push(h('li', { text: t('confirmKeepNotActiveTab', [t(DATA_TYPES.find(d => d.key === item.type).labelKey), item.origin]) }));
    }
    $('confirmKeep').replaceChildren(...keepItems);

    const danger = confirmationLevel(plan) === 'danger';
    const button = $('confirmBtn');
    button.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    button.querySelector('.btn-text').textContent = t(danger ? 'confirmCleanupBtn' : 'confirmNowBtn');
    button.disabled = false;

    showScreen('confirm');
    button.focus();
}

/**
 * Any change of an input closes a pending confirmation: the plan is rebuilt on the next click.
 * @returns {void}
 */
function invalidateConfirm() {
    if (state.pending && !state.busy) closeConfirm();
}

/** Closes the confirmation and returns to the main screen. */
function closeConfirm({ announce = false } = {}) {
    state.pending = null;
    showScreen('main');
    if (announce) showStatus(t('cleanupCancelled'), 'info');
    $('clearBtn').focus();
}

/**
 * Chrome version for the evidence report.
 * @returns {Promise<string>} Version string.
 */
async function chromeVersion() {
    const ua = navigator.userAgent || '';
    const fallback = (/Chrome\/([\d.]+)/.exec(ua) || [])[1] || 'unknown';
    return safe(async () => {
        const data = await navigator.userAgentData.getHighEntropyValues(['fullVersionList']);
        const entry = (data.fullVersionList || []).find(b => /Chrom/.test(b.brand) && !/Not/.test(b.brand));
        return entry ? entry.version : fallback;
    }, fallback);
}

/**
 * Builds a report snapshot from a probe and a cookie count.
 * @param {Object|null} probe - Probe result.
 * @param {number|null} cookies - Cookie count.
 * @returns {Object|null} Snapshot, or null when nothing was measured.
 */
function toSnapshot(probe, cookies) {
    if (!probe && cookies === null) return null;
    const pick = key => (probe && typeof probe[key] === 'number' ? probe[key] : null);
    return {
        cookies,
        sessionStorage: pick('sessionStorage'),
        localStorage: pick('localStorage'),
        indexedDB: pick('indexedDB'),
        fileSystems: pick('fileSystems'),
        cache: null,
        cacheStorage: pick('cacheStorage'),
        serviceWorkers: pick('serviceWorkers'),
        usage: pick('usage'),
        quota: pick('quota'),
        persisted: probe && typeof probe.persisted === 'boolean' ? probe.persisted : null
    };
}

/**
 * Measures the primary origin (counts and cookies) for the evidence report.
 * @param {string} origin - Origin.
 * @returns {Promise<Object|null>} Snapshot.
 */
async function measure(origin) {
    const probe = await takeProbe(origin);
    const classified = await readCookiesIfGranted(origin);
    const total = classified ? classified.hostOnly.length + classified.partitioned.length + classified.shared.length : null;
    return toSnapshot(probe, total);
}

/**
 * Sets the busy state of the buttons.
 * @param {boolean} busy - Whether a cleanup is running.
 * @returns {void}
 */
function setBusy(busy) {
    state.busy = busy;
    const label = $('clearBtn').querySelector('.btn-text');
    if (busy) label.textContent = t('clearingStatus');
    $('confirmBtn').disabled = busy;
    $('cancelBtn').disabled = busy;
    $('clearBtn').disabled = busy || !state.origin;
    if (busy) $('confirmBtn').querySelector('.btn-text').textContent = t('clearingStatus');
}

/**
 * Runs a validated plan: snapshot, deletion, snapshot, after-action, report.
 * @param {Object} plan - Plan that passed createPlan().
 * @returns {Promise<void>}
 */
async function runCleanup(plan) {
    const description = describePlan(plan, describeExtras(plan));
    const origin = plan.origins[0];
    setBusy(true);
    try {
        const before = await measure(origin);
        const result = await executePlan(plan, { deferAfter: true });
        const after = await measure(origin);

        if (plan.presetId !== 'custom') {
            await safe(() => settings.setLastPreset(plan.presetId, origin), null);
        }
        await safe(() => settings.addRecentOrigin(origin), null);

        const afterResult = plan.after === 'none' ? { action: 'none', ok: true } : await runAfterAction(plan);
        const report = buildReport({
            plan,
            description,
            before: before ? { [origin]: before } : {},
            after: after ? { [origin]: after } : {},
            result: { ...result, after: afterResult },
            env: {
                extensionVersion: api.runtime.getManifest().version,
                chromeVersion: await chromeVersion(),
                userAgent: navigator.userAgent,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                now: Date.now()
            }
        });
        const domain = sharedDomain();
        for (const entry of report.perOrigin || []) {
            if (domain && entry.origin === origin && entry.cookies) entry.cookies.domain = domain;
        }
        await safe(() => settings.addHistoryEntry(historyEntry(report)), null);
        showResult(report, plan);
    } catch (error) {
        const message = error instanceof ScopeGuardError && error.errors.length > 0
            ? error.errors[0].message
            : String(error && error.message ? error.message : error);
        state.pending = null;
        showScreen('main');
        showStatus(t('errorPrefix', [message]), 'error');
    } finally {
        setBusy(false);
        syncUi();
    }
}

/**
 * Shows screen 4.
 * @param {Object} report - Report from buildReport().
 * @param {Object} plan - Executed plan.
 * @returns {void}
 */
function showResult(report, plan) {
    state.pending = null;
    renderResult($('screenResult'), {
        report,
        afterAction: plan.after,
        getMessage: t,
        onDone: () => {
            showScreen('main');
            clearStatus();
            loadCounts();
            $('clearBtn').focus();
        }
    });
    showScreen('result');
    const done = $('resultDoneBtn');
    if (done) done.focus();
}

// ---------------------------------------------------------------------------
// Screen 2: exact cookies
// ---------------------------------------------------------------------------

/**
 * Text of the cookie attributes shown at the right of a row.
 * @param {Object} meta - Redacted cookie metadata.
 * @returns {string} e.g. "HttpOnly · Secure · Lax".
 */
function attributesText(meta) {
    const parts = [];
    if (meta.httpOnly) parts.push('HttpOnly');
    if (meta.secure) parts.push('Secure');
    const sameSite = { lax: 'Lax', strict: 'Strict', no_restriction: 'None' }[meta.sameSite];
    if (sameSite) parts.push(sameSite);
    return parts.join(' · ');
}

/**
 * Opens screen 2 for the primary origin.
 * @param {{needAccess?: boolean}} [options] - Set when the user was sent here to grant access.
 * @returns {Promise<void>}
 */
async function openCookies({ needAccess = false } = {}) {
    if (!state.origin) {
        showStatus(t('errorEnterOrigin'), 'error');
        return;
    }
    const origin = state.origin;
    state.view = {
        origin,
        mode: state.cookieMode,
        granted: null,
        denied: false,
        classification: null,
        checked: new Set(),
        sharedChecked: new Set(),
        needAccess
    };
    $('cookieOrigin').textContent = origin;
    showScreen('cookies');
    $('cookieBackBtn').focus();
    renderCookieView();
    await loadCookieView();
}

/** Loads cookies for screen 2 when access is already granted. */
async function loadCookieView() {
    const view = state.view;
    const granted = await hasHostAccess(allOrigins());
    if (state.view !== view) return;
    view.granted = granted;
    if (granted) {
        const classification = await safe(() => readCookies(view.origin), null);
        if (state.view !== view) return;
        view.classification = classification;
        if (classification) {
            const keep = new Set(state.cookieSelection.keepNames);
            view.checked = new Set([...classification.hostOnly, ...classification.partitioned]
                .filter(m => !keep.has(m.name)).map(m => m.id));
            const known = new Set(classification.shared.map(m => m.id));
            view.sharedChecked = new Set(state.cookieSelection.includeShared.filter(id => known.has(id)));
        }
    }
    renderCookieView();
}

/**
 * One checkbox row of a cookie group.
 * @param {Object} meta - Redacted cookie metadata.
 * @param {{checked: boolean, disabled?: boolean, onChange: Function}} opts - Row options.
 * @returns {HTMLElement} Row.
 */
function cookieRow(meta, { checked, disabled = false, onChange }) {
    const input = h('input', { attrs: { type: 'checkbox', 'data-cookie-id': meta.id } });
    input.checked = checked;
    input.disabled = disabled;
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'cookie-row' }, [
        input,
        h('span', { class: 'cookie-name mono', text: meta.name }),
        h('span', { class: 'cookie-attrs', text: attributesText(meta) })
    ]);
}

/** Renders screen 2 from the view state. */
function renderCookieView() {
    const view = state.view;
    if (!view) return;
    const wide = view.mode === 'domainWide';
    $('cookieModeExact').setAttribute('aria-pressed', wide ? 'false' : 'true');
    $('cookieModeWide').setAttribute('aria-pressed', wide ? 'true' : 'false');

    const needsGrant = view.granted === false;
    const notice = $('cookiePermissionNotice');
    notice.hidden = !needsGrant || view.denied;
    $('cookiePermissionText').textContent = t(wide ? 'cookiePermissionWide' : 'cookiePermissionExact');
    const denied = $('cookieDenied');
    denied.hidden = !(needsGrant && view.denied);
    denied.textContent = t('cookieDenied');
    const status = $('cookieStatus');
    status.hidden = view.granted !== null || false;
    status.textContent = view.granted === null ? t('cookieLoading') : '';

    const c = view.classification;
    const show = Boolean(c);
    const groups = [
        ['cookieGroupHostOnly', 'cookieListHostOnly', c ? c.hostOnly : []],
        ['cookieGroupPartitioned', 'cookieListPartitioned', c ? c.partitioned : []],
        ['cookieGroupShared', 'cookieListShared', c ? c.shared : []]
    ];
    for (const [groupId, listId, items] of groups) {
        $(groupId).hidden = !show || items.length === 0;
        const isShared = listId === 'cookieListShared';
        $(listId).replaceChildren(...items.map(meta => cookieRow(meta, {
            checked: isShared ? (wide || view.sharedChecked.has(meta.id)) : view.checked.has(meta.id),
            disabled: isShared && wide,
            onChange: value => {
                const set = isShared ? view.sharedChecked : view.checked;
                if (value) set.add(meta.id);
                else set.delete(meta.id);
                renderCookieCounts();
            }
        })));
    }
    if (c) {
        $('cookieHostOnlyHost').textContent = originHost(view.origin);
        const sites = [...new Set(c.partitioned.map(m => m.partitionKey.topLevelSite.replace(/^[a-z]+:\/\//, '')))];
        $('cookiePartitionedSite').textContent = sites.length ? t('cookieTopLevel', [sites.join(', ')]) : '';
        const domains = [...new Set(c.shared.map(m => (m.domain.startsWith('.') ? m.domain : `.${m.domain}`)))];
        $('cookieSharedDomain').textContent = domains.join(', ');
    }
    if (c && c.hostOnly.length + c.partitioned.length + c.shared.length === 0) {
        status.hidden = false;
        status.textContent = t('cookieNone');
    }

    // After a refusal, Domain-wide is the only scope on offer: there is no silent fallback to it.
    const exactBlocked = needsGrant && view.denied;
    $('cookieModeExact').disabled = exactBlocked;
    $('cookieModeExact').title = exactBlocked ? t('cookieDenied') : '';
    const footer = $('cookieFooterNote');
    footer.textContent = t(wide ? 'cookieFooterWide' : 'cookieFooterExact');
    footer.dataset.scope = wide ? 'wide' : 'exact';
    renderCookieCounts();
}

/** Updates the "X of Y removed" summary of screen 2. */
function renderCookieCounts() {
    const view = state.view;
    const el = $('cookieCountSummary');
    const c = view && view.classification;
    if (!c) {
        el.textContent = '';
        return;
    }
    const total = c.hostOnly.length + c.partitioned.length + c.shared.length;
    const wide = view.mode === 'domainWide';
    const removed = view.checked.size + (wide ? c.shared.length : view.sharedChecked.size);
    el.textContent = t('cookieRemovedOf', [String(removed), String(total)]);
}

/** Saves the selection of screen 2 and returns to the main screen. */
function saveCookieView() {
    const view = state.view;
    if (!view) return;
    state.cookieMode = view.mode;
    const c = view.classification;
    if (c) {
        const listed = [...c.hostOnly, ...c.partitioned];
        const listedNames = new Set(listed.map(m => m.name));
        const kept = state.cookieSelection.keepNames.filter(n => !listedNames.has(n));
        for (const meta of listed) {
            if (!view.checked.has(meta.id) && !kept.includes(meta.name)) kept.push(meta.name);
        }
        state.cookieSelection = {
            keepNames: kept,
            includeShared: view.mode === 'domainWide' ? [] : [...view.sharedChecked]
        };
        state.cookies = c;
    }
    state.view = null;
    showScreen('main');
    syncUi();
    $('cookieManageBtn').focus();
}

/** Click on the grant button: request access synchronously (user gesture). */
function onGrantClick() {
    const view = state.view;
    if (!view) return;
    const origins = allOrigins();
    // permissions.request must run inside the click handler: no await before it.
    const request = api.permissions.request({ origins: origins.map(o => `${o}/*`) });
    Promise.resolve(request).then(async granted => {
        if (state.view !== view) return;
        if (granted) {
            for (const origin of origins) {
                await safe(() => settings.recordPermissionGrant(origin, 'exactCookies'), null);
            }
            view.denied = false;
            view.granted = true;
            await loadCookieView();
        } else {
            view.denied = true;
            renderCookieView();
        }
    }).catch(() => {
        view.denied = true;
        renderCookieView();
    });
}

// ---------------------------------------------------------------------------
// Presets bar keyboard handling
// ---------------------------------------------------------------------------

/**
 * Arrow-key navigation for the preset segmented control (roving tabindex).
 * @param {KeyboardEvent} event - Keydown event.
 * @returns {void}
 */
function onPresetKeydown(event) {
    const buttons = Array.from(document.querySelectorAll('#presetBar [data-preset]'));
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    if (next < 0) return;
    event.preventDefault();
    buttons.forEach((b, i) => { b.tabIndex = i === next ? 0 : -1; });
    buttons[next].focus();
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/** Shows the active shortcut of "clean last preset" on the clear button. */
async function showShortcut() {
    const commands = await safe(() => api.commands.getAll(), []);
    const command = (commands || []).find(c => c.name === 'clean-last-preset');
    const tag = document.querySelector('#clearBtn .shortcut-tag');
    const shortcut = command && command.shortcut ? command.shortcut.replace(/\s+/g, '') : '';
    tag.textContent = shortcut;
    tag.hidden = !shortcut;
}

/**
 * Enters the main screen for an origin.
 * @param {{origin: string, tab: Object|null, tabCtx: Object|null}} target - Target and tab.
 * @returns {Promise<void>}
 */
async function enterMain({ origin, tab, tabCtx }) {
    state.tab = tab;
    state.tabCtx = tabCtx;
    state.origin = origin;
    state.extraOrigins = [];
    $('originInput').value = origin;
    const initial = await resolveInitialPreset(origin);
    showScreen('main');
    applyPreset(initial);
    onOriginInput();
    loadCounts();

    const pending = tabCtx && origin ? await safe(() => settings.takePendingConfirmation(origin), null) : null;
    if (pending) {
        const preset = getPreset(pending.presetId, state.customPresets);
        if (preset) {
            applyPreset(preset.id);
            const built = buildPlan();
            // The user must still click the confirm button; nothing runs here.
            if (built && confirmationLevel(built.plan) !== 'none') openConfirm(built.plan);
        }
    }
}

/**
 * Shows screen 5 for a page the extension cannot clean.
 * @param {Object|null} tab - The active tab.
 * @returns {Promise<void>}
 */
async function showUnsupported(tab) {
    const recentOrigins = await safe(() => settings.getRecentOrigins(), []);
    renderUnsupported($('screenUnsupported'), {
        tabUrl: tab && tab.url ? tab.url : '',
        recentOrigins,
        now: Date.now(),
        getMessage: t,
        onContinue: origin => {
            if (checkTarget(origin).valid) enterMain({ origin, tab: null, tabCtx: null });
        }
    });
    showScreen('unsupported');
}

/** Binds all event handlers once. */
function bindEvents() {
    $('optionsBtn').addEventListener('click', () => {
        api.runtime.openOptionsPage();
    });

    $('originInput').addEventListener('input', onOriginInput);
    $('originInput').addEventListener('keydown', event => {
        if (event.key === 'Enter' && !$('clearBtn').disabled) {
            event.preventDefault();
            onClear();
        }
    });
    $('fillCurrent').addEventListener('click', () => {
        if (!state.tabCtx) return;
        $('originInput').value = state.tabCtx.origin;
        onOriginInput();
    });

    $('addOriginBtn').addEventListener('click', () => toggleAddRow($('addOriginRow').hidden));
    $('extraOriginAddBtn').addEventListener('click', () => {
        if (addExtraOrigin($('extraOriginInput').value)) {
            $('extraOriginInput').value = '';
            $('extraOriginInput').focus();
        }
    });
    $('extraOriginInput').addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            $('extraOriginAddBtn').click();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            toggleAddRow(false);
            $('addOriginBtn').focus();
        }
    });

    $('presetBar').addEventListener('click', event => {
        const button = event.target.closest('[data-preset]');
        if (button) {
            invalidateConfirm();
            applyPreset(button.dataset.preset, { announce: true });
        }
    });
    $('presetBar').addEventListener('keydown', onPresetKeydown);
    $('presetMore').addEventListener('change', event => {
        if (event.target.value) {
            invalidateConfirm();
            applyPreset(event.target.value, { announce: true });
        }
    });

    for (const cb of document.querySelectorAll('.checkbox-grid input[type="checkbox"]')) {
        cb.addEventListener('change', () => {
            invalidateConfirm();
            if (cb.checked) state.selected.add(cb.value);
            else state.selected.delete(cb.value);
            syncUi();
        });
    }
    $('selectAll').addEventListener('click', () => {
        invalidateConfirm();
        const enabled = DATA_TYPE_KEYS.filter(k => !disabledReason(k));
        const allChecked = enabled.every(k => state.selected.has(k));
        for (const key of enabled) {
            if (allChecked) state.selected.delete(key);
            else state.selected.add(key);
        }
        syncUi();
    });

    $('rangeSelect').addEventListener('change', () => {
        invalidateConfirm();
        syncUi();
    });
    $('afterSelect').addEventListener('change', async event => {
        invalidateConfirm();
        const matched = presetMatchesIgnoringAfter();
        state.afterWanted = event.target.value;
        if (matched) await saveAfter(state.presetId, state.afterWanted);
        syncUi();
    });

    $('cookieManageBtn').addEventListener('click', () => openCookies());
    $('cookieBackBtn').addEventListener('click', () => {
        state.view = null;
        showScreen('main');
        $('cookieManageBtn').focus();
    });
    $('cookieModeExact').addEventListener('click', () => {
        if (!state.view) return;
        state.view.mode = 'exact';
        renderCookieView();
    });
    $('cookieModeWide').addEventListener('click', () => {
        if (!state.view) return;
        state.view.mode = 'domainWide';
        renderCookieView();
    });
    $('cookieGrantBtn').addEventListener('click', onGrantClick);
    $('cookieSaveBtn').addEventListener('click', saveCookieView);

    $('clearBtn').addEventListener('click', onClear);
    $('confirmBtn').addEventListener('click', () => {
        if (state.pending && !state.busy) runCleanup(state.pending.plan);
    });
    $('cancelBtn').addEventListener('click', () => closeConfirm({ announce: true }));
    $('confirmBackBtn').addEventListener('click', () => closeConfirm());
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.body.dataset.screen === 'confirm' && !state.busy) {
            event.preventDefault();
            closeConfirm({ announce: true });
        }
    });
}

/** Popup entry point. */
async function init() {
    localizeDocument();
    const versionTag = $('versionTag');
    versionTag.textContent = `v${api.runtime.getManifest().version}`;
    renderMoreSelect();
    bindEvents();

    const testMode = await safe(() => settings.getTestMode(), { enabled: false });
    $('testModeTag').hidden = !testMode.enabled;
    showShortcut();

    state.customPresets = await safe(() => settings.getCustomPresets(), []);
    renderMoreSelect();
    state.afterByPreset = await loadAfterMap();
    state.sessionStart = await safe(() => settings.getSessionStart(), null);

    const tab = await safe(() => getActiveTab(api), null);
    const tabCtx = await safe(() => tabContext(api, tab), null);
    if (!tabCtx) {
        await showUnsupported(tab);
        return;
    }
    await enterMain({ origin: tabCtx.origin, tab, tabCtx });
}

init().catch(error => {
    showStatus(t('errorPrefix', [String(error && error.message ? error.message : error)]), 'error');
});
