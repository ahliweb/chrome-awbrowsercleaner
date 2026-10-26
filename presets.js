/**
 * AW Browser Cleaner - Presets
 *
 * Built-in presets, custom preset schema validation and JSON import/export.
 * Pure module: no Chrome API or DOM dependency. See docs/architecture.md.
 *
 * A preset never widens the scope of a cleanup. It only pre-selects data types,
 * cookie mode and the after-action; origins are always explicit and exact.
 */

import { validateOrigin } from './origin-utils.js';
import { DATA_TYPE_KEYS, MAX_ORIGINS, AFTER_ACTIONS } from './cleanup-core.js';

/** Format identifier written in exported preset files. */
export const PRESETS_FORMAT = 'aw-browser-cleaner-presets';

/** Version of the exported preset file format. */
export const PRESETS_VERSION = 1;

/** Maximum number of custom presets (also the import limit). */
export const MAX_CUSTOM_PRESETS = 50;

/** Maximum number of preserved cookie names per preset. */
export const MAX_KEEP_COOKIE_NAMES = 20;

/** Allowed cookie modes. */
export const COOKIE_MODES = Object.freeze(['exact', 'domainWide']);

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
// RFC 6265 `token` characters (cookie-name).
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const MAX_NAME_LENGTH = 60;
const MAX_START_PATH_LENGTH = 200;
const MAX_COOKIE_NAME_LENGTH = 128;

const ALLOWED_KEYS = Object.freeze([
    'id', 'name', 'dataTypes', 'cookieMode', 'after', 'startPath',
    'boundOrigin', 'origins', 'keepCookieNames'
]);

/**
 * @typedef {Object} Preset
 * @property {string} id
 * @property {string} [name] - Custom presets only.
 * @property {string} [nameKey] - Built-in presets only (i18n key).
 * @property {string} [descriptionKey] - Built-in presets only (i18n key).
 * @property {boolean} [builtin]
 * @property {string[]} dataTypes
 * @property {'exact'|'domainWide'} cookieMode
 * @property {'none'|'reload'|'hard'|'start'} after
 * @property {string} startPath
 * @property {string} [boundOrigin]
 * @property {string[]} [origins]
 * @property {string[]} [keepCookieNames]
 */

/**
 * @param {Object} preset
 * @returns {Readonly<Object>} Deeply frozen preset.
 */
function deepFreeze(preset) {
    for (const value of Object.values(preset)) {
        if (Array.isArray(value)) Object.freeze(value);
    }
    return Object.freeze(preset);
}

/**
 * Built-in presets, in display order.
 * @type {ReadonlyArray<Readonly<Preset>>}
 */
export const BUILTIN_PRESETS = Object.freeze([
    deepFreeze({
        id: 'logout',
        builtin: true,
        nameKey: 'presetLogout',
        descriptionKey: 'presetLogoutDesc',
        dataTypes: ['cookies', 'sessionStorage'],
        cookieMode: 'exact',
        after: 'reload',
        startPath: '/'
    }),
    deepFreeze({
        id: 'fresh',
        builtin: true,
        nameKey: 'presetFresh',
        descriptionKey: 'presetFreshDesc',
        dataTypes: ['cookies', 'sessionStorage', 'localStorage', 'indexedDB', 'fileSystems', 'cacheStorage', 'serviceWorkers'],
        cookieMode: 'exact',
        after: 'start',
        startPath: '/'
    }),
    deepFreeze({
        id: 'stale',
        builtin: true,
        nameKey: 'presetStale',
        descriptionKey: 'presetStaleDesc',
        dataTypes: ['cache', 'cacheStorage', 'serviceWorkers'],
        cookieMode: 'exact',
        after: 'hard',
        startPath: '/'
    }),
    deepFreeze({
        id: 'full',
        builtin: true,
        nameKey: 'presetFull',
        descriptionKey: 'presetFullDesc',
        dataTypes: [...DATA_TYPE_KEYS],
        cookieMode: 'exact',
        after: 'hard',
        startPath: '/'
    })
]);

const BUILTIN_IDS = new Set(BUILTIN_PRESETS.map(p => p.id));

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates one origin string exactly (no normalization, no wildcard).
 * @param {unknown} value
 * @returns {string|null} Error message, or null when valid.
 */
function originError(value) {
    if (typeof value !== 'string' || !value) return 'must be a string';
    if (value.includes('*')) return `"${value}" contains a wildcard, which is not allowed`;
    const check = validateOrigin(value);
    if (!check.valid || check.origin !== value) {
        return `"${value}" is not an exact origin like https://example.com`;
    }
    return null;
}

/**
 * Validates and normalizes a custom preset.
 *
 * @param {unknown} obj - Candidate custom preset.
 * @returns {{ok: boolean, preset: Readonly<Preset>|null, errors: string[]}}
 */
export function validatePreset(obj) {
    const errors = [];
    if (!isPlainObject(obj)) {
        return { ok: false, preset: null, errors: ['Preset must be an object.'] };
    }

    for (const key of Object.keys(obj)) {
        if (key.toLowerCase().includes('exclude')) {
            errors.push(`Scope Guard: "${key}" is not allowed. "Everything except" cleanups are forbidden; list exact origins instead.`);
        } else if (!ALLOWED_KEYS.includes(key)) {
            errors.push(`Unknown property "${key}".`);
        }
    }

    // id
    let id = obj.id;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        errors.push('id must be 1-40 characters: lowercase letters, digits and hyphens, starting with a letter or digit.');
        id = null;
    } else if (BUILTIN_IDS.has(id)) {
        errors.push(`id "${id}" is reserved by a built-in preset.`);
    }

    // name
    let name = null;
    if (typeof obj.name !== 'string') {
        errors.push('name is required.');
    } else {
        name = obj.name.trim();
        if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
            errors.push(`name must be 1-${MAX_NAME_LENGTH} characters.`);
            name = null;
        } else if (CONTROL_CHARS.test(name)) {
            errors.push('name must not contain control characters.');
            name = null;
        }
    }

    // dataTypes
    let dataTypes = null;
    if (!Array.isArray(obj.dataTypes) || obj.dataTypes.length === 0) {
        errors.push('dataTypes must be a non-empty array.');
    } else {
        const unknown = obj.dataTypes.filter(t => typeof t !== 'string' || !DATA_TYPE_KEYS.includes(t));
        if (unknown.length) {
            errors.push(`Unknown or unsupported data types: ${unknown.map(String).join(', ')}.`);
        } else {
            const wanted = new Set(obj.dataTypes);
            dataTypes = DATA_TYPE_KEYS.filter(k => wanted.has(k));
        }
    }

    // cookieMode
    const cookieMode = obj.cookieMode === undefined ? 'exact' : obj.cookieMode;
    if (!COOKIE_MODES.includes(cookieMode)) {
        errors.push('cookieMode must be "exact" or "domainWide".');
    }

    // after
    const after = obj.after === undefined ? 'none' : obj.after;
    if (!AFTER_ACTIONS.includes(after)) {
        errors.push(`after must be one of: ${AFTER_ACTIONS.join(', ')}.`);
    }

    // startPath
    const startPath = obj.startPath === undefined ? '/' : obj.startPath;
    if (typeof startPath !== 'string'
        || !startPath.startsWith('/')
        || startPath.startsWith('//')
        || startPath.length > MAX_START_PATH_LENGTH
        || CONTROL_CHARS.test(startPath)
        || startPath.includes('\\')) {
        errors.push(`startPath must be a path starting with a single "/" (max ${MAX_START_PATH_LENGTH} characters, no control characters).`);
    }

    // boundOrigin
    let boundOrigin;
    if (obj.boundOrigin !== undefined) {
        const problem = originError(obj.boundOrigin);
        if (problem) errors.push(`boundOrigin ${problem}.`);
        else boundOrigin = obj.boundOrigin;
    }

    // origins
    let origins;
    if (obj.origins !== undefined) {
        if (!Array.isArray(obj.origins)) {
            errors.push('origins must be an array of exact origins.');
        } else {
            const seen = [];
            let allValid = true;
            for (const o of obj.origins) {
                const problem = originError(o);
                if (problem) {
                    errors.push(`origins entry ${problem}.`);
                    allValid = false;
                } else if (!seen.includes(o)) {
                    seen.push(o);
                }
            }
            if (allValid) {
                origins = seen;
                const total = new Set(boundOrigin ? [boundOrigin, ...seen] : seen).size;
                if (total > MAX_ORIGINS) {
                    errors.push(`At most ${MAX_ORIGINS} origins are allowed in total (boundOrigin included).`);
                }
            }
        }
    }

    // keepCookieNames
    let keepCookieNames;
    if (obj.keepCookieNames !== undefined) {
        if (!Array.isArray(obj.keepCookieNames)) {
            errors.push('keepCookieNames must be an array of cookie names.');
        } else {
            const names = [];
            let allValid = true;
            for (const n of obj.keepCookieNames) {
                if (typeof n !== 'string' || !n || n.length > MAX_COOKIE_NAME_LENGTH || !COOKIE_NAME_PATTERN.test(n)) {
                    errors.push(`keepCookieNames entry ${JSON.stringify(n)} is not a valid cookie name.`);
                    allValid = false;
                } else if (!names.includes(n)) {
                    names.push(n);
                }
            }
            if (allValid) {
                keepCookieNames = names;
                if (names.length > MAX_KEEP_COOKIE_NAMES) {
                    errors.push(`keepCookieNames allows at most ${MAX_KEEP_COOKIE_NAMES} names.`);
                }
            }
        }
    }

    if (errors.length) return { ok: false, preset: null, errors };

    /** @type {Preset} */
    const preset = { id, name, dataTypes, cookieMode, after, startPath };
    if (boundOrigin !== undefined) preset.boundOrigin = boundOrigin;
    if (origins !== undefined) preset.origins = origins;
    if (keepCookieNames !== undefined) preset.keepCookieNames = keepCookieNames;
    return { ok: true, preset: deepFreeze(preset), errors: [] };
}

/**
 * Finds a preset by id: built-ins first, then custom presets.
 *
 * @param {string} id
 * @param {Preset[]} [customPresets]
 * @returns {Preset|null}
 */
export function getPreset(id, customPresets = []) {
    const builtin = BUILTIN_PRESETS.find(p => p.id === id);
    if (builtin) return builtin;
    return (Array.isArray(customPresets) ? customPresets : []).find(p => p && p.id === id) || null;
}

/**
 * Lists all presets, built-ins first.
 *
 * @param {Preset[]} [customPresets]
 * @returns {Preset[]}
 */
export function listPresets(customPresets = []) {
    return [...BUILTIN_PRESETS, ...(Array.isArray(customPresets) ? customPresets : [])];
}

/**
 * Creates a custom preset from a built-in (or custom) one.
 *
 * @param {Preset} source
 * @param {string} newId
 * @param {string} newName
 * @returns {{ok: boolean, preset: Readonly<Preset>|null, errors: string[]}}
 */
export function duplicatePreset(source, newId, newName) {
    if (!isPlainObject(source)) {
        return { ok: false, preset: null, errors: ['Source preset must be an object.'] };
    }
    const candidate = {
        id: newId,
        name: newName,
        dataTypes: [...(source.dataTypes || [])],
        cookieMode: source.cookieMode,
        after: source.after,
        startPath: source.startPath
    };
    if (source.boundOrigin !== undefined) candidate.boundOrigin = source.boundOrigin;
    if (source.origins !== undefined) candidate.origins = [...source.origins];
    if (source.keepCookieNames !== undefined) candidate.keepCookieNames = [...source.keepCookieNames];
    return validatePreset(candidate);
}

/**
 * Serializes custom presets for export.
 *
 * @param {Preset[]} customPresets
 * @param {Date|number} [now]
 * @returns {string} Pretty-printed JSON.
 * @throws {Error} When a preset is invalid.
 */
export function exportPresets(customPresets, now = new Date()) {
    const list = Array.isArray(customPresets) ? customPresets : [];
    const presets = list.map((p, i) => {
        const res = validatePreset(p);
        if (!res.ok) throw new Error(`Cannot export preset #${i + 1}: ${res.errors.join(' ')}`);
        return res.preset;
    });
    return JSON.stringify({
        format: PRESETS_FORMAT,
        version: PRESETS_VERSION,
        exportedAt: new Date(now).toISOString(),
        presets
    }, null, 2);
}

/**
 * Imports presets from an exported JSON string. Atomic: any problem rejects
 * the whole import. Imported presets replace existing ones with the same id.
 *
 * @param {string} jsonString
 * @param {Preset[]} [existing] - Currently stored custom presets.
 * @returns {{ok: boolean, presets: Preset[], imported: Preset[], errors: string[]}}
 *   `presets` is the merged list to store; `imported` only the new entries.
 */
export function importPresets(jsonString, existing = []) {
    const fail = errors => ({ ok: false, presets: [], imported: [], errors });
    const current = Array.isArray(existing) ? existing : [];

    let data;
    try {
        data = JSON.parse(jsonString);
    } catch (e) {
        return fail(['File is not valid JSON.']);
    }
    if (!isPlainObject(data) || data.format !== PRESETS_FORMAT) {
        return fail([`Unrecognized file format (expected "${PRESETS_FORMAT}").`]);
    }
    if (data.version !== PRESETS_VERSION) {
        return fail([`Unsupported version ${JSON.stringify(data.version)} (expected ${PRESETS_VERSION}).`]);
    }
    if (!Array.isArray(data.presets)) {
        return fail(['"presets" must be an array.']);
    }
    if (data.presets.length > MAX_CUSTOM_PRESETS) {
        return fail([`Too many presets (max ${MAX_CUSTOM_PRESETS}).`]);
    }

    const errors = [];
    const imported = [];
    const ids = new Set();
    data.presets.forEach((raw, i) => {
        const res = validatePreset(raw);
        if (!res.ok) {
            errors.push(...res.errors.map(e => `Preset #${i + 1}: ${e}`));
            return;
        }
        if (ids.has(res.preset.id)) {
            errors.push(`Preset #${i + 1}: duplicate id "${res.preset.id}" in file.`);
            return;
        }
        ids.add(res.preset.id);
        imported.push(res.preset);
    });
    if (errors.length) return fail(errors);

    const merged = current.filter(p => !ids.has(p.id));
    merged.push(...imported);
    if (merged.length > MAX_CUSTOM_PRESETS) {
        return fail([`Import would exceed the limit of ${MAX_CUSTOM_PRESETS} custom presets.`]);
    }
    return { ok: true, presets: merged, imported, errors: [] };
}

/**
 * Whether the current popup selection still equals a preset (the popup shows
 * "Custom" when it does not). Cookie mode only matters when cookies are selected.
 *
 * @param {Preset} preset
 * @param {{dataTypes: string[], cookieMode?: string, after?: string}} selection
 * @returns {boolean}
 */
export function presetMatchesSelection(preset, selection) {
    if (!preset || !selection || !Array.isArray(selection.dataTypes)) return false;
    const a = new Set(preset.dataTypes);
    const b = new Set(selection.dataTypes);
    if (a.size !== b.size || [...a].some(t => !b.has(t))) return false;
    if (a.has('cookies') && (preset.cookieMode || 'exact') !== (selection.cookieMode || 'exact')) return false;
    return (preset.after || 'none') === (selection.after || 'none');
}

/**
 * Builds the `createPlan` input for running a preset on one origin.
 *
 * The given `origin` is always the primary origin, even when the preset has a
 * `boundOrigin` that differs: `boundOrigin` only tells the popup which origin a
 * preset was designed for, it never redirects a cleanup. Extra origins from the
 * preset follow the primary one, de-duplicated and capped at MAX_ORIGINS.
 *
 * Without an active tab (`tab` is null), steps that need a tab cannot run:
 * `sessionStorage` is removed from the data types and the after-action becomes
 * 'none'. Both are reported in `dropped` so callers can tell the user.
 *
 * @param {Preset} preset - Built-in or custom preset.
 * @param {Object} context
 * @param {string} context.origin - Exact primary origin.
 * @param {{id: number, origin: string, storeId?: string}|null} [context.tab] - Active tab, or null.
 * @param {string} context.source - Plan source ('popup', 'shortcut', 'contextMenu', 'testMode').
 * @param {number} [context.since] - Start of the time range (0 = all time).
 * @returns {{input: Object, dropped: Array<{type?: string, after?: string, reason: string}>}}
 *   `input` for `createPlan` and the list of dropped steps.
 */
export function presetToPlanInput(preset, { origin, tab = null, source, since = 0 } = {}) {
    const dropped = [];
    let dataTypes = Array.isArray(preset.dataTypes) ? [...preset.dataTypes] : [];
    let after = preset.after || 'none';

    if (!tab) {
        if (dataTypes.includes('sessionStorage')) {
            dataTypes = dataTypes.filter(t => t !== 'sessionStorage');
            dropped.push({ type: 'sessionStorage', reason: 'noTab' });
        }
        if (after !== 'none') {
            dropped.push({ after, reason: 'noTab' });
            after = 'none';
        }
    }

    const origins = [];
    for (const candidate of [origin, ...(Array.isArray(preset.origins) ? preset.origins : [])]) {
        if (!origins.includes(candidate)) origins.push(candidate);
    }

    return {
        input: {
            origins: origins.slice(0, MAX_ORIGINS),
            dataTypes,
            cookieMode: preset.cookieMode || 'exact',
            cookieSelection: {
                includeShared: [],
                keepNames: Array.isArray(preset.keepCookieNames) ? [...preset.keepCookieNames] : []
            },
            since,
            after,
            startPath: preset.startPath || '/',
            presetId: preset.id,
            tab,
            source
        },
        dropped
    };
}
