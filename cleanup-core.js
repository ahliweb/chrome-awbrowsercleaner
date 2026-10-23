/**
 * AW Browser Cleaner - Cleanup Core
 *
 * Single gate for every destructive operation. See docs/architecture.md.
 *
 * Every deletion targets an explicit list of exact origins. This is the only
 * module allowed to call chrome.browsingData.* or chrome.cookies.remove
 * (enforced by ESLint). The Chrome API object is injected into executePlan so
 * the module stays unit-testable without an extension runtime.
 */

import { validateOrigin } from './origin-utils.js';
import {
    classifyCookies,
    candidateDomains,
    cookieRemovalDetails,
    originHost
} from './cookie-engine.js';

/** Maximum number of explicit origins in one plan. */
export const MAX_ORIGINS = 10;

/**
 * Supported data types in UI order.
 * @type {ReadonlyArray<{key: string, group: string, api: string|null, labelKey: string, risk: string, countable: boolean}>}
 */
export const DATA_TYPES = Object.freeze([
    { key: 'cookies', group: 'session', api: 'cookies', labelKey: 'dataTypeCookies', risk: 'high', countable: true },
    { key: 'sessionStorage', group: 'session', api: null, labelKey: 'dataTypeSessionStorage', risk: 'normal', countable: true },
    { key: 'localStorage', group: 'storage', api: 'localStorage', labelKey: 'dataTypeLocalStorage', risk: 'normal', countable: true },
    { key: 'indexedDB', group: 'storage', api: 'indexedDB', labelKey: 'dataTypeIndexedDB', risk: 'normal', countable: true },
    { key: 'fileSystems', group: 'storage', api: 'fileSystems', labelKey: 'dataTypeFileSystems', risk: 'normal', countable: true },
    { key: 'cache', group: 'cache', api: 'cache', labelKey: 'dataTypeHttpCache', risk: 'normal', countable: false },
    { key: 'cacheStorage', group: 'cache', api: 'cacheStorage', labelKey: 'dataTypeCacheStorage', risk: 'normal', countable: true },
    { key: 'serviceWorkers', group: 'cache', api: 'serviceWorkers', labelKey: 'dataTypeServiceWorkers', risk: 'normal', countable: true }
].map(Object.freeze));

/** Data type keys in UI order. */
export const DATA_TYPE_KEYS = Object.freeze(DATA_TYPES.map(t => t.key));

/** Data types that cannot be limited to an origin and are never supported. */
export const FORBIDDEN_TYPES = Object.freeze([
    'history', 'downloads', 'formData', 'passwords', 'pluginData', 'appcache', 'webSQL'
]);

/** Allowed after-cleanup actions. */
export const AFTER_ACTIONS = Object.freeze(['none', 'reload', 'hard', 'start']);

/** Allowed plan sources. */
const SOURCES = Object.freeze(['popup', 'shortcut', 'contextMenu', 'testMode']);

/** Allowed cookie modes. */
const COOKIE_MODES = Object.freeze(['exact', 'domainWide']);

/**
 * A Scope Guard error entry.
 * @typedef {Object} GuardError
 * @property {string} code - Stable machine-readable code.
 * @property {string} message - Human-readable English message.
 */

/**
 * A cleanup plan. See docs/architecture.md for the full shape.
 * @typedef {Object} Plan
 * @property {number} version
 * @property {string} source
 * @property {Array<string>} origins
 * @property {Array<string>} dataTypes
 * @property {'exact'|'domainWide'} cookieMode
 * @property {{includeShared: Array<string>, keepNames: Array<string>}} cookieSelection
 * @property {number} since
 * @property {string} after
 * @property {string} startPath
 * @property {string} presetId
 * @property {{id: number, origin: string, storeId?: string}|null} tab
 */

/**
 * Error thrown when a plan or removal request violates the Scope Guard.
 * It is always thrown before any Chrome API is called.
 */
export class ScopeGuardError extends Error {
    /**
     * @param {Array<GuardError>|GuardError} errors - One or more guard errors.
     */
    constructor(errors) {
        const list = Array.isArray(errors) ? errors : [errors];
        super(`Scope Guard: ${list.map(e => `${e.code}: ${e.message}`).join('; ')}`);
        this.name = 'ScopeGuardError';
        /** @type {Array<GuardError>} */
        this.errors = list;
    }
}

/**
 * Whether a value is a non-null, non-array object.
 * @param {*} value - Value to test.
 * @returns {boolean} True for plain-object-like values.
 */
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Finds property names containing "exclude" anywhere in a value.
 * @param {*} value - Value to scan.
 * @param {number} [depth] - Remaining recursion depth.
 * @returns {boolean} True when such a key exists.
 */
function hasExcludeKey(value, depth = 4) {
    if (depth < 0 || value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(v => hasExcludeKey(v, depth - 1));
    return Object.keys(value).some(k => /exclude/i.test(k) || hasExcludeKey(value[k], depth - 1));
}

/**
 * Checks one origin string against the Scope Guard origin rules.
 * @param {*} origin - Candidate origin.
 * @returns {GuardError|null} The violation, or null when valid.
 */
function originViolation(origin) {
    if (typeof origin !== 'string') {
        return { code: 'ORIGIN_INVALID', message: 'Every origin must be a string.' };
    }
    if (origin.includes('*')) {
        return { code: 'ORIGIN_WILDCARD', message: `Wildcards are not allowed: ${origin}` };
    }
    if (origin.includes('@')) {
        return { code: 'ORIGIN_INVALID', message: `Origins must not contain credentials: ${origin}` };
    }
    const result = validateOrigin(origin);
    if (!result.valid || result.origin !== origin) {
        return { code: 'ORIGIN_INVALID', message: `Not an exact origin (scheme://host[:port]): ${origin}` };
    }
    return null;
}

/**
 * Builds a browsingData DataTypeSet from data type keys.
 *
 * sessionStorage is never included (it is cleared with chrome.scripting).
 * cookies is included only when `domainWide` is true, because
 * chrome.browsingData cookie removal affects the whole registrable domain.
 *
 * @param {Array<string>} keys - DATA_TYPES keys.
 * @param {{domainWide?: boolean}} [options] - Cookie scope.
 * @returns {Object<string, boolean>} DataTypeSet for chrome.browsingData.remove.
 * @throws {ScopeGuardError} For unknown or forbidden keys.
 */
export function buildDataTypeSet(keys, { domainWide = false } = {}) {
    if (!Array.isArray(keys)) {
        throw new ScopeGuardError({ code: 'DATATYPES_REQUIRED', message: 'dataTypes must be an array.' });
    }
    const set = {};
    for (const key of keys) {
        if (FORBIDDEN_TYPES.includes(key)) {
            throw new ScopeGuardError({ code: 'DATATYPE_FORBIDDEN', message: `Data type cannot be limited to an origin: ${key}` });
        }
        const def = DATA_TYPES.find(t => t.key === key);
        if (!def) {
            throw new ScopeGuardError({ code: 'DATATYPE_UNKNOWN', message: `Unknown data type: ${String(key)}` });
        }
        if (def.api === null) continue;
        if (key === 'cookies' && !domainWide) continue;
        set[def.api] = true;
    }
    return set;
}

/**
 * Builds chrome.browsingData RemovalOptions for explicit origins.
 * Always sets originTypes.unprotectedWeb and never sets excludeOrigins.
 *
 * @param {{origins: Array<string>, since?: number}} input - Exact origins and optional start time.
 * @returns {{origins: Array<string>, originTypes: {unprotectedWeb: true}, since?: number}} Removal options.
 * @throws {ScopeGuardError} For empty/invalid origins, exclusion keys or an invalid `since`.
 */
export function buildRemovalOptions(input) {
    if (!isObject(input)) {
        throw new ScopeGuardError({ code: 'ORIGINS_REQUIRED', message: 'Removal options are required.' });
    }
    if (hasExcludeKey(input)) {
        throw new ScopeGuardError({ code: 'EXCLUDE_FORBIDDEN', message: 'Exclusion options are forbidden.' });
    }
    const { origins, since = 0 } = input;
    if (!Array.isArray(origins) || origins.length === 0) {
        throw new ScopeGuardError({ code: 'ORIGINS_REQUIRED', message: 'At least one exact origin is required.' });
    }
    if (origins.length > MAX_ORIGINS) {
        throw new ScopeGuardError({ code: 'ORIGINS_TOO_MANY', message: `At most ${MAX_ORIGINS} origins are allowed.` });
    }
    for (const origin of origins) {
        const violation = originViolation(origin);
        if (violation) throw new ScopeGuardError(violation);
    }
    if (typeof since !== 'number' || !Number.isFinite(since) || since < 0) {
        throw new ScopeGuardError({ code: 'SINCE_INVALID', message: 'since must be 0 or an epoch timestamp.' });
    }
    const options = {
        origins: [...new Set(origins)],
        originTypes: { unprotectedWeb: true }
    };
    if (since > 0) options.since = since;
    return options;
}

/**
 * Validates a plan against the Scope Guard rules.
 *
 * @param {Plan} plan - The plan to validate.
 * @param {{now?: Function}} [options] - Clock injection for tests.
 * @returns {{ok: boolean, errors: Array<GuardError>}} Validation result.
 */
export function validatePlan(plan, { now = Date.now } = {}) {
    const errors = [];
    const add = (code, message) => errors.push({ code, message });

    if (!isObject(plan)) {
        return { ok: false, errors: [{ code: 'PLAN_INVALID', message: 'Plan must be an object.' }] };
    }
    if (hasExcludeKey(plan)) {
        add('EXCLUDE_FORBIDDEN', 'Exclusion options are forbidden: "everything except" mode is not supported.');
    }

    // Origins
    const { origins } = plan;
    if (!Array.isArray(origins) || origins.length === 0) {
        add('ORIGINS_REQUIRED', 'At least one exact origin is required.');
    } else {
        if (origins.length > MAX_ORIGINS) {
            add('ORIGINS_TOO_MANY', `At most ${MAX_ORIGINS} origins are allowed.`);
        }
        for (const origin of origins) {
            const violation = originViolation(origin);
            if (violation) add(violation.code, violation.message);
        }
    }

    // Data types
    const types = plan.dataTypes;
    if (!Array.isArray(types) || types.length === 0) {
        add('DATATYPES_REQUIRED', 'Select at least one data type.');
    } else {
        for (const type of types) {
            if (FORBIDDEN_TYPES.includes(type)) {
                add('DATATYPE_FORBIDDEN', `Data type cannot be limited to an origin: ${type}`);
            } else if (!DATA_TYPE_KEYS.includes(type)) {
                add('DATATYPE_UNKNOWN', `Unknown data type: ${String(type)}`);
            }
        }
    }
    const typeList = Array.isArray(types) ? types : [];

    // Source and cookie mode
    if (!SOURCES.includes(plan.source)) {
        add('SOURCE_INVALID', `Unknown plan source: ${String(plan.source)}`);
    }
    if (!COOKIE_MODES.includes(plan.cookieMode)) {
        add('COOKIE_MODE_INVALID', `Unknown cookie mode: ${String(plan.cookieMode)}`);
    }
    if (plan.cookieMode === 'domainWide' && plan.source === 'testMode') {
        add('DOMAIN_WIDE_IN_TEST_MODE', 'Domain-wide cookie removal is not allowed in Test Mode.');
    }
    const selection = plan.cookieSelection;
    if (selection !== undefined) {
        const okList = (list) => Array.isArray(list) && list.every(v => typeof v === 'string');
        if (!isObject(selection) || !okList(selection.includeShared) || !okList(selection.keepNames)) {
            add('COOKIE_SELECTION_INVALID', 'cookieSelection must contain string arrays includeShared and keepNames.');
        }
    }

    // Time range
    const since = plan.since;
    if (typeof since !== 'number' || !Number.isFinite(since) || since < 0) {
        add('SINCE_INVALID', 'since must be 0 or an epoch timestamp.');
    } else if (since > now()) {
        add('SINCE_FUTURE', 'since must not be in the future.');
    } else if (since > 0 && typeList.includes('cookies') && plan.cookieMode === 'exact') {
        add('SINCE_WITH_EXACT_COOKIES', 'Exact cookie removal cannot be limited by time.');
    }

    // After action and tab
    if (!AFTER_ACTIONS.includes(plan.after)) {
        add('AFTER_INVALID', `Unknown after action: ${String(plan.after)}`);
    }
    if (plan.after === 'start') {
        const path = plan.startPath;
        if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
            add('START_PATH_INVALID', 'startPath must start with a single "/".');
        }
    }
    const needsTab = (AFTER_ACTIONS.includes(plan.after) && plan.after !== 'none') ||
        typeList.includes('sessionStorage');
    if (needsTab) {
        const tab = plan.tab;
        if (!isObject(tab) || !Number.isInteger(tab.id) || typeof tab.origin !== 'string') {
            add('TAB_REQUIRED', 'A reload/start action or sessionStorage needs the active tab.');
        } else if (!Array.isArray(origins) || !origins.includes(tab.origin)) {
            add('TAB_ORIGIN_MISMATCH', 'The active tab origin must be one of the plan origins.');
        }
    }

    return { ok: errors.length === 0, errors };
}

/**
 * Creates a plan from caller input and validates it.
 *
 * Origins are canonicalized (case, default port, trailing "/") but anything
 * that is not already a bare origin is rejected rather than silently trimmed.
 *
 * @param {Object} input - Plan fields; unspecified fields get safe defaults.
 * @param {{now?: Function}} [options] - Clock injection for tests.
 * @returns {{ok: true, plan: Plan}|{ok: false, code: string, error: string}} Result.
 */
export function createPlan(input, { now = Date.now } = {}) {
    if (!isObject(input)) {
        return { ok: false, code: 'PLAN_INVALID', error: 'Plan input must be an object.' };
    }
    if (hasExcludeKey(input)) {
        return { ok: false, code: 'EXCLUDE_FORBIDDEN', error: 'Exclusion options are forbidden.' };
    }
    if (!Array.isArray(input.origins)) {
        return { ok: false, code: 'ORIGINS_REQUIRED', error: 'At least one exact origin is required.' };
    }

    const origins = [];
    for (const raw of input.origins) {
        let candidate = raw;
        if (typeof raw === 'string' && !/[*@?#]/.test(raw)) {
            const parsed = validateOrigin(raw);
            if (parsed.valid) candidate = parsed.origin;
        }
        if (!origins.includes(candidate)) origins.push(candidate);
    }

    let dataTypes = input.dataTypes;
    if (Array.isArray(dataTypes)) {
        const known = DATA_TYPE_KEYS.filter(k => dataTypes.includes(k));
        const other = dataTypes.filter((k, i) => !DATA_TYPE_KEYS.includes(k) && dataTypes.indexOf(k) === i);
        dataTypes = [...known, ...other];
    }

    const selection = isObject(input.cookieSelection) ? input.cookieSelection : {};
    const plan = {
        version: 1,
        source: input.source === undefined ? 'popup' : input.source,
        origins,
        dataTypes,
        cookieMode: input.cookieMode === undefined ? 'exact' : input.cookieMode,
        cookieSelection: {
            includeShared: selection.includeShared === undefined ? [] : selection.includeShared,
            keepNames: selection.keepNames === undefined ? [] : selection.keepNames
        },
        since: input.since === undefined ? 0 : input.since,
        after: input.after === undefined ? 'none' : input.after,
        startPath: input.startPath === undefined ? '/' : input.startPath,
        presetId: typeof input.presetId === 'string' ? input.presetId : 'custom',
        tab: input.tab === undefined ? null : input.tab
    };

    const validation = validatePlan(plan, { now });
    if (!validation.ok) {
        const first = validation.errors[0];
        return { ok: false, code: first.code, error: first.message };
    }
    return { ok: true, plan };
}

/**
 * Whether the plan removes cookies.
 * @param {Plan} plan - Plan.
 * @returns {boolean} True when cookies are selected.
 */
function hasCookies(plan) {
    return Array.isArray(plan.dataTypes) && plan.dataTypes.includes('cookies');
}

/**
 * Whether cookie removal can reach beyond the exact host (domain-wide, or
 * shared domain cookies explicitly selected).
 * @param {Plan} plan - Plan.
 * @returns {boolean} True when the cookie scope is wide.
 */
function cookiesAreWide(plan) {
    if (!hasCookies(plan)) return false;
    if (plan.cookieMode === 'domainWide') return true;
    return Boolean(plan.cookieSelection && plan.cookieSelection.includeShared &&
        plan.cookieSelection.includeShared.length > 0);
}

/**
 * Confirmation level for a plan.
 * - "danger": cookies removed domain-wide, or shared cookies selected.
 * - "review": exact-mode cookies.
 * - "none": no cookies.
 *
 * @param {Plan} plan - Plan.
 * @returns {'danger'|'review'|'none'} Level.
 */
export function confirmationLevel(plan) {
    if (!hasCookies(plan)) return 'none';
    return cookiesAreWide(plan) ? 'danger' : 'review';
}

/**
 * Whether the plan must be confirmed in the popup before it runs.
 * @param {Plan} plan - Plan.
 * @returns {boolean} True unless the level is "none".
 */
export function requiresConfirmation(plan) {
    return confirmationLevel(plan) !== 'none';
}

/**
 * Describes a plan for the confirmation and result screens.
 *
 * @param {Plan} plan - Plan.
 * @param {{counts?: Object<string, number>, sharedCookies?: {count: number, domain: string}}} [extras]
 *   Optional per-type counts and the number of shared cookies that stay.
 * @returns {Object} Description (see docs/architecture.md).
 */
export function describePlan(plan, extras = {}) {
    const counts = extras.counts || {};
    const origins = Array.isArray(plan.origins) ? plan.origins : [];
    const types = Array.isArray(plan.dataTypes) ? plan.dataTypes : [];

    const remove = [];
    const notApplicable = [];
    for (const key of DATA_TYPE_KEYS) {
        if (!types.includes(key)) continue;
        const def = DATA_TYPES.find(t => t.key === key);
        remove.push({
            type: key,
            labelKey: def.labelKey,
            count: typeof counts[key] === 'number' ? counts[key] : null
        });
        if (key === 'sessionStorage') {
            for (const origin of origins) {
                if (!plan.tab || plan.tab.origin !== origin) {
                    notApplicable.push({ type: key, origin, reason: 'notActiveTab' });
                }
            }
        }
    }

    const keep = [];
    const shared = extras.sharedCookies;
    if (hasCookies(plan) && plan.cookieMode === 'exact' && shared && shared.count > 0 &&
        !(plan.cookieSelection && plan.cookieSelection.includeShared.length > 0)) {
        keep.push({ kind: 'sharedCookies', count: shared.count, domain: shared.domain });
    }
    keep.push({ kind: 'otherOrigins' });
    keep.push({ kind: 'browserData' });

    return {
        origin: origins[0] || '',
        origins: [...origins],
        preset: plan.presetId,
        scope: cookiesAreWide(plan) ? 'wide' : 'exact',
        remove,
        keep,
        notApplicable,
        after: plan.after,
        since: plan.since
    };
}

/**
 * Clears sessionStorage in one frame when the frame origin matches the target.
 *
 * Injected with chrome.scripting.executeScript, so it must stay completely
 * self-contained: no closures, no imports, only page globals.
 *
 * @param {string} target - Exact origin the frame must have.
 * @returns {{cleared: boolean, count: number, skipped?: boolean, error?: string}} Frame result.
 */
export function clearSessionStorageInFrame(target) {
    try {
        if (location.origin !== target) return { cleared: false, count: 0, skipped: true };
        const count = sessionStorage.length;
        sessionStorage.clear();
        return { cleared: true, count };
    } catch (e) {
        return { cleared: false, count: 0, error: String(e && e.message ? e.message : e) };
    }
}

/**
 * Per-origin execution result.
 * @typedef {Object} OriginResult
 * @property {string} origin
 * @property {Object<string, 'ok'|'skipped'|'error'>} types
 * @property {{removed: number, kept: number, failed: number}|null} cookies
 * @property {Array<{type: string, code: string, message: string}>} errors
 */

/**
 * Extracts a readable message from a thrown value.
 * @param {*} e - Thrown value.
 * @returns {string} Message.
 */
function messageOf(e) {
    return String(e && e.message ? e.message : e);
}

/**
 * Clears sessionStorage for the plan's active tab origin.
 * @param {Object} api - Chrome API object.
 * @param {Plan} plan - Plan.
 * @param {string} origin - Origin being processed.
 * @param {OriginResult} entry - Result entry to fill.
 */
async function runSessionStorage(api, plan, origin, entry) {
    if (!plan.tab || plan.tab.origin !== origin) {
        entry.types.sessionStorage = 'skipped';
        return;
    }
    try {
        const results = await api.scripting.executeScript({
            target: { tabId: plan.tab.id, allFrames: true },
            func: clearSessionStorageInFrame,
            args: [origin]
        });
        const frames = (results || []).map(r => r && r.result).filter(Boolean);
        const failed = frames.find(f => f.error);
        if (failed) {
            entry.types.sessionStorage = 'error';
            entry.errors.push({ type: 'sessionStorage', code: 'SESSION_STORAGE_FAILED', message: failed.error });
        } else {
            entry.types.sessionStorage = frames.some(f => f.cleared) ? 'ok' : 'skipped';
        }
    } catch (e) {
        entry.types.sessionStorage = 'error';
        entry.errors.push({ type: 'sessionStorage', code: 'SESSION_STORAGE_FAILED', message: messageOf(e) });
    }
}

/**
 * Reads every cookie that could apply to an origin (all partitions).
 * @param {Object} api - Chrome API object.
 * @param {string} origin - Exact origin.
 * @param {string|undefined} storeId - Cookie store.
 * @returns {Promise<Array<Object>>} Cookies (de-duplicated by the classifier).
 */
async function collectCookies(api, origin, storeId) {
    const base = storeId ? { storeId } : {};
    const queries = [{ url: `${origin}/`, partitionKey: {}, ...base }];
    for (const domain of candidateDomains(originHost(origin))) {
        queries.push({ domain, partitionKey: {}, ...base });
    }
    const all = [];
    for (const query of queries) {
        const found = await api.cookies.getAll(query);
        if (Array.isArray(found)) all.push(...found);
    }
    return all;
}

/**
 * Removes cookies for one origin in Exact Cookie Mode.
 * @param {Object} api - Chrome API object.
 * @param {Plan} plan - Plan.
 * @param {string} origin - Origin being processed.
 * @param {OriginResult} entry - Result entry to fill.
 */
async function runExactCookies(api, plan, origin, entry) {
    let granted = false;
    try {
        granted = await api.permissions.contains({ origins: [`${origin}/*`] });
    } catch (e) {
        granted = false;
    }
    if (!granted) {
        entry.types.cookies = 'error';
        entry.errors.push({
            type: 'cookies',
            code: 'COOKIE_PERMISSION_MISSING',
            message: `Host permission for ${origin} is required to remove exact cookies.`
        });
        return;
    }

    const storeId = plan.tab && plan.tab.storeId ? plan.tab.storeId : undefined;
    let classified;
    try {
        classified = classifyCookies(await collectCookies(api, origin, storeId), origin);
    } catch (e) {
        entry.types.cookies = 'error';
        entry.errors.push({ type: 'cookies', code: 'COOKIE_READ_FAILED', message: messageOf(e) });
        return;
    }

    const includeShared = new Set(plan.cookieSelection.includeShared);
    const keepNames = new Set(plan.cookieSelection.keepNames);
    const candidates = [
        ...classified.hostOnly,
        ...classified.partitioned,
        ...classified.shared.filter(c => includeShared.has(c.id))
    ];
    const toRemove = candidates.filter(c => !keepNames.has(c.name));
    const total = classified.hostOnly.length + classified.partitioned.length + classified.shared.length;

    const counts = { removed: 0, kept: 0, failed: 0 };
    let firstFailure = null;
    for (const cookie of toRemove) {
        try {
            const done = await api.cookies.remove(cookieRemovalDetails(cookie, origin));
            if (done) {
                counts.removed++;
            } else {
                counts.failed++;
            }
        } catch (e) {
            counts.failed++;
            if (!firstFailure) firstFailure = messageOf(e);
        }
    }
    counts.kept = total - counts.removed - counts.failed;
    entry.cookies = counts;
    if (counts.failed > 0) {
        entry.types.cookies = 'error';
        entry.errors.push({
            type: 'cookies',
            code: 'COOKIE_REMOVE_FAILED',
            message: firstFailure || `${counts.failed} cookie(s) could not be removed.`
        });
    } else {
        entry.types.cookies = 'ok';
    }
}

/**
 * Removes origin-scoped browser data through chrome.browsingData for one origin.
 * @param {Object} api - Chrome API object.
 * @param {Plan} plan - Plan.
 * @param {string} origin - Origin being processed.
 * @param {OriginResult} entry - Result entry to fill.
 */
async function runBrowsingData(api, plan, origin, entry) {
    const domainWide = plan.cookieMode === 'domainWide';
    const set = buildDataTypeSet(plan.dataTypes, { domainWide });
    const apiKeys = Object.keys(set);
    if (apiKeys.length === 0) return;

    const options = buildRemovalOptions({ origins: [origin], since: plan.since });
    const typeKeys = plan.dataTypes.filter(k => {
        const def = DATA_TYPES.find(t => t.key === k);
        return def && def.api !== null && set[def.api] === true;
    });
    try {
        await api.browsingData.remove(options, set);
        for (const key of typeKeys) entry.types[key] = 'ok';
    } catch (e) {
        for (const key of typeKeys) {
            entry.types[key] = 'error';
            entry.errors.push({ type: key, code: 'BROWSING_DATA_FAILED', message: messageOf(e) });
        }
    }
}

/**
 * Runs the plan's after-action once, for the active tab.
 * @param {Object} api - Chrome API object.
 * @param {Plan} plan - Plan.
 * @returns {Promise<{action: string, ok: boolean, error?: string}>} Result.
 */
async function runAfterAction(api, plan) {
    const action = plan.after;
    if (action === 'none') return { action, ok: true };
    try {
        if (action === 'reload') {
            await api.tabs.reload(plan.tab.id, { bypassCache: false });
        } else if (action === 'hard') {
            await api.tabs.reload(plan.tab.id, { bypassCache: true });
        } else {
            await api.tabs.update(plan.tab.id, { url: `${plan.tab.origin}${plan.startPath}` });
        }
        return { action, ok: true };
    } catch (e) {
        return { action, ok: false, error: messageOf(e) };
    }
}

/**
 * Executes a plan. Order per origin: sessionStorage, cookies (exact engine),
 * browsingData, then the after-action once for the active tab.
 *
 * The Scope Guard runs first and throws before any API call. Failures of
 * individual steps are recorded in the result, never thrown.
 *
 * @param {Plan} plan - Plan to execute.
 * @param {{api?: Object, now?: Function}} [options] - Injected Chrome API and clock.
 * @returns {Promise<{ok: boolean, startedAt: number, finishedAt: number, durationMs: number,
 *   perOrigin: Array<OriginResult>, after: {action: string, ok: boolean, error?: string}}>} Result.
 * @throws {ScopeGuardError} When the plan violates the Scope Guard.
 */
export async function executePlan(plan, { api = globalThis.chrome, now = Date.now } = {}) {
    const guard = validatePlan(plan, { now });
    if (!guard.ok) throw new ScopeGuardError(guard.errors);

    const startedAt = now();
    const perOrigin = [];
    for (const origin of [...new Set(plan.origins)]) {
        /** @type {OriginResult} */
        const entry = { origin, types: {}, cookies: null, errors: [] };
        if (plan.dataTypes.includes('sessionStorage')) {
            await runSessionStorage(api, plan, origin, entry);
        }
        if (plan.dataTypes.includes('cookies') && plan.cookieMode === 'exact') {
            await runExactCookies(api, plan, origin, entry);
        }
        await runBrowsingData(api, plan, origin, entry);
        perOrigin.push(entry);
    }

    const after = await runAfterAction(api, plan);
    const finishedAt = now();
    return {
        ok: after.ok && perOrigin.every(o => o.errors.length === 0),
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        perOrigin,
        after
    };
}
