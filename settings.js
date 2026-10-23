/**
 * AW Browser Cleaner - Settings
 *
 * Thin adapter over chrome.storage areas (injected for testability).
 *
 *  - sync:    custom presets (one key per preset, to respect the 8 KB per-item
 *             quota) and the last used preset id.
 *  - local:   per-origin preset memory, recent origins, history, Test Mode,
 *             history switch, permission grant log.
 *  - session: start time of a test session (cleared when the browser closes).
 *
 * All storage keys are namespaced "aw.". Nothing stored here contains cookie
 * values or storage contents.
 */

import { validateOrigin } from './origin-utils.js';
import { validatePreset, MAX_CUSTOM_PRESETS } from './presets.js';

/** Storage keys. */
export const KEYS = Object.freeze({
    presetPrefix: 'aw.preset.',
    lastPreset: 'aw.lastPreset',
    lastPresetByOrigin: 'aw.lastPresetByOrigin',
    recentOrigins: 'aw.recentOrigins',
    history: 'aw.history',
    historyEnabled: 'aw.historyEnabled',
    testMode: 'aw.testMode',
    sessionStart: 'aw.sessionStart',
    pendingConfirmation: 'aw.pendingConfirmation',
    permissionGrants: 'aw.permissionGrants'
});

export const MAX_RECENT_ORIGINS = 3;
export const MAX_HISTORY = 20;
export const MAX_ORIGIN_PRESETS = 100;
export const MAX_TEST_ORIGINS = 20;
/** How long a shortcut's pending confirmation stays valid for the popup. */
export const PENDING_CONFIRMATION_TTL_MS = 60000;
const MAX_PERMISSION_GRANTS = 200;

/** Default Test Mode configuration (disabled). */
export const DEFAULT_TEST_MODE = Object.freeze({
    enabled: false,
    allowedOrigins: Object.freeze(['http://localhost', 'http://127.0.0.1'])
});

const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const GRANT_KIND_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/;
const ALLOWED_PATTERN = /^(https?):\/\/(\[[0-9a-fA-F:.]+\]|[^/:?#@\s*[\]]+)(:\d+)?$/;

/**
 * Minimal chrome.storage.StorageArea shape used here.
 * @typedef {Object} StorageAreaLike
 * @property {(keys?: string|string[]|null) => Promise<Object>} get
 * @property {(items: Object) => Promise<void>} set
 * @property {(keys: string|string[]) => Promise<void>} remove
 */

/**
 * Parses a Test Mode allow-list entry.
 *
 * @param {unknown} entry
 * @returns {{ok: true, value: string, anyPort: boolean}|{ok: false, error: string}}
 */
function parseAllowedEntry(entry) {
    if (typeof entry !== 'string') return { ok: false, error: 'Entry must be a string.' };
    const raw = entry.trim();
    const match = ALLOWED_PATTERN.exec(raw);
    if (!match) {
        return { ok: false, error: `"${raw}" must look like http://localhost or http://localhost:3000 (http/https only, no path or wildcard).` };
    }
    const explicitPort = Boolean(match[3]);
    let url;
    try {
        url = new URL(raw);
    } catch (e) {
        return { ok: false, error: `"${raw}" is not a valid origin.` };
    }
    if (explicitPort && !url.port) {
        return { ok: false, error: `"${raw}" uses the default port; write it without a port (which allows any port) or use another port.` };
    }
    return { ok: true, value: url.origin, anyPort: !explicitPort };
}

/**
 * Whether Test Mode may act on an origin. Pure helper.
 *
 * An allow-list entry with an explicit port matches only that exact origin.
 * An entry without a port (scheme://host) matches that scheme and host on any port.
 *
 * @param {string} origin
 * @param {{enabled: boolean, allowedOrigins: string[]}} [config]
 * @returns {boolean}
 */
export function isOriginAllowedForTestMode(origin, config = DEFAULT_TEST_MODE) {
    if (!config || config.enabled !== true || !Array.isArray(config.allowedOrigins)) return false;
    if (!isExactOrigin(origin)) return false;
    const target = new URL(origin);
    for (const entry of config.allowedOrigins) {
        const parsed = parseAllowedEntry(entry);
        if (!parsed.ok) continue;
        if (!parsed.anyPort) {
            if (parsed.value === origin) return true;
            continue;
        }
        const allowed = new URL(parsed.value);
        if (allowed.protocol === target.protocol && allowed.hostname === target.hostname) return true;
    }
    return false;
}

/**
 * @param {unknown} origin
 * @returns {boolean} True for an exact, normalized http(s) origin.
 */
function isExactOrigin(origin) {
    if (typeof origin !== 'string' || origin.includes('*')) return false;
    const check = validateOrigin(origin);
    return check.valid && check.origin === origin;
}

/**
 * Creates a settings API bound to storage areas.
 *
 * @param {{sync?: StorageAreaLike, local?: StorageAreaLike, session?: StorageAreaLike}} [areas]
 * @returns {Object} Async settings API.
 */
export function createSettings({
    sync = globalThis.chrome?.storage?.sync,
    local = globalThis.chrome?.storage?.local,
    session = globalThis.chrome?.storage?.session
} = {}) {
    const areas = { sync, local, session };

    /**
     * @param {'sync'|'local'|'session'} name
     * @returns {StorageAreaLike}
     */
    const area = name => {
        if (!areas[name]) throw new Error(`chrome.storage.${name} is not available.`);
        return areas[name];
    };

    // Serializes read-modify-write cycles so concurrent calls cannot lose updates.
    let queue = Promise.resolve();
    const exclusive = fn => {
        const run = queue.then(fn, fn);
        queue = run.then(() => undefined, () => undefined);
        return run;
    };

    const read = async (name, key, fallback) => {
        const data = await area(name).get(key);
        return data && data[key] !== undefined ? data[key] : fallback;
    };
    const write = (name, key, value) => area(name).set({ [key]: value });

    // ---- custom presets -------------------------------------------------

    const getCustomPresets = async () => {
        const all = await area('sync').get(null);
        const presets = [];
        for (const [key, value] of Object.entries(all || {})) {
            if (!key.startsWith(KEYS.presetPrefix)) continue;
            const res = validatePreset(value);
            if (res.ok) presets.push(res.preset);
        }
        return presets.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    };

    const saveCustomPreset = preset => exclusive(async () => {
        const res = validatePreset(preset);
        if (!res.ok) return { ok: false, preset: null, errors: res.errors };
        const key = KEYS.presetPrefix + res.preset.id;
        const existing = (await area('sync').get(null)) || {};
        const count = Object.keys(existing).filter(k => k.startsWith(KEYS.presetPrefix)).length;
        if (existing[key] === undefined && count >= MAX_CUSTOM_PRESETS) {
            return { ok: false, preset: null, errors: [`At most ${MAX_CUSTOM_PRESETS} custom presets can be saved.`] };
        }
        await area('sync').set({ [key]: { ...res.preset } });
        return { ok: true, preset: res.preset, errors: [] };
    });

    const deleteCustomPreset = id => exclusive(async () => {
        if (typeof id !== 'string' || !PRESET_ID_PATTERN.test(id)) return false;
        await area('sync').remove(KEYS.presetPrefix + id);
        return true;
    });

    // ---- last preset ----------------------------------------------------

    const getLastPreset = async () => {
        const id = await read('sync', KEYS.lastPreset, null);
        return typeof id === 'string' && PRESET_ID_PATTERN.test(id) ? id : null;
    };

    const setLastPreset = (presetId, origin) => exclusive(async () => {
        if (typeof presetId !== 'string' || !PRESET_ID_PATTERN.test(presetId)) return false;
        await write('sync', KEYS.lastPreset, presetId);
        if (origin !== undefined && isExactOrigin(origin)) {
            // Ordered oldest -> newest; most recently used entries survive the cap.
            const list = (await read('local', KEYS.lastPresetByOrigin, []))
                .filter(e => e && e.origin !== origin);
            list.push({ origin, presetId });
            await write('local', KEYS.lastPresetByOrigin, list.slice(-MAX_ORIGIN_PRESETS));
        }
        return true;
    });

    const getLastPresetForOrigin = async origin => {
        if (!isExactOrigin(origin)) return null;
        const list = await read('local', KEYS.lastPresetByOrigin, []);
        const hit = Array.isArray(list) ? list.find(e => e && e.origin === origin) : null;
        return hit && PRESET_ID_PATTERN.test(hit.presetId) ? hit.presetId : null;
    };

    const clearLastPresetMemory = () => exclusive(async () => {
        await area('local').remove(KEYS.lastPresetByOrigin);
    });

    // ---- history switch -------------------------------------------------

    const getHistoryEnabled = async () => (await read('local', KEYS.historyEnabled, true)) !== false;

    const setHistoryEnabled = enabled => exclusive(async () => {
        await write('local', KEYS.historyEnabled, Boolean(enabled));
    });

    // ---- recent origins -------------------------------------------------

    const getRecentOrigins = async () => {
        const list = await read('local', KEYS.recentOrigins, []);
        return (Array.isArray(list) ? list : [])
            .filter(e => e && isExactOrigin(e.origin))
            .slice(0, MAX_RECENT_ORIGINS)
            .map(e => ({ origin: e.origin, at: e.at }));
    };

    const addRecentOrigin = (origin, now = Date.now()) => exclusive(async () => {
        if (!isExactOrigin(origin)) return false;
        if (!(await getHistoryEnabled())) return false;
        const list = (await getRecentOrigins()).filter(e => e.origin !== origin);
        list.unshift({ origin, at: now });
        await write('local', KEYS.recentOrigins, list.slice(0, MAX_RECENT_ORIGINS));
        return true;
    });

    const clearRecentOrigins = () => exclusive(async () => {
        await area('local').remove(KEYS.recentOrigins);
    });

    // ---- history --------------------------------------------------------

    const getHistory = async () => {
        const list = await read('local', KEYS.history, []);
        return Array.isArray(list) ? list.slice(0, MAX_HISTORY) : [];
    };

    const addHistoryEntry = entry => exclusive(async () => {
        if (!entry || typeof entry !== 'object') return false;
        if (!(await getHistoryEnabled())) return false;
        const origins = Array.isArray(entry.origins) ? entry.origins.filter(isExactOrigin) : [];
        if (origins.length === 0) return false;
        // Whitelist: never persist anything beyond these metadata fields.
        const clean = {
            id: String(entry.id ?? '').slice(0, 64),
            at: String(entry.at ?? '').slice(0, 40),
            origins: origins.slice(0, 10),
            presetId: String(entry.presetId ?? 'custom').slice(0, 40),
            durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : 0,
            ok: entry.ok !== false
        };
        const list = [clean, ...(await getHistory())].slice(0, MAX_HISTORY);
        await write('local', KEYS.history, list);
        return true;
    });

    const clearHistory = () => exclusive(async () => {
        await area('local').remove(KEYS.history);
    });

    // ---- Test Mode ------------------------------------------------------

    const getTestMode = async () => {
        const stored = await read('local', KEYS.testMode, null);
        if (!stored || typeof stored !== 'object') {
            return { enabled: DEFAULT_TEST_MODE.enabled, allowedOrigins: [...DEFAULT_TEST_MODE.allowedOrigins] };
        }
        const allowed = Array.isArray(stored.allowedOrigins)
            ? stored.allowedOrigins.filter(e => parseAllowedEntry(e).ok)
            : [...DEFAULT_TEST_MODE.allowedOrigins];
        return { enabled: stored.enabled === true, allowedOrigins: allowed.slice(0, MAX_TEST_ORIGINS) };
    };

    const setTestMode = config => exclusive(async () => {
        const errors = [];
        if (!config || typeof config !== 'object') {
            return { ok: false, config: null, errors: ['Test Mode configuration must be an object.'] };
        }
        if (typeof config.enabled !== 'boolean') errors.push('enabled must be true or false.');
        const entries = [];
        if (!Array.isArray(config.allowedOrigins)) {
            errors.push('allowedOrigins must be an array.');
        } else {
            for (const e of config.allowedOrigins) {
                const parsed = parseAllowedEntry(e);
                if (!parsed.ok) errors.push(parsed.error);
                else if (!entries.includes(parsed.value)) entries.push(parsed.value);
            }
            if (entries.length > MAX_TEST_ORIGINS) errors.push(`At most ${MAX_TEST_ORIGINS} allowed origins.`);
        }
        if (errors.length) return { ok: false, config: null, errors };
        const saved = { enabled: config.enabled, allowedOrigins: entries };
        await write('local', KEYS.testMode, saved);
        return { ok: true, config: saved, errors: [] };
    });

    // ---- test session (session area) -----------------------------------

    const getSessionStart = async () => {
        const v = await read('session', KEYS.sessionStart, null);
        return Number.isFinite(v) ? v : null;
    };

    const startSession = async (now = Date.now()) => {
        await write('session', KEYS.sessionStart, now);
        return now;
    };

    const clearSession = async () => {
        await area('session').remove(KEYS.sessionStart);
    };

    // ---- pending confirmation (session area) ----------------------------

    /**
     * Remembers that a shortcut/context menu needs the popup to confirm a
     * preset (domain-wide cookies are never run without confirmation).
     */
    const setPendingConfirmation = async ({ presetId, origin }, now = Date.now()) => {
        if (typeof presetId !== 'string' || !isExactOrigin(origin)) return false;
        await write('session', KEYS.pendingConfirmation, { presetId, origin, at: now });
        return true;
    };

    /**
     * Reads and removes the pending confirmation when it matches the origin
     * and is still fresh; returns null otherwise.
     */
    const takePendingConfirmation = async (origin, now = Date.now()) => {
        const pending = await read('session', KEYS.pendingConfirmation, null);
        if (!pending) return null;
        await area('session').remove(KEYS.pendingConfirmation);
        const fresh = Number.isFinite(pending.at) && now - pending.at >= 0 &&
            now - pending.at <= PENDING_CONFIRMATION_TTL_MS;
        if (!fresh || pending.origin !== origin || typeof pending.presetId !== 'string') return null;
        return { presetId: pending.presetId, origin: pending.origin, at: pending.at };
    };

    // ---- permission grant log ------------------------------------------

    const listPermissionGrants = async () => {
        const list = await read('local', KEYS.permissionGrants, []);
        return (Array.isArray(list) ? list : []).filter(g => g && isExactOrigin(g.origin));
    };

    const recordPermissionGrant = (origin, kind, now = Date.now()) => exclusive(async () => {
        if (!isExactOrigin(origin) || typeof kind !== 'string' || !GRANT_KIND_PATTERN.test(kind)) return false;
        const list = (await listPermissionGrants()).filter(g => !(g.origin === origin && g.kind === kind));
        list.push({ origin, kind, at: now });
        await write('local', KEYS.permissionGrants, list.slice(-MAX_PERMISSION_GRANTS));
        return true;
    });

    const removePermissionGrant = origin => exclusive(async () => {
        const list = await listPermissionGrants();
        const next = list.filter(g => g.origin !== origin);
        await write('local', KEYS.permissionGrants, next);
        return next.length !== list.length;
    });

    return {
        getCustomPresets,
        saveCustomPreset,
        deleteCustomPreset,
        getLastPreset,
        setLastPreset,
        getLastPresetForOrigin,
        clearLastPresetMemory,
        getRecentOrigins,
        addRecentOrigin,
        clearRecentOrigins,
        getHistory,
        addHistoryEntry,
        clearHistory,
        getHistoryEnabled,
        setHistoryEnabled,
        getTestMode,
        setTestMode,
        getSessionStart,
        startSession,
        clearSession,
        setPendingConfirmation,
        takePendingConfirmation,
        recordPermissionGrant,
        listPermissionGrants,
        removePermissionGrant
    };
}
