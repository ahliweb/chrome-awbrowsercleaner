/**
 * Unit tests for background.js (service worker) with an in-memory fake `chrome`.
 */

import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'bun:test';

const ORIGIN = 'https://app.example.test';
const TAB = { id: 1, url: `${ORIGIN}/some/path?x=1#hash` };
const SECRET = 'SECRET-COOKIE-VALUE';
const TM_ORIGIN = 'http://localhost:3000';

const MESSAGES = {
    menuCleanWithPreset: 'Clean this origin with preset…',
    presetLogout: 'Log out',
    presetFresh: 'Fresh start',
    presetStale: 'Stale assets',
    presetFull: 'Full reset'
};

/** A tiny chrome event: addListener plus a fire() helper for tests. */
function makeEvent() {
    const listeners = [];
    return {
        listeners,
        addListener: fn => { listeners.push(fn); },
        fire: (...args) => Promise.all(listeners.map(fn => fn(...args)))
    };
}

/** In-memory StorageArea that mimics chrome.storage (async, structured-clone like). */
function makeArea(name, onChanged) {
    const data = new Map();
    const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
    return {
        data,
        async get(keys) {
            await Promise.resolve();
            if (keys === null || keys === undefined) return Object.fromEntries([...data].map(([k, v]) => [k, clone(v)]));
            const list = typeof keys === 'string' ? [keys] : keys;
            const out = {};
            for (const k of list) if (data.has(k)) out[k] = clone(data.get(k));
            return out;
        },
        async set(items) {
            await Promise.resolve();
            const changes = {};
            for (const [k, v] of Object.entries(items)) {
                changes[k] = { oldValue: clone(data.get(k)), newValue: clone(v) };
                data.set(k, clone(v));
            }
            onChanged.fire(changes, name);
        },
        async remove(keys) {
            await Promise.resolve();
            const changes = {};
            for (const k of (typeof keys === 'string' ? [keys] : keys)) {
                if (data.has(k)) changes[k] = { oldValue: clone(data.get(k)) };
                data.delete(k);
            }
            if (Object.keys(changes).length) onChanged.fire(changes, name);
        }
    };
}

/**
 * Fake `chrome`. Listeners survive reset() because background.js registers
 * them once, when it is imported.
 */
function createFakeChrome() {
    const calls = [];
    const state = {
        badge: new Map(),
        menus: [],
        granted: new Set(),
        cookies: [],
        stores: [{ id: '0', tabIds: [1] }],
        activeTab: null,
        openPopupError: null
    };
    const rec = (name, impl) => (...args) => {
        calls.push([name, ...args]);
        return impl ? impl(...args) : undefined;
    };
    const onChanged = makeEvent();

    const chrome = {
        runtime: {
            onInstalled: makeEvent(),
            onMessageExternal: makeEvent(),
            lastError: undefined,
            getManifest: () => ({ version: '1.2.0' })
        },
        commands: { onCommand: makeEvent() },
        i18n: { getMessage: key => MESSAGES[key] || '' },
        contextMenus: {
            onClicked: makeEvent(),
            removeAll: rec('contextMenus.removeAll', async () => { state.menus.length = 0; }),
            create: rec('contextMenus.create', (props, cb) => {
                state.menus.push(props);
                if (cb) cb();
                return props.id;
            })
        },
        action: {
            setBadgeText: rec('action.setBadgeText', async ({ tabId, text }) => {
                state.badge.set(tabId, { ...(state.badge.get(tabId) || {}), text });
            }),
            setBadgeBackgroundColor: rec('action.setBadgeBackgroundColor', async ({ tabId, color }) => {
                state.badge.set(tabId, { ...(state.badge.get(tabId) || {}), color });
            }),
            openPopup: rec('action.openPopup', async () => {
                if (state.openPopupError) throw state.openPopupError;
            })
        },
        tabs: {
            query: rec('tabs.query', async () => (state.activeTab ? [state.activeTab] : [])),
            reload: rec('tabs.reload', async () => {}),
            update: rec('tabs.update', async () => {})
        },
        storage: {
            onChanged,
            sync: makeArea('sync', onChanged),
            local: makeArea('local', onChanged),
            session: makeArea('session', onChanged)
        },
        permissions: {
            contains: rec('permissions.contains', async ({ origins }) => origins.every(o => state.granted.has(o)))
        },
        cookies: {
            getAllCookieStores: rec('cookies.getAllCookieStores', async () => state.stores),
            getAll: rec('cookies.getAll', async () => state.cookies),
            remove: rec('cookies.remove', async details => ({ name: details.name }))
        },
        scripting: {
            executeScript: rec('scripting.executeScript', async () => [{ frameId: 0, result: { cleared: true, count: 1 } }])
        },
        browsingData: {
            remove: rec('browsingData.remove', async () => {})
        }
    };

    const reset = () => {
        calls.length = 0;
        state.badge.clear();
        state.menus.length = 0;
        state.granted = new Set([`${ORIGIN}/*`, `${TM_ORIGIN}/*`]);
        state.cookies = [
            { name: 'sid', value: SECRET, domain: 'app.example.test', hostOnly: true, path: '/', secure: true, storeId: '0' },
            { name: 'shared', value: SECRET, domain: '.example.test', hostOnly: false, path: '/', secure: true, storeId: '0' },
            { name: 'foreign', value: SECRET, domain: 'other.example.org', hostOnly: true, path: '/', secure: true, storeId: '0' }
        ];
        state.stores = [{ id: '0', tabIds: [1, 5] }];
        state.activeTab = null;
        state.openPopupError = null;
        for (const area of [chrome.storage.sync, chrome.storage.local, chrome.storage.session]) area.data.clear();
    };
    reset();

    return { chrome, calls, state, reset };
}

const fake = createFakeChrome();
const originalChrome = globalThis.chrome;
let bg;

beforeAll(async () => {
    globalThis.chrome = fake.chrome;
    bg = await import('../../background.js');
    bg.badgeSettings.durationMs = 25;
});

afterAll(() => {
    globalThis.chrome = originalChrome;
});

beforeEach(() => {
    globalThis.chrome = fake.chrome;
    fake.reset();
});

const names = () => fake.calls.map(c => c[0]);
const callsOf = name => fake.calls.filter(c => c[0] === name);
const badge = (tabId = 1) => fake.state.badge.get(tabId);
const syncSet = items => fake.chrome.storage.sync.set(items);
const localSet = items => fake.chrome.storage.local.set(items);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Waits (up to ~1 s) until a condition holds. */
async function until(condition) {
    for (let i = 0; i < 100; i++) {
        if (condition()) return;
        await sleep(10);
    }
    throw new Error('condition not met in time');
}

/** Calls that can touch user data. */
const DESTRUCTIVE = /^(browsingData\.|cookies\.(getAll|remove)$|scripting\.|permissions\.|tabs\.(reload|update)$)/;
const destructiveCalls = () => fake.calls.filter(c => DESTRUCTIVE.test(c[0]));

const wideCustomPreset = {
    id: 'wide', name: 'Wide cookies', dataTypes: ['cookies'], cookieMode: 'domainWide', after: 'none', startPath: '/'
};

/** Sends an external message through the registered listener, like Chrome does. */
function sendExternal(message, sender) {
    const listener = fake.chrome.runtime.onMessageExternal.listeners[0];
    return new Promise((resolve, reject) => {
        const returned = listener(message, sender, resolve);
        if (returned !== true) reject(new Error('listener must return true for async responses'));
    });
}

const testModeSender = (extra = {}) => ({
    origin: TM_ORIGIN, url: `${TM_ORIGIN}/page`, frameId: 0, tab: { id: 5, url: `${TM_ORIGIN}/page` }, ...extra
});
const enableTestMode = (allowedOrigins = ['http://localhost']) =>
    localSet({ 'aw.testMode': { enabled: true, allowedOrigins } });

describe('module setup', () => {
    test('registers every listener synchronously and exposes awCleaner', () => {
        expect(fake.chrome.commands.onCommand.listeners).toHaveLength(1);
        expect(fake.chrome.contextMenus.onClicked.listeners).toHaveLength(1);
        expect(fake.chrome.runtime.onInstalled.listeners).toHaveLength(1);
        expect(fake.chrome.runtime.onMessageExternal.listeners).toHaveLength(1);
        expect(fake.chrome.storage.onChanged.listeners).toHaveLength(1);
        expect(globalThis.awCleaner.runPresetOnTab).toBe(bg.runPresetOnTab);
        expect(globalThis.awCleaner.handleExternalMessage).toBe(bg.handleExternalMessage);
    });
});

describe('runPresetOnTab: unsupported pages', () => {
    const unsupported = [
        'chrome://extensions',
        'file:///home/user/a.html',
        'about:blank',
        'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
        'https://chromewebstore.google.com/detail/some-extension/abc',
        'https://chrome.google.com/webstore/category/extensions',
        'view-source:https://app.example.test/',
        undefined
    ];

    for (const url of unsupported) {
        test(`shows "!" and makes no API calls for ${url}`, async () => {
            const res = await bg.runPresetOnTab('logout', { id: 1, url }, 'shortcut');
            expect(res.status).toBe('unsupported');
            expect(badge()).toEqual({ text: '!', color: '#c62828' });
            expect(names().filter(n => !n.startsWith('action.'))).toEqual([]);
        });
    }

    test('a missing tab does nothing', async () => {
        const res = await bg.runPresetOnTab('logout', undefined, 'shortcut');
        expect(res.status).toBe('unsupported');
        expect(fake.calls).toEqual([]);
    });
});

describe('runPresetOnTab: normal tabs', () => {
    test('logout cleans only the tab\'s exact origin and shows a green check', async () => {
        const res = await bg.runPresetOnTab('logout', TAB, 'shortcut');
        expect(res.ok).toBe(true);
        expect(res.status).toBe('success');
        expect(res.origin).toBe(ORIGIN);
        expect(badge()).toEqual({ text: '✓', color: '#1a7f37' });

        // Cookies: only the host-only cookie of the exact host is removed.
        const removals = callsOf('cookies.remove').map(c => c[1]);
        expect(removals).toHaveLength(1);
        expect(removals[0].name).toBe('sid');
        expect(removals[0].url.startsWith(`${ORIGIN}/`)).toBe(true);
        expect(removals[0].storeId).toBe('0');

        // sessionStorage: this tab only, filtered to the exact origin.
        const scripts = callsOf('scripting.executeScript').map(c => c[1]);
        expect(scripts).toHaveLength(1);
        expect(scripts[0].target.tabId).toBe(1);
        expect(scripts[0].args).toEqual([ORIGIN]);

        // Permission check names the exact origin; reload is the after-action.
        expect(callsOf('permissions.contains').map(c => c[1])).toEqual([{ origins: [`${ORIGIN}/*`] }]);
        expect(callsOf('tabs.reload').map(c => c[1])).toEqual([1]);

        // Nothing in any data-touching call refers to another host.
        const text = JSON.stringify(destructiveCalls().filter(c => c[0] !== 'cookies.getAll'));
        expect(text).not.toContain('other.example.org');
        expect(callsOf('browsingData.remove')).toEqual([]);
    });

    test('fresh passes only the exact origin to browsingData and navigates to the start path', async () => {
        const res = await bg.runPresetOnTab('fresh', TAB, 'contextMenu');
        expect(res.status).toBe('success');
        const removals = callsOf('browsingData.remove');
        expect(removals).toHaveLength(1);
        const [, options, types] = removals[0];
        expect(options).toEqual({ origins: [ORIGIN], originTypes: { unprotectedWeb: true } });
        expect(types.cookies).toBeUndefined();
        expect(types.localStorage).toBe(true);
        expect(callsOf('tabs.update').map(c => c[2])).toEqual([{ url: `${ORIGIN}/` }]);
    });

    test('records last preset, history entry and recent origin without cookie values', async () => {
        await bg.runPresetOnTab('logout', TAB, 'shortcut');
        const sync = fake.chrome.storage.sync.data;
        const local = fake.chrome.storage.local.data;
        expect(sync.get('aw.lastPreset')).toBe('logout');
        expect(local.get('aw.lastPresetByOrigin')).toEqual([{ origin: ORIGIN, presetId: 'logout' }]);
        const history = local.get('aw.history');
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ origins: [ORIGIN], presetId: 'logout', ok: true });
        expect(local.get('aw.recentOrigins')[0].origin).toBe(ORIGIN);
        expect(JSON.stringify([...sync, ...local])).not.toContain(SECRET);
    });

    test('skips the history entry when history is disabled but still remembers the preset', async () => {
        await localSet({ 'aw.historyEnabled': false });
        await bg.runPresetOnTab('logout', TAB, 'shortcut');
        expect(fake.chrome.storage.local.data.get('aw.history')).toBeUndefined();
        expect(fake.chrome.storage.sync.data.get('aw.lastPreset')).toBe('logout');
    });

    test('a missing cookie permission is a partial result: amber "!" and nothing remembered', async () => {
        fake.state.granted.clear();
        const res = await bg.runPresetOnTab('logout', TAB, 'shortcut');
        expect(res.status).toBe('partial');
        expect(badge()).toEqual({ text: '!', color: '#b26a00' });
        expect(callsOf('cookies.remove')).toEqual([]);
        expect(fake.chrome.storage.sync.data.get('aw.lastPreset')).toBeUndefined();
        expect(fake.chrome.storage.local.data.get('aw.history')).toBeUndefined();
    });

    test('the badge clears itself after the display time', async () => {
        await bg.runPresetOnTab('logout', TAB, 'shortcut');
        expect(badge().text).toBe('✓');
        await until(() => badge().text === '');
        expect(callsOf('action.setBadgeText').at(-1)[1]).toEqual({ tabId: 1, text: '' });
    });

    test('an unknown preset shows "!" and calls no data API', async () => {
        const res = await bg.runPresetOnTab('does-not-exist', TAB, 'shortcut');
        expect(res.status).toBe('unknown-preset');
        expect(badge().text).toBe('!');
        expect(destructiveCalls().filter(c => c[0] !== 'cookies.getAllCookieStores')).toEqual([]);
    });

    test('a custom preset runs with its own data types', async () => {
        await syncSet({
            'aw.preset.cache-only': { id: 'cache-only', name: 'Cache only', dataTypes: ['cache'], cookieMode: 'exact', after: 'none', startPath: '/' }
        });
        const res = await bg.runPresetOnTab('cache-only', TAB, 'shortcut');
        expect(res.status).toBe('success');
        expect(callsOf('browsingData.remove')[0][2]).toEqual({ cache: true });
        expect(callsOf('tabs.reload')).toEqual([]);
    });
});

describe('runPresetOnTab: confirmation is never bypassed', () => {
    test('a domain-wide cookie preset is not executed; the popup is opened', async () => {
        await syncSet({ 'aw.preset.wide': wideCustomPreset });
        const res = await bg.runPresetOnTab('wide', TAB, 'shortcut');
        expect(res.status).toBe('confirmation-required');
        expect(badge().text).toBe('!');
        expect(callsOf('action.openPopup')).toHaveLength(1);
        expect(callsOf('browsingData.remove')).toEqual([]);
        expect(callsOf('cookies.remove')).toEqual([]);
        expect(callsOf('scripting.executeScript')).toEqual([]);
        expect(fake.chrome.storage.sync.data.get('aw.lastPreset')).toBeUndefined();
    });

    test('an unavailable openPopup is tolerated', async () => {
        await syncSet({ 'aw.preset.wide': wideCustomPreset });
        fake.state.openPopupError = new Error('openPopup() is not available');
        const res = await bg.runPresetOnTab('wide', TAB, 'contextMenu');
        expect(res.status).toBe('confirmation-required');
        expect(callsOf('browsingData.remove')).toEqual([]);
        expect(callsOf('cookies.remove')).toEqual([]);
    });
});

describe('commands', () => {
    const fire = (command, tab = TAB) => fake.chrome.commands.onCommand.fire(command, tab);

    test('clean-logout runs the Logout preset on the tab', async () => {
        await localSet({});
        await syncSet({ 'aw.lastPreset': 'fresh' });
        await fire('clean-logout');
        await until(() => badge()?.text === '✓');
        expect(callsOf('cookies.remove')).toHaveLength(1);
        expect(callsOf('browsingData.remove')).toEqual([]);
    });

    test('clean-last-preset runs the last used preset', async () => {
        await syncSet({ 'aw.lastPreset': 'stale' });
        await fire('clean-last-preset');
        await until(() => badge()?.text === '✓');
        expect(callsOf('browsingData.remove')[0][2]).toEqual({ cache: true, cacheStorage: true, serviceWorkers: true });
        expect(callsOf('tabs.reload').map(c => c[2])).toEqual([{ bypassCache: true }]);
        expect(callsOf('cookies.remove')).toEqual([]);
    });

    test('clean-last-preset defaults to Logout when nothing was used yet', async () => {
        await fire('clean-last-preset');
        await until(() => badge()?.text === '✓');
        expect(callsOf('cookies.remove')).toHaveLength(1);
        expect(fake.chrome.storage.sync.data.get('aw.lastPreset')).toBe('logout');
    });

    test('clean-last-preset falls back to Logout when the last custom preset was deleted', async () => {
        await syncSet({ 'aw.lastPreset': 'gone' });
        await fire('clean-last-preset');
        await until(() => badge()?.text === '✓');
        expect(callsOf('cookies.remove')).toHaveLength(1);
    });

    test('uses the active tab when Chrome passes no tab', async () => {
        fake.state.activeTab = TAB;
        await fire('clean-logout', null);
        await until(() => badge()?.text === '✓');
        expect(callsOf('tabs.query')).toHaveLength(1);
    });

    test('a command on an unsupported page only shows "!"', async () => {
        await fire('clean-logout', { id: 1, url: 'chrome://settings' });
        await until(() => badge()?.text === '!');
        expect(names().filter(n => !n.startsWith('action.'))).toEqual([]);
    });

    test('unknown commands are ignored', async () => {
        await fire('something-else');
        await sleep(20);
        expect(names().filter(n => !n.startsWith('action.'))).toEqual([]);
    });
});

describe('context menus', () => {
    const titles = () => fake.state.menus.map(m => m.title);

    test('onInstalled builds a parent item and one child per built-in preset', async () => {
        await fake.chrome.runtime.onInstalled.fire({ reason: 'install' });
        await bg.rebuildContextMenus();
        const [parent, ...children] = fake.state.menus;
        expect(parent).toMatchObject({ title: 'Clean this origin with preset…', contexts: ['action', 'page'] });
        expect(parent.parentId).toBeUndefined();
        expect(children.map(c => c.id)).toEqual(['aw-preset:logout', 'aw-preset:fresh', 'aw-preset:stale', 'aw-preset:full']);
        expect(children.map(c => c.title)).toEqual(['Log out', 'Fresh start', 'Stale assets', 'Full reset']);
        for (const child of children) {
            expect(child.parentId).toBe(parent.id);
            expect(child.contexts).toEqual(['action', 'page']);
        }
    });

    test('is rebuilt with custom presets when they change in storage', async () => {
        await bg.rebuildContextMenus();
        expect(fake.state.menus).toHaveLength(5);
        await syncSet({
            'aw.preset.mine': { id: 'mine', name: '100% mine', dataTypes: ['localStorage'], cookieMode: 'exact', after: 'none', startPath: '/' }
        });
        await until(() => fake.state.menus.length === 6);
        expect(fake.state.menus.at(-1)).toMatchObject({ id: 'aw-preset:mine', title: '100%% mine' });
        expect(titles().slice(1, 5)).toEqual(['Log out', 'Fresh start', 'Stale assets', 'Full reset']);

        await fake.chrome.storage.sync.remove('aw.preset.mine');
        await until(() => fake.state.menus.length === 5);
    });

    test('ignores storage changes that are not presets', async () => {
        await bg.rebuildContextMenus();
        const before = callsOf('contextMenus.removeAll').length;
        await localSet({ 'aw.preset.local-only': {} });
        await syncSet({ 'aw.lastPreset': 'fresh' });
        await sleep(30);
        expect(callsOf('contextMenus.removeAll')).toHaveLength(before);
    });

    test('clicking a preset runs it on the clicked tab', async () => {
        await fake.chrome.contextMenus.onClicked.fire({ menuItemId: 'aw-preset:logout' }, TAB);
        await until(() => badge()?.text === '✓');
        expect(callsOf('cookies.remove')).toHaveLength(1);
    });

    test('clicking the parent item or an unrelated item does nothing', async () => {
        await fake.chrome.contextMenus.onClicked.fire({ menuItemId: 'aw-clean-with-preset' }, TAB);
        await fake.chrome.contextMenus.onClicked.fire({ menuItemId: 'other' }, TAB);
        await sleep(20);
        // (a badge timer from an earlier test may still fire its clear call)
        expect(names().filter(n => !n.startsWith('action.'))).toEqual([]);
        expect(callsOf('action.setBadgeText').filter(c => c[1].text !== '')).toEqual([]);
    });
});

describe('Test Mode', () => {
    test('ping reports whether Test Mode is enabled', async () => {
        expect(await sendExternal({ action: 'ping' }, testModeSender())).toEqual({ ok: true, enabled: false });
        await enableTestMode();
        expect(await sendExternal({ action: 'ping' }, testModeSender())).toEqual({ ok: true, enabled: true });
    });

    test('clean is refused while Test Mode is disabled', async () => {
        const res = await sendExternal({ action: 'clean', preset: 'logout' }, testModeSender());
        expect(res).toEqual({ ok: false, error: 'TEST_MODE_DISABLED' });
        expect(destructiveCalls()).toEqual([]);
    });

    test('malformed messages and unknown actions', async () => {
        await enableTestMode();
        for (const bad of [null, undefined, 'clean', 42, [], {}, { action: 7 }, { action: 'clean' }, { action: 'clean', preset: 5 }]) {
            expect(await sendExternal(bad, testModeSender())).toEqual({ ok: false, error: 'BAD_REQUEST' });
        }
        expect(await sendExternal({ action: 'wipe-everything' }, testModeSender())).toEqual({ ok: false, error: 'UNKNOWN_ACTION' });
        expect(destructiveCalls()).toEqual([]);
    });

    test('the sender origin is used and a payload origin is ignored', async () => {
        await enableTestMode();
        const res = await sendExternal(
            { action: 'clean', preset: 'fresh', origin: 'https://victim.test', origins: ['https://victim.test'], target: 'https://victim.test' },
            testModeSender()
        );
        expect(res.ok).toBe(true);
        expect(res.origin).toBe(TM_ORIGIN);
        expect(res.ignoredPayloadOrigin).toBe(true);
        expect(res.presetId).toBe('fresh');
        expect(res.result.perOrigin.map(o => o.origin)).toEqual([TM_ORIGIN]);

        const removal = callsOf('browsingData.remove');
        expect(removal.length).toBeGreaterThan(0);
        for (const call of removal) expect(call[1].origins).toEqual([TM_ORIGIN]);
        expect(JSON.stringify(fake.calls)).not.toContain('victim.test');
    });

    test('ignoredPayloadOrigin is absent when no origin was sent', async () => {
        await enableTestMode();
        const res = await sendExternal({ action: 'clean', preset: 'stale' }, testModeSender());
        expect(res.ok).toBe(true);
        expect('ignoredPayloadOrigin' in res).toBe(false);
    });

    test('falls back to sender.url when sender.origin is missing', async () => {
        await enableTestMode();
        const res = await sendExternal({ action: 'clean', preset: 'stale' }, testModeSender({ origin: undefined }));
        expect(res.origin).toBe(TM_ORIGIN);
    });

    test('a sender outside the allow-list is rejected before any API call', async () => {
        await enableTestMode(['http://localhost']);
        for (const sender of [
            { origin: 'https://evil.test', url: 'https://evil.test/' },
            { origin: 'http://127.0.0.1:3000', url: 'http://127.0.0.1:3000/' },
            { origin: 'https://localhost:3000', url: 'https://localhost:3000/' },
            { origin: 'null', url: 'about:blank' },
            {}
        ]) {
            const res = await sendExternal({ action: 'clean', preset: 'logout', origin: TM_ORIGIN }, sender);
            expect(res.ok).toBe(false);
            expect(res.error).toBe('ORIGIN_NOT_ALLOWED');
        }
        expect(destructiveCalls()).toEqual([]);
    });

    test('an exact-port allow-list entry only matches that port', async () => {
        await enableTestMode(['http://localhost:4000']);
        const res = await sendExternal({ action: 'clean', preset: 'stale' }, testModeSender());
        expect(res).toEqual({ ok: false, error: 'ORIGIN_NOT_ALLOWED' });
    });

    test('domain-wide cookie presets are rejected', async () => {
        await enableTestMode();
        await syncSet({ 'aw.preset.wide': wideCustomPreset });
        const res = await sendExternal({ action: 'clean', preset: 'wide' }, testModeSender());
        expect(res.ok).toBe(false);
        expect(res.error).toBe('DOMAIN_WIDE_NOT_ALLOWED');
        expect(destructiveCalls()).toEqual([]);
    });

    test('unknown presets are reported', async () => {
        await enableTestMode();
        const res = await sendExternal({ action: 'clean', preset: 'nope' }, testModeSender());
        expect(res).toEqual({ ok: false, error: 'PRESET_NOT_FOUND' });
    });

    test('preset extra origins are dropped: a page may only clean itself', async () => {
        await enableTestMode();
        await syncSet({
            'aw.preset.multi': {
                id: 'multi', name: 'Multi', dataTypes: ['localStorage', 'cache'], cookieMode: 'exact', after: 'none',
                startPath: '/', origins: ['http://127.0.0.1:4000', 'https://other.example.test']
            }
        });
        const res = await sendExternal({ action: 'clean', preset: 'multi' }, testModeSender());
        expect(res.ok).toBe(true);
        expect(res.result.perOrigin.map(o => o.origin)).toEqual([TM_ORIGIN]);
        expect(callsOf('browsingData.remove').map(c => c[1].origins)).toEqual([[TM_ORIGIN]]);
        expect(JSON.stringify(fake.calls)).not.toContain('127.0.0.1');
        expect(JSON.stringify(fake.calls)).not.toContain('other.example.test');
    });

    test('sessionStorage is dropped and reported; after-actions need a sender tab', async () => {
        await enableTestMode();
        const withTab = await sendExternal({ action: 'clean', preset: 'logout' }, testModeSender());
        expect(withTab.ok).toBe(true);
        expect(withTab.dropped).toEqual([{ type: 'sessionStorage', reason: 'testModeNoActiveTab' }]);
        expect(callsOf('scripting.executeScript')).toEqual([]);
        expect(callsOf('tabs.reload').map(c => c[1])).toEqual([5]);

        fake.calls.length = 0;
        const noTab = await sendExternal({ action: 'clean', preset: 'logout' }, testModeSender({ tab: undefined }));
        expect(noTab.ok).toBe(true);
        expect(noTab.dropped).toEqual([
            { type: 'sessionStorage', reason: 'testModeNoActiveTab' },
            { after: 'reload', reason: 'noTab' }
        ]);
        expect(callsOf('tabs.reload')).toEqual([]);
    });

    test('an iframe sender never gets an after-action', async () => {
        await enableTestMode();
        const res = await sendExternal({ action: 'clean', preset: 'logout' }, testModeSender({ frameId: 3 }));
        expect(res.dropped).toContainEqual({ after: 'reload', reason: 'noTab' });
        expect(callsOf('tabs.reload')).toEqual([]);
    });

    test('responds with per-origin results and never with cookie values', async () => {
        await enableTestMode();
        const res = await sendExternal({ action: 'clean', preset: 'logout' }, testModeSender());
        expect(res.result.ok).toBe(true);
        expect(typeof res.result.durationMs).toBe('number');
        expect(res.result.perOrigin[0].origin).toBe(TM_ORIGIN);
        expect(res.result.perOrigin[0].types.cookies).toBe('ok');
        expect(res.result.perOrigin[0].errors).toEqual([]);
        expect(JSON.stringify(res)).not.toContain(SECRET);
    });

    test('a missing host permission is reported as an error, not hidden', async () => {
        await enableTestMode();
        fake.state.granted.clear();
        const res = await sendExternal({ action: 'clean', preset: 'logout' }, testModeSender());
        expect(res.ok).toBe(false);
        expect(res.result.perOrigin[0].errors[0].code).toBe('COOKIE_PERMISSION_MISSING');
        expect(callsOf('cookies.remove')).toEqual([]);
    });

    test('does not change the remembered preset or history', async () => {
        await enableTestMode();
        await sendExternal({ action: 'clean', preset: 'logout' }, testModeSender());
        expect(fake.chrome.storage.sync.data.get('aw.lastPreset')).toBeUndefined();
        expect(fake.chrome.storage.local.data.get('aw.history')).toBeUndefined();
    });
});
