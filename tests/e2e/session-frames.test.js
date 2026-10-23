/**
 * AW Browser Cleaner - E2E: sessionStorage across frames, and the reload modes
 *
 * Issue #30 acceptance. sessionStorage cannot be removed with chrome.browsingData; the extension
 * clears it with chrome.scripting.executeScript({ allFrames: true }) in every frame whose origin is
 * EXACTLY the target origin (cleanup-core.js, clearSessionStorageInFrame).
 *
 *   - Page A embeds the canary C in a cross-origin iframe; both seed sessionStorage. Cleaning the
 *     sessionStorage of A empties the top frame and leaves the canary frame untouched.
 *   - Page A embedding A (same origin): the iframe is cleared too. Per the HTML spec a same-origin
 *     iframe shares the tab's sessionStorage with its top frame, so both read empty afterwards.
 *   - After-actions: a normal reload serves the cacheable /asset.js subresource from the HTTP cache
 *     (no new request); a hard reload (bypassCache) fetches it from the network again.
 *
 * Runs against the hostAccess build (scripting every frame needs host access).
 */

import { describe, test, expect, afterAll, beforeEach } from 'bun:test';
import {
    launchE2E, guarded, openPopupForTab, resetBrowserState, selectTypes, clickClear, waitForResult,
    workerEvaluate, SEED, sleep
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
beforeEach(async () => { if (env) await closeOpenPages(); });
afterAll(closeOpenPages);

const readSession = (frame) => frame.evaluate(() => ({ ...sessionStorage }));

/** Opens `url` in a tab, waits for every frame to be loaded, and seeds the top frame's sessionStorage. */
async function openFramePage(url) {
    await resetBrowserState(env.browser, Object.values(env.origins));
    const tab = await env.browser.newPage();
    openPages.push(tab);
    await tab.goto(url, { waitUntil: 'load' });
    await tab.waitForFunction(() => [...document.querySelectorAll('iframe')].length > 0);
    // the iframe's own script seeds its sessionStorage on load
    await tab.waitForFrame((f) => f !== tab.mainFrame(), { timeout: 10000 });
    for (const frame of tab.frames().filter((f) => f !== tab.mainFrame())) {
        await frame.waitForFunction(() => sessionStorage.getItem('aw_ss') !== null, { timeout: 10000 });
    }
    await tab.evaluate(() => sessionStorage.setItem('aw_top', 'top'));
    return tab;
}

/** Cleans only sessionStorage through the popup for the given tab (after-action "none"). */
async function cleanSessionStorageViaPopup(tab) {
    const popup = await openPopupForTab(env.browser, env.extensionId, tab);
    openPages.push(popup);
    await selectTypes(popup, ['sessionStorage']);
    await popup.select('#afterSelect', 'none');
    await clickClear(popup);
    const { tone } = await waitForResult(popup);
    expect(tone).toBe('success');
    return popup;
}

suite('sessionStorage in frames (#30)', () => {
    test('cross-origin canary iframe: the top frame of A is cleared, the canary frame keeps its sessionStorage', guarded(env, 'session-canary-frame', async () => {
        const tab = await openFramePage(env.fixtures.iframePageUrl(env.origins.A));
        const canary = tab.frames().find((f) => f.url().startsWith(env.origins.C));
        expect(canary).toBeTruthy();
        expect(await readSession(tab.mainFrame())).toEqual({ aw_top: 'top' });
        expect(await readSession(canary)).toEqual({ [SEED.sessionStorage]: 'frame' });

        await cleanSessionStorageViaPopup(tab);

        expect(await readSession(tab.mainFrame())).toEqual({});
        expect(await readSession(canary)).toEqual({ [SEED.sessionStorage]: 'frame' });
        // the frame is still the cross-origin canary frame
        expect(tab.frames().filter((f) => f.url().startsWith(env.origins.C)).length).toBe(1);
    }));

    test('same-origin iframe (A embedding A): the iframe is cleared as well (allFrames)', guarded(env, 'session-same-origin-frame', async () => {
        const tab = await openFramePage(env.fixtures.sameOriginIframePageUrl(env.origins.A));
        const inner = tab.frames().find((f) => f !== tab.mainFrame() && f.url().startsWith(env.origins.A));
        expect(inner).toBeTruthy();
        // same origin => the iframe and its top frame share the tab's sessionStorage
        expect(await readSession(inner)).toEqual({ aw_top: 'top', [SEED.sessionStorage]: 'frame' });
        expect(await readSession(tab.mainFrame())).toEqual({ aw_top: 'top', [SEED.sessionStorage]: 'frame' });

        await cleanSessionStorageViaPopup(tab);

        expect(await readSession(inner)).toEqual({});
        expect(await readSession(tab.mainFrame())).toEqual({});
    }));

    test('shortcut path (service worker, custom preset without reload): same result for the canary frame', guarded(env, 'session-canary-frame-worker', async () => {
        const tab = await openFramePage(env.fixtures.iframePageUrl(env.origins.A));
        const canary = tab.frames().find((f) => f.url().startsWith(env.origins.C));
        const url = tab.url();
        const result = await workerEvaluate(env.browser, env.extensionId, async (url) => {
            await chrome.storage.sync.set({
                'aw.preset.session-only': { id: 'session-only', name: 'Session only', dataTypes: ['sessionStorage'], cookieMode: 'exact', after: 'none', startPath: '/' }
            });
            const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
            const r = await globalThis.awCleaner.runPresetOnTab('session-only', tab, 'shortcut');
            await chrome.storage.sync.remove('aw.preset.session-only');
            return r;
        }, url);
        expect(result.status).toBe('success');
        expect(await readSession(tab.mainFrame())).toEqual({});
        expect(await readSession(canary)).toEqual({ [SEED.sessionStorage]: 'frame' });
    }));
});

suite('After-actions: normal reload vs hard reload (#30)', () => {
    const assetCount = () => env.fixtures.requestCount(env.origins.A, '/asset.js');

    /** Runs the popup with only sessionStorage selected (HTTP cache untouched) and the given after-action. */
    async function runWithAfter(tab, after) {
        const popup = await openPopupForTab(env.browser, env.extensionId, tab);
        openPages.push(popup);
        await selectTypes(popup, ['sessionStorage']);
        await popup.select('#afterSelect', after);
        await clickClear(popup);
        const { tone } = await waitForResult(popup);
        expect(tone).toBe('success');
        await popup.close();
    }

    /** Waits until the tab has loaded the asset page again (document request count of /with-asset grows). */
    async function waitForReload(previousDocCount) {
        const deadline = Date.now() + 10000;
        while (env.fixtures.requestCount(env.origins.A, '/with-asset') <= previousDocCount) {
            if (Date.now() > deadline) throw new Error('the tab did not reload');
            await sleep(100);
        }
        await sleep(700); // let subresource requests of the reloaded document arrive
    }

    test('normal reload revalidates the document only: the cacheable /asset.js is served from the HTTP cache; hard reload fetches it from the network', guarded(env, 'reload-modes', async () => {
        await resetBrowserState(env.browser, Object.values(env.origins));
        const tab = await env.browser.newPage();
        openPages.push(tab);
        await tab.goto(env.fixtures.assetPageUrl(env.origins.A), { waitUntil: 'load' });
        const afterLoad = assetCount();
        expect(afterLoad).toBe(1);
        // a plain navigation to the same URL also uses the cache (sanity check of the premise)
        await tab.goto(env.fixtures.assetPageUrl(env.origins.A), { waitUntil: 'load' });
        expect(assetCount()).toBe(afterLoad);

        // after = reload
        let docs = env.fixtures.requestCount(env.origins.A, '/with-asset');
        await runWithAfter(tab, 'reload');
        await waitForReload(docs);
        const afterNormal = assetCount();
        console.log(`reload modes: /asset.js requests: initial ${afterLoad}, after normal reload ${afterNormal}`);
        expect(afterNormal).toBe(afterLoad); // observed: served from the HTTP cache

        // after = hard
        docs = env.fixtures.requestCount(env.origins.A, '/with-asset');
        await runWithAfter(tab, 'hard');
        await waitForReload(docs);
        const afterHard = assetCount();
        console.log(`reload modes: /asset.js requests after hard reload ${afterHard}`);
        expect(afterHard).toBe(afterNormal + 1); // bypassCache => fetched from the network again
    }));
});
