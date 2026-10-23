/**
 * AW Browser Cleaner - E2E: Incognito (issue #41, ADR 0002)
 *
 * Acceptance: "E2E Incognito green; data in the regular window untouched".
 *
 * "Allow in Incognito" is switched on through chrome://extensions (see enableIncognitoAccess in
 * helpers.js), then a REAL incognito window is opened by the extension's service worker
 * (puppeteer's createBrowserContext() is not a real incognito window for extensions). The same origin
 * A is seeded in the regular profile and in the incognito window with different values, a cleanup is
 * run through runPresetOnTab (the keyboard shortcut path) for the tab in one profile, and both
 * profiles are read back.
 *
 * Finding that led to `"incognito": "split"` in manifest.json (docs/adr/0002-incognito-mode.md):
 * with the default `spanning` mode there is ONE worker in the regular profile, and
 * chrome.browsingData.remove from it always acts on the REGULAR profile: cleaning an incognito tab
 * left the incognito storage in place and wiped the regular profile's storage for the same origin.
 * (Cookies were fine because they are removed per cookie store.) In `split` mode the incognito
 * window runs its own instance of the extension, whose browsingData calls act on the incognito
 * profile.
 */

import { describe, test, expect, afterAll, beforeEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
    launchE2E, guarded, workerEvaluateIn, readState, seedOrigin, resetBrowserState, enableIncognitoAccess,
    openIncognitoPage, EXTENSION_PATH, isCI
} from './helpers.js';

const env = await launchE2E({ hostAccess: true });
afterAll(async () => { await env?.close(); });

const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
const SPLIT = manifest.incognito === 'split';

let access = { ok: false, reason: 'E2E environment unavailable' };
if (env) {
    access = await enableIncognitoAccess(env.browser, env.extensionId);
    if (access.ok) {
        console.log(`AW E2E incognito: "Allow in Incognito" enabled via ${access.method}; manifest incognito mode: ${manifest.incognito || 'spanning (default)'}`);
    } else if (isCI()) {
        const { test: t } = await import('bun:test');
        t('Incognito access must be enableable in CI', () => { throw new Error(`Could not enable "Allow in Incognito": ${access.reason}`); });
    } else {
        const reason = `SKIPPED: could not enable "Allow in Incognito" in this environment (${access.reason})`;
        console.warn(`\n${'='.repeat(78)}\nAW E2E incognito ${reason}\n${'='.repeat(78)}\n`);
        const { test: t } = await import('bun:test');
        t.skip(`Incognito E2E ${reason}`, () => {});
    }
}

const suite = env && access.ok ? describe : describe.skip;

const regularWorker = { incognito: false };
// spanning: one worker (regular profile) serves both; split: the incognito window has its own worker
const incognitoWorker = SPLIT ? { incognito: true, wake: false } : { incognito: false };

const openPages = [];
async function closeOpenPages() {
    for (const page of openPages.splice(0)) {
        if (!page.isClosed()) await page.close().catch(() => {});
    }
}
afterAll(closeOpenPages);
beforeEach(async () => { if (env) await closeOpenPages(); });

const withoutCookieInfo = (state) => ({ ...state, cookieInfo: undefined });

/**
 * Seeds origin A in the regular profile ("regular" values) and in an incognito window
 * ("incognito" values). Both tabs end parked on /blank.
 */
async function seedBothProfiles() {
    const A = env.origins.A;
    await resetBrowserState(env.browser, Object.values(env.origins));
    const regular = await env.browser.newPage();
    openPages.push(regular);
    await seedOrigin(regular, A);
    await regular.evaluate(() => { localStorage.setItem('aw_ls', 'regular'); document.cookie = 'aw_probe=regular; path=/'; });
    await regular.goto(`${A}/blank`, { waitUntil: 'load' });

    const incognito = await openIncognitoPage(env.browser, env.extensionId, `${A}/blank?incognito=1`);
    openPages.push(incognito);
    await seedOrigin(incognito, A);
    await incognito.evaluate(() => { localStorage.setItem('aw_ls', 'incognito'); document.cookie = 'aw_probe=incognito; path=/'; });
    await incognito.goto(`${A}/blank`, { waitUntil: 'load' });
    return { regular, incognito };
}

const readPage = (page) => readState(env.browser, env.origins.A, { page });

/** Runs `presetId` in the worker of `which` for the tab with `url` in the profile `incognitoTab`. */
function runForTab(which, { presetId, url, incognitoTab }) {
    return workerEvaluateIn(env.browser, env.extensionId, which, async (presetId, url, incognitoTab) => {
        const tab = (await chrome.tabs.query({})).find((t) => t.url === url && Boolean(t.incognito) === incognitoTab);
        if (!tab) throw new Error(`no ${incognitoTab ? 'incognito' : 'regular'} tab with url ${url}`);
        const stores = await chrome.cookies.getAllCookieStores();
        const result = await globalThis.awCleaner.runPresetOnTab(presetId, tab, 'shortcut');
        return {
            result,
            tab: { id: tab.id, incognito: tab.incognito },
            inIncognitoContext: chrome.extension.inIncognitoContext,
            tabStore: (stores.find((s) => s.tabIds.includes(tab.id)) || {}).id ?? null,
            storeIds: stores.map((s) => s.id)
        };
    }, presetId, url, incognitoTab);
}

suite('Incognito (ADR 0002)', () => {
    test('the extension is allowed in incognito and manifest.json declares the verified mode (split)', guarded(env, 'incognito-mode', async () => {
        const { regular, incognito } = await seedBothProfiles();
        void regular; void incognito;
        expect(SPLIT).toBe(true);
        // an incognito tab is really off the record, with its own cookie store
        const info = await workerEvaluateIn(env.browser, env.extensionId, incognitoWorker, async () => ({
            allowed: await chrome.extension.isAllowedIncognitoAccess(),
            inc: chrome.extension.inIncognitoContext,
            tabs: (await chrome.tabs.query({})).map((t) => ({ url: t.url, incognito: t.incognito }))
        }));
        expect(info.allowed).toBe(true);
        expect(info.tabs.some((t) => t.incognito && t.url.startsWith(env.origins.A))).toBe(true);
    }));

    test('cleaning from the incognito window ("Fresh start" shortcut path) cleans incognito A and leaves the regular profile untouched', guarded(env, 'incognito-clean-incognito', async () => {
        const { regular, incognito } = await seedBothProfiles();
        const regBefore = await readPage(regular);
        const incBefore = await readPage(incognito);
        expect(incBefore.localStorage).toEqual({ aw_ls: 'incognito' });
        expect(regBefore.localStorage).toEqual({ aw_ls: 'regular' });

        const run = await runForTab(incognitoWorker, { presetId: 'fresh', url: incognito.url(), incognitoTab: true });
        expect(run.tab.incognito).toBe(true);
        expect(run.result.status).toBe('success');
        // cookies of the incognito tab were read and removed in the incognito cookie store (2 host-only removed, shared kept)
        expect(run.result.result.perOrigin[0].cookies).toEqual({ removed: 3, kept: 1, failed: 0 }); // aw_host, aw_httponly, aw_probe; aw_shared kept
        expect(run.tabStore).not.toBeNull();
        await new Promise((r) => setTimeout(r, 800));

        // incognito A: everything the preset selects is gone, the shared cookie stays (exact mode)
        await incognito.goto(`${env.origins.A}/blank`, { waitUntil: 'load' });
        const incAfter = await readPage(incognito);
        expect(incAfter.localStorage).toEqual({});
        expect(incAfter.sessionStorage).toEqual({});
        expect(incAfter.indexedDB).toEqual([]);
        expect(incAfter.cacheStorage).toEqual([]);
        expect(incAfter.serviceWorkers).toBe(0);
        expect(incAfter.opfs).toEqual([]);
        expect(incAfter.cookies).toEqual(['aw_shared']);

        // the regular profile is completely untouched: cookies, storage and the tab's sessionStorage
        await regular.goto(`${env.origins.A}/blank`, { waitUntil: 'load' });
        const regAfter = await readPage(regular);
        expect(withoutCookieInfo(regAfter)).toEqual(withoutCookieInfo(regBefore));
    }));

    test('cleaning from the regular window cleans regular A and leaves the incognito window untouched', guarded(env, 'incognito-clean-regular', async () => {
        const { regular, incognito } = await seedBothProfiles();
        const incBefore = await readPage(incognito);
        const regBefore = await readPage(regular);

        const run = await runForTab(regularWorker, { presetId: 'fresh', url: regular.url(), incognitoTab: false });
        expect(run.tab.incognito).toBe(false);
        expect(run.result.status).toBe('success');
        // the regular tab's store is not the incognito store
        expect(run.inIncognitoContext).toBe(false);
        await new Promise((r) => setTimeout(r, 800));

        await regular.goto(`${env.origins.A}/blank`, { waitUntil: 'load' });
        const regAfter = await readPage(regular);
        expect(regAfter.localStorage).toEqual({});
        expect(regAfter.indexedDB).toEqual([]);
        expect(regAfter.cacheStorage).toEqual([]);
        expect(regAfter.serviceWorkers).toBe(0);
        expect(regAfter.opfs).toEqual([]);
        expect(regAfter.cookies).toEqual(['aw_shared']);
        expect(regBefore.cookies).toContain('aw_probe');

        await incognito.goto(`${env.origins.A}/blank`, { waitUntil: 'load' });
        const incAfter = await readPage(incognito);
        expect(withoutCookieInfo(incAfter)).toEqual(withoutCookieInfo(incBefore));
    }));

    test('cookie stores: the incognito tab uses its own store, and a cookie query without storeId in the incognito instance reads the incognito store', guarded(env, 'incognito-cookie-store', async () => {
        const { regular, incognito } = await seedBothProfiles();
        const A = env.origins.A;
        const probe = (which) => workerEvaluateIn(env.browser, env.extensionId, which, async (url) => {
            const stores = await chrome.cookies.getAllCookieStores();
            const tabs = await chrome.tabs.query({});
            const found = await chrome.cookies.getAll({ url, name: 'aw_probe' }); // no storeId: the fallback of getCookieStoreId() === undefined
            return {
                storeOfTab: Object.fromEntries(tabs.map((t) => [t.url, (stores.find((s) => s.tabIds.includes(t.id)) || {}).id ?? null])),
                incognitoTabs: tabs.filter((t) => t.incognito).length,
                noStoreQuery: found.map((c) => ({ value: c.value, storeId: c.storeId }))
            };
        }, `${A}/`);

        const fromIncognito = await probe(incognitoWorker);
        const fromRegular = await probe(regularWorker);
        // fallback query (no storeId) is answered from the store of the instance's own profile
        expect(fromIncognito.noStoreQuery.map((c) => c.value)).toEqual(['incognito']);
        expect(fromRegular.noStoreQuery.map((c) => c.value)).toEqual(['regular']);
        expect(fromIncognito.noStoreQuery[0].storeId).not.toBe(fromRegular.noStoreQuery[0].storeId);
        // the tab lookup (getCookieStoreId) finds the incognito tab's store in the incognito instance
        expect(fromIncognito.storeOfTab[incognito.url()]).toBe(fromIncognito.noStoreQuery[0].storeId);
        expect(fromRegular.storeOfTab[regular.url()]).toBe(fromRegular.noStoreQuery[0].storeId);
    }));

    test('the context menu exists in the incognito instance too, and creating it did not remove the regular one', guarded(env, 'incognito-context-menu', async () => {
        await seedBothProfiles();
        const outcome = (which) => workerEvaluateIn(env.browser, env.extensionId, which, () => new Promise((resolve) => {
            chrome.contextMenus.create({ id: 'aw-clean-with-preset', title: 'probe', contexts: ['page'] },
                () => resolve(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'created-new'));
        }));
        // creating the item again fails with "duplicate id" only when the instance already has it.
        // (contextMenus.removeAll() in either instance clears the items of BOTH, so the incognito instance only creates.)
        expect(await outcome(regularWorker)).toMatch(/duplicate id/);
        expect(await outcome(incognitoWorker)).toMatch(/duplicate id/);
    }));
});
