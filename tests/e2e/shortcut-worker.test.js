/**
 * AW Browser Cleaner - E2E: keyboard shortcut / context menu path through the real service worker
 *
 * Issue #35 acceptance:
 *   - "Shortcut cleans only the active tab's origin (verified by E2E + canary)"
 *   - "chrome://, file://, Web Store pages are rejected with an error badge"
 *
 * A real keyboard shortcut cannot be pressed in automation. The shortcut handler is
 * runPresetOnTab(presetId, tab, 'shortcut') in background.js (exposed as globalThis.awCleaner), which
 * is exactly what the command listener calls. These tests call it inside the real extension service
 * worker with a tab object returned by chrome.tabs.query in that worker, then read the browser back.
 *
 * Runs against the hostAccess build (Exact Cookie Mode needs host access that cannot be granted in
 * automation). A and A2 share every cookie (same host, cookies ignore ports), so cookie expectations
 * for A2 are "same as A"; B and the canary C are compared completely.
 */

import { describe, test, expect, afterAll, beforeEach } from 'bun:test';
import {
    launchE2E, guarded, workerEvaluate, readState, seedOrigin, resetBrowserState, SEED, sleep
} from './helpers.js';

const env = await launchE2E({ hostAccess: true });
afterAll(async () => { await env?.close(); });

const suite = env ? describe : describe.skip;

const openPages = [];
async function closeOpenPages() {
    for (const page of openPages.splice(0)) {
        if (!page.isClosed()) await page.close().catch(() => {});
    }
}
afterAll(closeOpenPages);

/**
 * Runs a preset in the service worker for the tab whose URL is `url` (or for `tabOverride`, a
 * tab-like object) and reads the badge text of that tab in the same call.
 * @returns {Promise<{result: object, badge: string, badgeColor: any, tab: object|null}>}
 */
function runInWorker({ presetId, url, tabOverride, source = 'shortcut' }) {
    return workerEvaluate(env.browser, env.extensionId, async (presetId, url, tabOverride, source) => {
        const tabs = await chrome.tabs.query({});
        const real = url ? tabs.find((t) => t.url === url) : null;
        if (url && !real) throw new Error(`no tab with url ${url}; have ${JSON.stringify(tabs.map((t) => t.url))}`);
        const tab = tabOverride ? { ...tabOverride, id: tabOverride.id ?? real?.id } : real;
        const result = await globalThis.awCleaner.runPresetOnTab(presetId, tab, source);
        const tabId = tab && tab.id;
        const badge = Number.isInteger(tabId) ? await chrome.action.getBadgeText({ tabId }) : null;
        return { result, badge, tab: tab ? { id: tab.id, url: tab.url ?? null } : null };
    }, presetId, url ?? null, tabOverride ?? null, source);
}

async function readAll() {
    const out = {};
    for (const key of ['A', 'B', 'A2', 'C']) out[key] = await readState(env.browser, env.origins[key]);
    return out;
}

const NON_COOKIE = ['localStorage', 'sessionStorage', 'indexedDB', 'cacheStorage', 'serviceWorkers', 'opfs', 'httpCache'];
const pick = (state, keys) => Object.fromEntries(keys.map((k) => [k, state[k]]));
const withoutCookieInfo = (state) => ({ ...state, cookieInfo: undefined });

/** Seeds A, B, A2, C and opens a tab on A (after /seed, parked on the side-effect free /blank). */
async function setup() {
    await closeOpenPages();
    await resetBrowserState(env.browser, Object.values(env.origins));
    const tab = await env.browser.newPage();
    openPages.push(tab);
    await seedOrigin(tab, env.origins.A);
    for (const other of [env.origins.B, env.origins.A2, env.origins.C]) {
        const page = await env.browser.newPage();
        try { await seedOrigin(page, other); } finally { await page.close(); }
    }
    await tab.goto(`${env.origins.A}/blank`, { waitUntil: 'load' });
    await tab.evaluate(() => sessionStorage.setItem('aw_ss', '1'));
    return tab;
}

/** Removes the custom preset / pending marker a test created and any popup window openPopup() made. */
async function resetExtensionState() {
    await workerEvaluate(env.browser, env.extensionId, async () => {
        await chrome.storage.sync.remove('aw.preset.wide-logout');
        await chrome.storage.session.remove('aw.pendingConfirmation');
    });
    for (const page of await env.browser.pages()) {
        if (page.url().endsWith('/popup.html')) await page.close().catch(() => {});
    }
}

beforeEach(async () => { if (env) await resetExtensionState(); });

suite('Shortcut path in the service worker: only the active tab origin is cleaned', () => {
    test('Logout preset: exact cookies and sessionStorage of A go, shared cookie, B, A2 and canary C stay; badge shows a check mark', guarded(env, 'shortcut-logout', async () => {
        const tab = await setup();
        const before = await readAll();
        expect(before.A.cookies).toEqual([SEED.cookieHost, SEED.cookieHttpOnly, SEED.cookieShared].sort());

        const { result, badge } = await runInWorker({ presetId: 'logout', url: `${env.origins.A}/blank` });
        expect(result.status).toBe('success');
        expect(result.ok).toBe(true);
        expect(result.origin).toBe(env.origins.A);
        expect(badge).toBe('✓');
        await sleep(600); // the preset reloads the tab

        const after = await readAll();
        // A: host-only cookies gone, the shared Domain=localtest.me cookie kept in exact mode
        expect(after.A.cookies).toEqual([SEED.cookieShared]);
        // sessionStorage of the active tab is cleared; the reload happened in the same tab
        expect(await tab.evaluate(() => sessionStorage.length)).toBe(0);
        // everything the preset does not select is untouched
        expect(pick(after.A, NON_COOKIE.filter((k) => k !== 'sessionStorage'))).toEqual(pick(before.A, NON_COOKIE.filter((k) => k !== 'sessionStorage')));
        // B and the canary are completely intact (cookies included)
        expect(withoutCookieInfo(after.B)).toEqual(withoutCookieInfo(before.B));
        expect(withoutCookieInfo(after.C)).toEqual(withoutCookieInfo(before.C));
        expect(after.B.cookies).toContain(SEED.cookieShared);
        // A2 shares A's cookie jar (same host, ports are ignored): same cookies as A; its storage is intact
        expect(after.A2.cookies).toEqual(after.A.cookies);
        expect(pick(after.A2, NON_COOKIE)).toEqual(pick(before.A2, NON_COOKIE));
    }));

    test('Fresh start preset: every selected type of A is cleared, nothing else anywhere changes; badge is a check mark', guarded(env, 'shortcut-fresh', async () => {
        const tab = await setup();
        const before = await readAll();

        const { result, badge } = await runInWorker({ presetId: 'fresh', url: `${env.origins.A}/blank` });
        expect(result.status).toBe('success');
        expect(badge).toBe('✓');
        await sleep(800); // after-action "start" navigates the tab to the origin start page

        const after = await readAll();
        expect(after.A.cookies).toEqual([SEED.cookieShared]);
        expect(after.A.localStorage).toEqual({});
        expect(after.A.indexedDB).toEqual([]);
        expect(after.A.cacheStorage).toEqual([]);
        expect(after.A.serviceWorkers).toBe(0);
        expect(after.A.opfs).toEqual([]);
        expect(new URL(tab.url()).origin).toBe(env.origins.A);
        expect(await tab.evaluate(() => sessionStorage.length)).toBe(0);
        // the HTTP cache is not part of "Fresh start"
        expect(after.A.httpCache).toBe(before.A.httpCache);

        expect(withoutCookieInfo(after.B)).toEqual(withoutCookieInfo(before.B));
        expect(withoutCookieInfo(after.C)).toEqual(withoutCookieInfo(before.C));
        expect(after.A2.cookies).toEqual(after.A.cookies);
        expect(pick(after.A2, NON_COOKIE)).toEqual(pick(before.A2, NON_COOKIE));
    }));

    test('the badge is temporary: it is cleared again after its display time', guarded(env, 'shortcut-badge-clears', async () => {
        await setup();
        const { badge, tab } = await runInWorker({ presetId: 'logout', url: `${env.origins.A}/blank` });
        expect(badge).toBe('✓');
        let text = badge;
        for (let i = 0; i < 20 && text !== ''; i++) {
            await sleep(500);
            text = await workerEvaluate(env.browser, env.extensionId, (tabId) => chrome.action.getBadgeText({ tabId }), tab.id);
        }
        expect(text).toBe('');
    }));
});

suite('Shortcut path: unsupported pages are rejected with an error badge and delete nothing', () => {
    /** Asserts status unsupported, "!" badge and that no data changed anywhere. */
    async function expectRejected(run, before) {
        const out = await run();
        const { result, badge } = out;
        expect(result.status).toBe('unsupported');
        expect(result.ok).toBe(false);
        expect(badge).toBe('!');
        const after = await readAll();
        for (const key of ['A', 'B', 'A2', 'C']) {
            expect(withoutCookieInfo(after[key])).toEqual(withoutCookieInfo(before[key]));
        }
        return out;
    }

    test('real tabs on chrome://version, file:// and about:blank', guarded(env, 'shortcut-unsupported-real', async () => {
        await setup();
        const before = await readAll();
        for (const url of ['chrome://version/', 'file:///etc/hostname', 'about:blank']) {
            const page = await env.browser.newPage();
            openPages.push(page);
            await page.goto(url, { waitUntil: 'load' }).catch(() => {});
            await page.bringToFront();
            expect(page.url().split(':')[0]).toBe(url.split(':')[0]); // puppeteer confirms what the tab shows
            // the tab is the focused one; it is passed exactly as chrome.tabs reports it (without the
            // tabs permission Chrome hides the URL of such pages, which must be rejected as well)
            const out = await expectRejected(() => workerEvaluate(env.browser, env.extensionId, async () => {
                const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                const result = await globalThis.awCleaner.runPresetOnTab('fresh', tab, 'shortcut');
                return { result, badge: await chrome.action.getBadgeText({ tabId: tab.id }), tab: { id: tab.id, url: tab.url ?? null } };
            }), before);
            // the tab the worker acted on was the privileged page, not one of the fixture tabs
            expect(String(out.tab.url ?? '')).not.toMatch(/^https?:/);
            await page.close();
        }
    }));

    test('tab objects that carry a chrome://, file://, about:, data:, extension or Web Store URL', guarded(env, 'shortcut-unsupported-urls', async () => {
        await setup();
        const before = await readAll();
        const urls = [
            'chrome://version/',
            'chrome://extensions/',
            'file:///etc/hostname',
            'about:blank',
            'data:text/html,<h1>x</h1>',
            `chrome-extension://${env.extensionId}/options.html`,
            'https://chromewebstore.google.com/detail/aw-browser-cleaner/abc',
            'https://chrome.google.com/webstore/detail/aw-browser-cleaner/abc',
            'https://microsoftedge.microsoft.com/addons/detail/x/y',
            'ftp://example.com/'
        ];
        for (const url of urls) {
            // the tab id is the real A tab (so the badge can be read); only the URL is the one under test
            await expectRejected(() => runInWorker({ presetId: 'fresh', url: `${env.origins.A}/blank`, tabOverride: { url } }), before);
        }
        // a tab without any URL (extensions without the tabs permission see this for privileged pages)
        await expectRejected(() => runInWorker({ presetId: 'logout', url: `${env.origins.A}/blank`, tabOverride: { url: null } }), before);
    }));
});

suite('Shortcut path: danger plans are never run by the worker', () => {
    test('a domain-wide custom preset returns confirmation-required, deletes nothing and leaves a pending confirmation', guarded(env, 'shortcut-danger', async () => {
        await setup();
        const before = await readAll();
        await workerEvaluate(env.browser, env.extensionId, async () => {
            await chrome.storage.sync.set({
                'aw.preset.wide-logout': {
                    id: 'wide-logout', name: 'Wide logout', dataTypes: ['cookies', 'localStorage'],
                    cookieMode: 'domainWide', after: 'none', startPath: '/'
                }
            });
        });

        const { result, badge } = await runInWorker({ presetId: 'wide-logout', url: `${env.origins.A}/blank` });
        expect(result.status).toBe('confirmation-required');
        expect(result.ok).toBe(false);
        expect(result.origin).toBe(env.origins.A);
        expect(badge).toBe('!');

        const pending = await workerEvaluate(env.browser, env.extensionId, async () => (await chrome.storage.session.get('aw.pendingConfirmation'))['aw.pendingConfirmation'] ?? null);
        expect(pending).not.toBeNull();
        expect(pending.presetId).toBe('wide-logout');
        expect(pending.origin).toBe(env.origins.A);
        expect(Number.isFinite(pending.at)).toBe(true);

        // nothing was deleted, anywhere (the confirmation belongs to the popup)
        const after = await readAll();
        for (const key of ['A', 'B', 'A2', 'C']) {
            expect(withoutCookieInfo(after[key])).toEqual(withoutCookieInfo(before[key]));
        }
        expect(after.A.cookies).toContain(SEED.cookieHttpOnly);
        expect(Object.keys(after.A.localStorage)).toEqual([SEED.localStorage]);
    }));

    test('an unknown preset id is rejected with an error badge and deletes nothing', guarded(env, 'shortcut-unknown-preset', async () => {
        await setup();
        const before = await readAll();
        const { result, badge } = await runInWorker({ presetId: 'does-not-exist', url: `${env.origins.A}/blank` });
        expect(result.status).toBe('unknown-preset');
        expect(badge).toBe('!');
        const after = await readAll();
        for (const key of ['A', 'B', 'A2', 'C']) expect(withoutCookieInfo(after[key])).toEqual(withoutCookieInfo(before[key]));
    }));
});
