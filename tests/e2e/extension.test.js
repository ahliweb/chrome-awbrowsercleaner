/**
 * AW Browser Cleaner - E2E: extension loading, popup rendering and fixture sanity.
 *
 * Needs an unbranded Chrome (Chrome for Testing / Chromium) via AW_CHROME_PATH.
 * CI: missing Chrome or a failed extension load FAILS the run. Locally without Chrome the
 * suite is skipped with a visible banner. See helpers.js for the fixture topology.
 */

import { describe, test, expect, afterAll } from 'bun:test';
import {
    launchE2E, guarded, openPopupPage, getOfferedTypes, getLogs, readState, seedOrigin,
    summarizeState, STATE_KINDS, SEED, resetBrowserState
} from './helpers.js';

const env = await launchE2E();
afterAll(async () => { await env?.close(); });

const suite = env ? describe : describe.skip;

suite('Extension loading', () => {
    test('extension is installed with a valid id and answers on chrome-extension://', guarded(env, 'extension-loaded', async () => {
        expect(env.extensionId).toMatch(/^[a-p]{32}$/);
        const page = await env.browser.newPage();
        try {
            await page.goto(`chrome-extension://${env.extensionId}/popup.html`, { waitUntil: 'load' });
            const info = await page.evaluate(() => ({
                id: chrome.runtime.id,
                name: chrome.i18n.getMessage('extensionName'),
                version: chrome.runtime.getManifest().version,
                hasBrowsingData: typeof chrome.browsingData?.remove === 'function'
            }));
            expect(info.id).toBe(env.extensionId);
            expect(info.name).toBe('AW Browser Cleaner');
            expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
            expect(info.hasBrowsingData).toBe(true);
        } finally {
            await page.close();
        }
    }));

    test('the browser is a real Chrome that runs the E2E fixtures', () => {
        expect(env.chromeVersion).toMatch(/Chrome\/\d+/);
        expect(Object.keys(env.origins)).toEqual(['A', 'B', 'A2', 'C']);
        expect(new URL(env.origins.A).hostname).toBe('a.localtest.me');
        expect(new URL(env.origins.C).hostname).toBe('127.0.0.1');
    });
});

suite('Popup rendering', () => {
    test('popup renders its core controls', guarded(env, 'popup-renders', async () => {
        const popup = await openPopupPage(env.browser, env.extensionId);
        try {
            for (const selector of ['#originInput', '#clearBtn', '#selectAll', '#selectedCount', '#scopeNote[data-scope]', '#statusMessage', '#confirmArea']) {
                expect(await popup.$(selector)).not.toBeNull();
            }
            expect(await popup.title()).toContain('AW Browser Cleaner');
            expect(await popup.$eval('#clearBtn', (el) => el.textContent.trim().length)).toBeGreaterThan(0);

            const types = await getOfferedTypes(popup);
            expect(types.length).toBeGreaterThan(0);
            expect(types).toContain('cookies');
            expect(types).toContain('localStorage');
            expect(new Set(types).size).toBe(types.length);

            const count = await popup.$eval('#selectedCount', (el) => el.textContent);
            expect(count).toMatch(new RegExp(`${types.length}`));
        } finally {
            await popup.close();
        }
    }));

    test('popup loads without uncaught page errors', guarded(env, 'popup-no-errors', async () => {
        const before = getLogs(env.browser).length;
        const popup = await openPopupPage(env.browser, env.extensionId);
        await popup.close();
        const errors = getLogs(env.browser).slice(before).filter((l) => /pageerror|console\.error/.test(l));
        // The popup shows an "unsupported scheme" message for its own tab; that is not an uncaught error.
        expect(errors).toEqual([]);
    }));

    test('popup localizes its labels (no raw i18n keys left)', guarded(env, 'popup-localized', async () => {
        const popup = await openPopupPage(env.browser, env.extensionId);
        try {
            const leftovers = await popup.$$eval('[data-i18n]', (els) =>
                els.filter((el) => el.textContent.trim() === el.getAttribute('data-i18n')).map((el) => el.getAttribute('data-i18n')));
            expect(leftovers).toEqual([]);
        } finally {
            await popup.close();
        }
    }));
});

suite('Fixture servers (sanity for the other E2E suites)', () => {
    test('seedOrigin creates every storage type on each origin', guarded(env, 'fixtures-seed', async () => {
        await resetBrowserState(env.browser, Object.values(env.origins));
        for (const origin of Object.values(env.origins)) {
            const page = await env.browser.newPage();
            try {
                await seedOrigin(page, origin);
                // sessionStorage is only visible in the tab that seeded it
                const sameTab = await readState(env.browser, origin, { page });
                expect(sameTab.sessionStorage[SEED.sessionStorage]).toBe('1');
            } finally {
                await page.close();
            }
            const state = await readState(env.browser, origin);
            const summary = summarizeState(state, origin);
            for (const kind of STATE_KINDS) expect([origin, kind, summary[kind]]).toEqual([origin, kind, 'present']);
            expect(state.cookieInfo.find((c) => c.name === SEED.cookieHttpOnly)?.httpOnly).toBe(true);
            expect(state.sessionStorage).toEqual({});
        }
    }));

    test('cookie scoping of the fixtures: shared cookie on localtest.me only, none on the canary', guarded(env, 'fixtures-cookies', async () => {
        const a = await readState(env.browser, env.origins.A);
        const b = await readState(env.browser, env.origins.B);
        const c = await readState(env.browser, env.origins.C);
        expect(a.cookies).toContain(SEED.cookieShared);
        expect(b.cookies).toContain(SEED.cookieShared);
        expect(c.cookies).not.toContain(SEED.cookieShared);
    }));

    test('the HTTP cache is observable through the request counter', guarded(env, 'fixtures-http-cache', async () => {
        await resetBrowserState(env.browser, [env.origins.A]);
        const before = env.fixtures.requestCount(env.origins.A, '/asset.js');
        const page = await env.browser.newPage();
        try {
            await seedOrigin(page, env.origins.A);
            expect(env.fixtures.requestCount(env.origins.A, '/asset.js')).toBe(before + 1);
            // a second fetch is answered from the HTTP cache: no new network request
            await page.evaluate(async () => { await (await fetch('/asset.js')).text(); });
            expect(env.fixtures.requestCount(env.origins.A, '/asset.js')).toBe(before + 1);
            // the counter endpoint agrees with the server-side map
            const viaEndpoint = await page.evaluate(async () => (await (await fetch('/__count?path=/asset.js')).json()).count);
            expect(viaEndpoint).toBe(before + 1);
        } finally {
            await page.close();
        }
    }));

    test('cross-origin iframe page embeds the canary and seeds its sessionStorage', guarded(env, 'fixtures-iframe', async () => {
        const page = await env.browser.newPage();
        try {
            await page.goto(env.fixtures.iframePageUrl(env.origins.A), { waitUntil: 'load' });
            const frame = page.frames().find((f) => f.url().startsWith(env.origins.C));
            expect(frame).toBeDefined();
            await frame.waitForFunction((key) => sessionStorage.getItem(key) === 'frame', {}, SEED.sessionStorage);
        } finally {
            await page.close();
        }
    }));
});
