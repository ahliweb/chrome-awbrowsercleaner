/**
 * AW Browser Cleaner - Background service worker (MV3, ES module)
 *
 * Keyboard commands, context menus, badge feedback and Test Mode. Every
 * deletion goes through executePlan() from cleanup-core.js (Scope Guard); this
 * file never calls chrome.browsingData or chrome.cookies.remove itself.
 *
 * The worker is stateless: it can be suspended at any time, so all state lives
 * in chrome.storage (via settings.js). All listeners are registered
 * synchronously at module top level, as MV3 requires.
 */

import { validateOrigin } from './origin-utils.js';
import {
    createPlan,
    describePlan,
    confirmationLevel,
    executePlan
} from './cleanup-core.js';
import { getPreset, listPresets, presetToPlanInput } from './presets.js';
import { createSettings, isOriginAllowedForTestMode, KEYS } from './settings.js';
import { buildReport, historyEntry } from './report.js';
import { getMessage } from './i18n.js';
import { tabContext, getActiveTab, getCookieStoreId } from './chrome-helpers.js';

/** Preset used by the "last preset" shortcut when none has been used yet. */
export const DEFAULT_PRESET_ID = 'logout';

/** Badge appearance. `durationMs` is mutable so tests can shorten it. */
export const badgeSettings = {
    durationMs: 2000,
    texts: Object.freeze({ success: '✓', problem: '!' }),
    colors: Object.freeze({ success: '#1a7f37', problem: '#c62828', partial: '#b26a00' })
};

const MENU_PARENT_ID = 'aw-clean-with-preset';
const MENU_ITEM_PREFIX = 'aw-preset:';
const MENU_CONTEXTS = Object.freeze(['action', 'page']);

/** Keys in a Test Mode payload that could try to name a target. They are ignored. */
const PAYLOAD_ORIGIN_KEYS = Object.freeze(['origin', 'origins', 'target']);

/**
 * @returns {Object} The Chrome API object (read lazily so tests can install a fake).
 */
function chromeApi() {
    return globalThis.chrome;
}

// ---------------------------------------------------------------------------
// Badge feedback
// ---------------------------------------------------------------------------

/** Pending badge-clear timers by tab id (best effort; the worker may be suspended). */
const badgeTimers = new Map();

/**
 * Shows a badge on a tab for a short time, then clears it.
 *
 * @param {number|undefined} tabId - Tab id; nothing is shown without one.
 * @param {'success'|'problem'|'partial'} kind - Badge kind.
 * @returns {Promise<void>}
 */
async function flashBadge(tabId, kind) {
    if (!Number.isInteger(tabId)) return;
    const api = chromeApi();
    const text = kind === 'success' ? badgeSettings.texts.success : badgeSettings.texts.problem;
    try {
        await api.action.setBadgeBackgroundColor({ tabId, color: badgeSettings.colors[kind] });
        await api.action.setBadgeText({ tabId, text });
    } catch (e) {
        return; // the tab may be gone
    }
    clearTimeout(badgeTimers.get(tabId));
    badgeTimers.set(tabId, setTimeout(() => {
        badgeTimers.delete(tabId);
        Promise.resolve()
            .then(() => chromeApi().action.setBadgeText({ tabId, text: '' }))
            .catch(() => {});
    }, badgeSettings.durationMs));
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Environment info for evidence reports.
 * @returns {{extensionVersion: string|null, chromeVersion: string|null, timeZone: string}}
 */
function reportEnv() {
    let extensionVersion = null;
    try {
        extensionVersion = chromeApi().runtime.getManifest().version;
    } catch (e) {
        // leave null
    }
    const match = /Chrome\/([\d.]+)/.exec(globalThis.navigator?.userAgent || '');
    let timeZone = 'UTC';
    try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
        // keep UTC
    }
    return { extensionVersion, chromeVersion: match ? match[1] : null, timeZone };
}

/**
 * Persists "last used" state and a history entry after a successful cleanup.
 *
 * @param {Object} settings - Settings API.
 * @param {Object} plan - Executed plan.
 * @param {Object} result - executePlan result.
 * @param {string} presetId - Preset that ran.
 * @param {string} origin - Primary origin.
 * @returns {Promise<void>}
 */
async function recordSuccess(settings, plan, result, presetId, origin) {
    await settings.setLastPreset(presetId, origin);
    if (await settings.getHistoryEnabled()) {
        const report = buildReport({
            plan,
            description: describePlan(plan),
            before: null,
            after: null,
            result,
            env: reportEnv()
        });
        await settings.addHistoryEntry(historyEntry(report));
    }
    await settings.addRecentOrigin(origin);
}

/**
 * Opens the popup so the user can confirm a plan the worker must not run.
 * chrome.action.openPopup is not available everywhere, so failure is ignored.
 *
 * @returns {Promise<void>}
 */
async function openPopupForConfirmation() {
    try {
        await chromeApi().action.openPopup();
    } catch (e) {
        // unavailable or no window focused: the "!" badge is the only signal
    }
}

/**
 * Looks a preset up by id among built-ins and the user's custom presets.
 *
 * @param {Object} settings - Settings API.
 * @param {string} presetId - Preset id.
 * @returns {Promise<Object|null>} The preset, or null.
 */
async function findPreset(settings, presetId) {
    return getPreset(presetId, await settings.getCustomPresets());
}

// ---------------------------------------------------------------------------
// Shortcut / context menu cleanup
// ---------------------------------------------------------------------------

/**
 * Runs a preset on the exact origin of a tab and shows badge feedback.
 *
 * Plans that need confirmation in the popup (domain-wide or shared cookies)
 * are never executed here: the popup is opened instead.
 *
 * @param {string} presetId - Built-in or custom preset id.
 * @param {{id?: number, url?: string}|null|undefined} tab - Target tab (activeTab granted by the caller).
 * @param {'shortcut'|'contextMenu'} [source] - What triggered the run.
 * @returns {Promise<{ok: boolean, status: string, origin?: string, result?: Object, error?: string}>}
 *   status is one of: unsupported, unknown-preset, invalid-plan, confirmation-required,
 *   blocked, success, partial, error.
 */
export async function runPresetOnTab(presetId, tab, source = 'shortcut') {
    const api = chromeApi();
    const tabId = tab && Number.isInteger(tab.id) ? tab.id : undefined;
    try {
        const ctx = await tabContext(api, tab);
        if (!ctx) {
            await flashBadge(tabId, 'problem');
            return { ok: false, status: 'unsupported' };
        }

        const settings = createSettings();
        const preset = await findPreset(settings, presetId);
        if (!preset) {
            await flashBadge(tabId, 'problem');
            return { ok: false, status: 'unknown-preset', origin: ctx.origin };
        }

        const { input } = presetToPlanInput(preset, { origin: ctx.origin, tab: ctx, source });
        const created = createPlan(input);
        if (!created.ok) {
            await flashBadge(tabId, 'problem');
            return { ok: false, status: 'invalid-plan', origin: ctx.origin, error: created.code };
        }
        const { plan } = created;

        if (confirmationLevel(plan) === 'danger') {
            await flashBadge(tabId, 'problem');
            // The popup picks this up and opens the confirmation for this preset.
            await settings.setPendingConfirmation({ presetId, origin: ctx.origin });
            await openPopupForConfirmation();
            return { ok: false, status: 'confirmation-required', origin: ctx.origin };
        }

        let result;
        try {
            result = await executePlan(plan, { api });
        } catch (e) {
            await flashBadge(tabId, 'problem');
            return { ok: false, status: 'blocked', origin: ctx.origin, error: String(e && e.message ? e.message : e) };
        }

        if (!result.ok) {
            await flashBadge(tabId, 'partial');
            return { ok: false, status: 'partial', origin: ctx.origin, result };
        }
        await recordSuccess(settings, plan, result, preset.id, ctx.origin);
        await flashBadge(tabId, 'success');
        return { ok: true, status: 'success', origin: ctx.origin, result };
    } catch (e) {
        await flashBadge(tabId, 'problem');
        return { ok: false, status: 'error', error: String(e && e.message ? e.message : e) };
    }
}

/**
 * Handles a keyboard command.
 *
 * @param {string} command - Command name from the manifest.
 * @param {Object|undefined} tab - Tab the command ran in (activeTab granted).
 * @returns {Promise<void>}
 */
export async function handleCommand(command, tab) {
    if (command !== 'clean-last-preset' && command !== 'clean-logout') return;
    const target = tab || await getActiveTab(chromeApi());
    if (command === 'clean-logout') {
        await runPresetOnTab('logout', target, 'shortcut');
        return;
    }
    const settings = createSettings();
    let presetId = DEFAULT_PRESET_ID;
    try {
        const last = await settings.getLastPreset();
        // A deleted custom preset falls back to the default instead of failing.
        if (last && await findPreset(settings, last)) presetId = last;
    } catch (e) {
        // storage unavailable: use the default
    }
    await runPresetOnTab(presetId, target, 'shortcut');
}

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------

/**
 * Escapes "%" so a preset name is not read as a context-menu substitution.
 * @param {string} title - Raw title.
 * @returns {string} Safe title.
 */
function menuTitle(title) {
    return String(title).replace(/%/g, '%%');
}

/**
 * Display name of a preset (localized for built-ins).
 * @param {Object} preset - Preset.
 * @returns {string} Name.
 */
function presetName(preset) {
    return preset.builtin && preset.nameKey ? getMessage(preset.nameKey) : String(preset.name || preset.id);
}

/**
 * Creates one context menu item, swallowing "already exists" style errors.
 * @param {Object} properties - chrome.contextMenus.create properties.
 * @returns {void}
 */
function createMenuItem(properties) {
    chromeApi().contextMenus.create(properties, () => {
        void chromeApi().runtime.lastError; // read to silence "unchecked lastError"
    });
}

let menuQueue = Promise.resolve();

/**
 * Rebuilds the context menu: a parent item and one child per preset
 * (built-ins first, then custom presets). Rebuilds are serialized.
 *
 * @returns {Promise<void>}
 */
export function rebuildContextMenus() {
    const run = async () => {
        const api = chromeApi();
        let custom = [];
        try {
            custom = await createSettings().getCustomPresets();
        } catch (e) {
            // storage unavailable: built-ins only
        }
        // removeAll() clears the items of BOTH instances in split incognito mode (verified in E2E), so the
        // incognito instance only creates its own items (duplicates are ignored by createMenuItem).
        if (!api.extension || !api.extension.inIncognitoContext) await api.contextMenus.removeAll();
        createMenuItem({
            id: MENU_PARENT_ID,
            title: menuTitle(getMessage('menuCleanWithPreset')),
            contexts: [...MENU_CONTEXTS]
        });
        for (const preset of listPresets(custom)) {
            createMenuItem({
                id: MENU_ITEM_PREFIX + preset.id,
                parentId: MENU_PARENT_ID,
                title: menuTitle(presetName(preset)),
                contexts: [...MENU_CONTEXTS]
            });
        }
    };
    menuQueue = menuQueue.then(run, run);
    return menuQueue.catch(() => {});
}

/**
 * Handles a context menu click.
 *
 * @param {{menuItemId: string|number}} info - Click info.
 * @param {Object|undefined} tab - Tab clicked in (activeTab granted).
 * @returns {Promise<void>}
 */
export async function handleMenuClick(info, tab) {
    const id = String(info && info.menuItemId);
    if (!id.startsWith(MENU_ITEM_PREFIX)) return;
    await runPresetOnTab(id.slice(MENU_ITEM_PREFIX.length), tab, 'contextMenu');
}

// ---------------------------------------------------------------------------
// Test Mode (chrome.runtime.onMessageExternal)
// ---------------------------------------------------------------------------

/**
 * Whether a value is a non-null, non-array object.
 * @param {*} value - Value to test.
 * @returns {boolean} True for plain-object-like values.
 */
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Determines the origin of a message sender. The payload is never consulted.
 *
 * @param {Object} sender - runtime.MessageSender.
 * @returns {string} Origin string, or '' when unknown.
 */
function senderOrigin(sender) {
    if (!isObject(sender)) return '';
    if (typeof sender.origin === 'string' && sender.origin) return sender.origin;
    try {
        return new URL(sender.url).origin;
    } catch (e) {
        return '';
    }
}

/**
 * Value-free view of an execution result for a Test Mode caller.
 *
 * @param {Object} result - executePlan result.
 * @returns {Object} Safe result.
 */
function publicResult(result) {
    return {
        ok: result.ok,
        durationMs: result.durationMs,
        perOrigin: result.perOrigin.map(o => ({
            origin: o.origin,
            types: { ...o.types },
            cookies: o.cookies ? { ...o.cookies } : null,
            errors: o.errors.map(e => ({ type: e.type, code: e.code, message: e.message }))
        })),
        after: { action: result.after.action, ok: result.after.ok }
    };
}

/**
 * Runs a preset for a Test Mode caller on the caller's own origin.
 *
 * @param {string} presetId - Preset id from the payload.
 * @param {Object} sender - runtime.MessageSender of the page.
 * @param {Object} config - Test Mode configuration (enabled).
 * @param {Object} settings - Settings API.
 * @returns {Promise<Object>} Response object (without ignoredPayloadOrigin).
 */
async function testModeClean(presetId, sender, config, settings) {
    const api = chromeApi();
    const origin = senderOrigin(sender);
    const check = validateOrigin(origin);
    if (!check.valid || check.origin !== origin || !isOriginAllowedForTestMode(origin, config)) {
        return { ok: false, error: 'ORIGIN_NOT_ALLOWED' };
    }

    const preset = await findPreset(settings, presetId);
    if (!preset) return { ok: false, error: 'PRESET_NOT_FOUND' };

    const wantsCookies = Array.isArray(preset.dataTypes) && preset.dataTypes.includes('cookies');
    if (wantsCookies && preset.cookieMode === 'domainWide') {
        return { ok: false, error: 'DOMAIN_WIDE_NOT_ALLOWED', origin, presetId };
    }

    // A page may only clean itself: extra preset origins are dropped. The
    // extension has no activeTab here, so sessionStorage is dropped as well
    // (the page can clear its own).
    const dropped = [];
    const dataTypes = (preset.dataTypes || []).filter(t => t !== 'sessionStorage');
    if (dataTypes.length !== (preset.dataTypes || []).length) {
        dropped.push({ type: 'sessionStorage', reason: 'testModeNoActiveTab' });
    }
    const scoped = { ...preset, dataTypes, origins: [], cookieMode: 'exact' };

    // After-actions need a top-level tab of the sender's own origin.
    let tab = null;
    if (isObject(sender.tab) && Number.isInteger(sender.tab.id) && !sender.frameId) {
        tab = { id: sender.tab.id, origin, storeId: await getCookieStoreId(api, sender.tab.id) };
    }

    const { input, dropped: droppedByTab } = presetToPlanInput(scoped, { origin, tab, source: 'testMode' });
    dropped.push(...droppedByTab);

    const created = createPlan(input);
    if (!created.ok) {
        return { ok: false, error: 'PLAN_INVALID', code: created.code, origin, presetId, dropped };
    }
    if (confirmationLevel(created.plan) === 'danger') {
        return { ok: false, error: 'DOMAIN_WIDE_NOT_ALLOWED', origin, presetId, dropped };
    }

    let result;
    try {
        result = await executePlan(created.plan, { api });
    } catch (e) {
        return { ok: false, error: 'SCOPE_GUARD', message: String(e && e.message ? e.message : e), origin, presetId, dropped };
    }
    return { ok: result.ok, origin, presetId: preset.id, result: publicResult(result), dropped };
}

/**
 * Handles an external message from a page allowed by externally_connectable.
 *
 * Actions: `{ action: 'ping' }` and `{ action: 'clean', preset }`. The target
 * origin is always the sender's own origin; any origin named in the payload is
 * ignored.
 *
 * @param {*} message - Message from the page.
 * @param {Object} sender - runtime.MessageSender.
 * @returns {Promise<Object>} Response (never contains cookie values).
 */
export async function handleExternalMessage(message, sender) {
    if (!isObject(message) || typeof message.action !== 'string') {
        return { ok: false, error: 'BAD_REQUEST' };
    }
    const settings = createSettings();

    if (message.action === 'ping') {
        const config = await settings.getTestMode();
        return { ok: true, enabled: config.enabled === true };
    }
    if (message.action !== 'clean') {
        return { ok: false, error: 'UNKNOWN_ACTION' };
    }
    if (typeof message.preset !== 'string' || !message.preset) {
        return { ok: false, error: 'BAD_REQUEST' };
    }

    const config = await settings.getTestMode();
    if (config.enabled !== true) {
        return { ok: false, error: 'TEST_MODE_DISABLED' };
    }

    const response = await testModeClean(message.preset, sender, config, settings);
    if (PAYLOAD_ORIGIN_KEYS.some(key => key in message)) {
        response.ignoredPayloadOrigin = true;
    }
    return response;
}

// ---------------------------------------------------------------------------
// Listeners (registered synchronously at top level)
// ---------------------------------------------------------------------------

chrome.commands.onCommand.addListener((command, tab) => {
    handleCommand(command, tab).catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    handleMenuClick(info, tab).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
    rebuildContextMenus();
});

// manifest "incognito": "split" gives an incognito window its own instance of this worker, which never
// receives onInstalled. Context menus are per instance, so that instance creates its own at startup.
if (chrome.extension && chrome.extension.inIncognitoContext) {
    rebuildContextMenus();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (Object.keys(changes || {}).some(key => key.startsWith(KEYS.presetPrefix))) {
        rebuildContextMenus();
    }
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    handleExternalMessage(message, sender).then(
        sendResponse,
        () => sendResponse({ ok: false, error: 'INTERNAL_ERROR' })
    );
    return true; // asynchronous response
});

// For E2E tests: reachable from extension contexts only (service worker console).
globalThis.awCleaner = { runPresetOnTab, handleExternalMessage };
