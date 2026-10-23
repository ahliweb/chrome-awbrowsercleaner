/**
 * AW Browser Cleaner - E2E: features that need the active tab and host access
 *
 * Runs against a copy of the extension whose manifest lists http(s) host_permissions (see
 * helpers.js), because the optional host permission prompt cannot be answered in automation.
 * The popup is opened in a tab with chrome.tabs.query stubbed to report a real fixture tab as the
 * active one; everything else (scripting, cookies, browsingData, tabs.reload) is the real extension.
 *
 * Covered: counts snapshot, Exact Cookie Mode (host-only removed, shared kept, keep-names, shared
 * opt-in), review vs danger confirmation, sessionStorage of the active tab, the after-action reload,
 * the per-type before/after table, and the shortcut's pending confirmation.
 */

import { describe, test, expect, afterAll, beforeEach } from 'bun:test';
import {
    launchE2E, guarded, openPopupForTab, readState, seedOrigin, resetBrowserState, selectTypes, setCookieMode,
    clickClear, clickConfirm, waitForConfirm, waitForResult, waitForMain, getOfferedTypes, getSelectedTypes,
    getDisabledTypes, SEED, sleep
} from './helpers.js';

const env = await launchE2E({ hostAccess: true });
afterAll(async () => { await env?.close(); });

const suite = env ? describe : describe.skip;

/** A secret that must never be rendered anywhere in the popup. */
const SECRET = 'SECRET-COOKIE-VALUE-9f3a';

const openPages = [];
beforeEach(async () => {
    for (const page of openPages.splice(0)) {
        if (!page.isClosed()) await page.close().catch(() => {});
    }
});
afterAll(async () => {
    for (const page of openPages.splice(0)) {
        if (!page.isClosed()) await page.close().catch(() => {});
    }
});

/** Seeds origin A in a tab (plus a cookie with a recognizable value) and opens the popup for it. */
async function openSeeded({ origin = env.origins.A } = {}) {
    await resetBrowserState(env.browser, Object.values(env.origins));
    const tab = await env.browser.newPage();
    openPages.push(tab);
    await seedOrigin(tab, origin);
    // /blank has no side effects, so a reload of the tab does not set cookies again
    await tab.goto(`${origin}/blank`, { waitUntil: 'load' });
    await tab.evaluate((v) => { document.cookie = `aw_probe=${v}; path=/`; }, SECRET);
    for (const other of [env.origins.B, env.origins.A2, env.origins.C]) {
        const page = await env.browser.newPage();
        try { await seedOrigin(page, other); } finally { await page.close(); }
    }
    const popup = await openPopupForTab(env.browser, env.extensionId, tab);
    openPages.push(popup);
    return { tab, popup };
}

const text = (popup, selector) => popup.$eval(selector, (el) => el.textContent.trim());

/** Names shown in a cookie list of screen 2 (rows are labels around input[data-cookie-id]). */
const listedNames = (popup, listId) => popup.$$eval(`#${listId} .cookie-row .cookie-name`, (els) => els.map((e) => e.textContent.trim()).sort());

suite('Active tab: counts, sessionStorage and the target', () => {
    test('the target is the active tab origin and the counts come from a snapshot taken on open', guarded(env, 'tab-counts', async () => {
        const { popup } = await openSeeded();
        expect(await popup.$eval('#originInput', (el) => el.value)).toBe(env.origins.A);
        await popup.waitForFunction(() => document.querySelector('[data-count-for="localStorage"]').textContent.trim() !== '–', { timeout: 10000 });
        const count = (type) => text(popup, `[data-count-for="${type}"]`);
        expect(await count('localStorage')).toBe('1');
        expect(await count('sessionStorage')).toBe('1');
        expect(await count('indexedDB')).toBe('1');
        expect(await count('cacheStorage')).toBe('1');
        expect(await count('serviceWorkers')).toBe('1');
        expect(await count('fileSystems')).toBe('1');
        // aw_host + aw_httponly + aw_probe (host-only) and aw_shared (domain cookie)
        expect(await count('cookies')).toBe('4');
        // the HTTP cache is not countable
        expect(await count('cache')).toBe('–');
    }));

    test('Session Storage and the after-action are enabled for the tab origin, disabled for another origin', guarded(env, 'tab-session-enabled', async () => {
        const { popup } = await openSeeded();
        expect(await getDisabledTypes(popup)).toEqual([]);
        expect(await popup.$eval('#afterSelect', (el) => el.disabled)).toBe(false);
        // default preset: Fresh start opens the start page
        expect(await popup.$eval('#afterSelect', (el) => el.value)).toBe('start');

        await popup.$eval('#originInput', (input, value) => {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }, env.origins.B);
        expect(await getDisabledTypes(popup)).toEqual(['sessionStorage']);
        expect(await popup.$eval('[data-row="sessionStorage"]', (el) => el.title)).toMatch(/active tab/i);
        expect(await popup.$eval('#afterSelect', (el) => ({ disabled: el.disabled, value: el.value, title: el.title })))
            .toEqual({ disabled: true, value: 'none', title: expect.stringMatching(/active tab/i) });
        // counts are only measured for the tab origin
        expect(await text(popup, '[data-count-for="localStorage"]')).toBe('–');
    }));

    test('Logout preset: exact cookies and sessionStorage are removed, shared cookies stay, the tab reloads', guarded(env, 'tab-logout-exact', async () => {
        const { tab, popup } = await openSeeded();
        const blankRequestsBefore = env.fixtures.requestCount(env.origins.A, '/blank');
        await popup.click('[data-preset="logout"]');
        expect(await getSelectedTypes(popup)).toEqual(['cookies', 'sessionStorage']);
        expect(await popup.$eval('#afterSelect', (el) => el.value)).toBe('reload');
        expect(await popup.$eval('#scopeNote', (el) => el.dataset.scope)).toBe('exact');
        expect(await text(popup, '#cookieSummary')).toMatch(/3 removed.*1 shared/);

        await clickClear(popup);
        await waitForConfirm(popup);
        // exact cookies: "review" level with the blue button and a green exact badge
        expect(await popup.$eval('#confirmBtn', (el) => el.classList.contains('btn-primary') && !el.classList.contains('btn-danger'))).toBe(true);
        expect(await popup.$eval('#confirmScope', (el) => el.dataset.scope)).toBe('exact');
        expect(await text(popup, '#confirmOrigin')).toBe(env.origins.A);
        expect(await text(popup, '#confirmKeep')).toContain('.localtest.me');
        expect(await text(popup, '#confirmTypes')).toMatch(/Session Storage/);

        await clickConfirm(popup);
        const { tone } = await waitForResult(popup);
        expect(tone).toBe('success');
        await sleep(800);
        // (read before readState(), which itself loads /blank)
        const blankRequestsAfter = env.fixtures.requestCount(env.origins.A, '/blank');

        // cookies: host-only ones gone, the shared Domain=localtest.me cookie kept (on A and on B)
        const a = await readState(env.browser, env.origins.A);
        expect(a.cookies).toEqual([SEED.cookieShared]);
        expect((await readState(env.browser, env.origins.B)).cookies).toContain(SEED.cookieShared);
        // the canary is untouched
        expect((await readState(env.browser, env.origins.C)).cookies).toContain(SEED.cookieHost);

        // the tab was reloaded (one more request for /seed) and its sessionStorage is gone
        expect(blankRequestsAfter).toBe(blankRequestsBefore + 1);
        expect(await tab.evaluate(() => sessionStorage.length)).toBe(0);
        // localStorage was not part of the preset
        expect(Object.keys(await tab.evaluate(() => ({ ...localStorage })))).toEqual([SEED.localStorage]);

        // the before/after table: sessionStorage went from 1 to 0
        expect(await text(popup, '#resultTable tr[data-type="sessionStorage"] .before')).toBe('1');
        expect(await text(popup, '#resultTable tr[data-type="sessionStorage"] .after')).toBe('0');
    }));
});

suite('Exact cookies screen', () => {
    test('lists host-only and shared cookies by name and attributes, never their values', guarded(env, 'cookies-screen', async () => {
        const { popup } = await openSeeded();
        await popup.waitForFunction(() => document.querySelector('[data-count-for="cookies"]').textContent.trim() !== '–', { timeout: 10000 });
        await popup.click('#cookieManageBtn');
        await popup.waitForSelector('#screenCookies:not([hidden])');
        await popup.waitForSelector('#cookieListHostOnly input[data-cookie-id]');

        // access is already granted: no permission notice
        expect(await popup.$eval('#cookiePermissionNotice', (el) => el.hidden)).toBe(true);
        expect(await listedNames(popup, 'cookieListHostOnly')).toEqual([SEED.cookieHost, SEED.cookieHttpOnly, 'aw_probe'].sort());
        expect(await listedNames(popup, 'cookieListShared')).toEqual([SEED.cookieShared]);
        // HttpOnly is shown as an attribute
        expect(await popup.$eval('#cookieListHostOnly', (el) => el.textContent)).toContain('HttpOnly');

        // removed by default: host-only (checked); kept by default: shared (unchecked)
        const checked = (listId) => popup.$$eval(`#${listId} input[data-cookie-id]`, (els) => els.map((e) => e.checked));
        expect((await checked('cookieListHostOnly')).every(Boolean)).toBe(true);
        expect(await checked('cookieListShared')).toEqual([false]);
        expect(await text(popup, '#cookieCountSummary')).toMatch(/3\D+4/);

        // values are never rendered, neither as text nor in any attribute
        const html = await popup.evaluate(() => document.documentElement.outerHTML);
        expect(html).not.toContain(SECRET);
        expect(await popup.evaluate(() => document.body.innerText)).not.toContain(SECRET);
        expect(await popup.$$eval('input[data-cookie-id]', (els) => els.every((e) => !e.value || e.value === 'on'))).toBe(true);
    }));

    test('Domain-wide mode checks and locks the shared cookies; Exact mode releases them', guarded(env, 'cookies-wide-lock', async () => {
        const { popup } = await openSeeded();
        await popup.click('#cookieManageBtn');
        await popup.waitForSelector('#cookieListShared input[data-cookie-id]');
        expect(await popup.$eval('#cookieModeExact', (el) => el.getAttribute('aria-pressed'))).toBe('true');

        await popup.click('#cookieModeWide');
        expect(await popup.$eval('#cookieModeWide', (el) => el.getAttribute('aria-pressed'))).toBe('true');
        expect(await popup.$eval('#cookieModeExact', (el) => el.getAttribute('aria-pressed'))).toBe('false');
        expect(await popup.$eval('#cookieListShared input[data-cookie-id]', (el) => ({ checked: el.checked, disabled: el.disabled })))
            .toEqual({ checked: true, disabled: true });
        expect(await text(popup, '#cookieCountSummary')).toMatch(/4\D+4/);

        await popup.click('#cookieModeExact');
        expect(await popup.$eval('#cookieListShared input[data-cookie-id]', (el) => ({ checked: el.checked, disabled: el.disabled })))
            .toEqual({ checked: false, disabled: false });
    }));

    test('unchecked host-only cookies are kept by name when the plan runs', guarded(env, 'cookies-keep-names', async () => {
        const { popup } = await openSeeded();
        await popup.click('[data-preset="logout"]');
        await popup.click('#cookieManageBtn');
        await popup.waitForSelector('#cookieListHostOnly input[data-cookie-id]');
        // untick aw_host
        await popup.evaluate((name) => {
            const row = [...document.querySelectorAll('#cookieListHostOnly .cookie-row')]
                .find((r) => r.querySelector('.cookie-name').textContent.trim() === name);
            row.querySelector('input').click();
        }, SEED.cookieHost);
        expect(await text(popup, '#cookieCountSummary')).toMatch(/2\D+4/);
        await popup.click('#cookieSaveBtn');
        await waitForMain(popup);
        expect(await text(popup, '#cookieSummary')).toMatch(/2 removed.*1 shared/);

        await clickClear(popup);
        await waitForConfirm(popup);
        await clickConfirm(popup);
        await waitForResult(popup);
        const cookies = (await readState(env.browser, env.origins.A)).cookies;
        expect(cookies).toContain(SEED.cookieHost);
        expect(cookies).toContain(SEED.cookieShared);
        expect(cookies).not.toContain(SEED.cookieHttpOnly);
        expect(cookies).not.toContain('aw_probe');
    }));

    test('ticking a shared cookie makes the plan "danger" and removes it', guarded(env, 'cookies-include-shared', async () => {
        const { popup } = await openSeeded();
        await popup.click('[data-preset="logout"]');
        await popup.click('#cookieManageBtn');
        await popup.waitForSelector('#cookieListShared input[data-cookie-id]');
        await popup.click('#cookieListShared input[data-cookie-id]');
        await popup.click('#cookieSaveBtn');
        await waitForMain(popup);
        expect(await popup.$eval('#scopeNote', (el) => el.dataset.scope)).toBe('wide');

        await clickClear(popup);
        await waitForConfirm(popup);
        expect(await popup.$eval('#confirmBtn', (el) => el.classList.contains('btn-danger'))).toBe(true);
        expect(await popup.$eval('#confirmScope', (el) => el.dataset.scope)).toBe('wide');
        await clickConfirm(popup);
        await waitForResult(popup);
        expect((await readState(env.browser, env.origins.A)).cookies).toEqual([]);
        // B keeps its own host-only cookies; only the shared Domain=localtest.me cookie went
        expect((await readState(env.browser, env.origins.B)).cookies).toEqual([SEED.cookieHost, SEED.cookieHttpOnly].sort());
    }));
});

suite('Time range, extra origins and presets with real data', () => {
    test('a time range disables exact cookies; domain-wide cookies can be limited by time', guarded(env, 'range-exact-cookies', async () => {
        const { popup } = await openSeeded();
        await popup.select('#rangeSelect', '1h');
        expect(await getDisabledTypes(popup)).toEqual(['cookies']);
        expect(await popup.$eval('[data-row="cookies"]', (el) => el.title)).toMatch(/time/i);
        expect(await popup.$eval('#rangeNote', (el) => el.hidden)).toBe(false);
        expect(await getSelectedTypes(popup)).not.toContain('cookies');

        await setCookieMode(popup, 'wide');
        expect(await getDisabledTypes(popup)).toEqual([]);
        // back to "all time": the choice is still there
        await popup.select('#rangeSelect', 'all');
        expect(await getSelectedTypes(popup)).toContain('cookies');
        expect(await popup.$eval('#rangeNote', (el) => el.hidden)).toBe(true);
    }));

    test('"Last hour" removes recent site data of the origin through browsingData.since', guarded(env, 'range-last-hour', async () => {
        const { popup } = await openSeeded();
        await selectTypes(popup, ['localStorage', 'indexedDB']);
        await popup.select('#rangeSelect', '1h');
        await popup.select('#afterSelect', 'none');
        await clickClear(popup);
        expect((await waitForResult(popup)).tone).toBe('success');
        const state = await readState(env.browser, env.origins.A);
        expect(Object.keys(state.localStorage)).toEqual([]);
        expect(state.indexedDB).toEqual([]);
        expect(state.cacheStorage).toEqual([SEED.cacheStorage]);
    }));

    test('extra origins are cleaned in the same run; the canary and port variants are not', guarded(env, 'extra-origins', async () => {
        const { popup } = await openSeeded();
        await popup.click('#addOriginBtn');
        await popup.type('#extraOriginInput', `${env.origins.B}\n`);
        expect(await popup.$$eval('#extraOrigins .chip', (els) => els.map((e) => e.textContent.replace('×', '').trim()))).toEqual([env.origins.B]);
        expect(await text(popup, '#clearBtn')).toMatch(/2/);

        await selectTypes(popup, ['localStorage']);
        await popup.select('#afterSelect', 'none');
        await clickClear(popup);
        await waitForResult(popup);
        expect(await popup.$$eval('#screenResult .result-origin', (els) => els.map((e) => e.textContent.trim()))).toEqual(
            expect.arrayContaining([env.origins.A, env.origins.B]));

        expect(Object.keys((await readState(env.browser, env.origins.A)).localStorage)).toEqual([]);
        expect(Object.keys((await readState(env.browser, env.origins.B)).localStorage)).toEqual([]);
        expect(Object.keys((await readState(env.browser, env.origins.A2)).localStorage)).toEqual([SEED.localStorage]);
        expect(Object.keys((await readState(env.browser, env.origins.C)).localStorage)).toEqual([SEED.localStorage]);
    }));

    test('the last preset is remembered per origin and offered on the next open', guarded(env, 'preset-memory', async () => {
        const { tab, popup } = await openSeeded();
        await popup.click('[data-preset="stale"]');
        expect(await popup.$eval('#afterSelect', (el) => el.value)).toBe('hard');
        // choosing another reload mode for this preset is remembered too
        await popup.select('#afterSelect', 'reload');
        await clickClear(popup);
        await waitForResult(popup);
        await popup.close();

        const again = await openPopupForTab(env.browser, env.extensionId, tab);
        openPages.push(again);
        expect(await again.$eval('[data-preset="stale"]', (el) => el.getAttribute('aria-pressed'))).toBe('true');
        expect(await again.$eval('#afterSelect', (el) => el.value)).toBe('reload');
        expect(await again.$eval('#presetStatus', (el) => el.hidden)).toBe(true);
        expect((await getOfferedTypes(again)).length).toBe(8);
    }));
});

suite('Shortcut: pending confirmation of a domain-wide preset', () => {
    test('the popup opens straight on the confirmation screen and runs nothing by itself', guarded(env, 'pending-confirmation', async () => {
        const { tab } = await openSeeded();
        // a custom preset with domain-wide cookies, and the pending marker the service worker would leave
        const setup = await env.browser.newPage();
        try {
            await setup.goto(`chrome-extension://${env.extensionId}/options.html`, { waitUntil: 'load' });
            await setup.evaluate(async (origin) => {
                await chrome.storage.sync.set({
                    'aw.preset.wide-logout': {
                        id: 'wide-logout', name: 'Wide logout', dataTypes: ['cookies', 'localStorage'],
                        cookieMode: 'domainWide', after: 'none', startPath: '/'
                    }
                });
                await chrome.storage.session.set({ 'aw.pendingConfirmation': { presetId: 'wide-logout', origin, at: Date.now() } });
            }, env.origins.A);
        } finally {
            await setup.close();
        }

        const popup = await openPopupForTab(env.browser, env.extensionId, tab, { screen: 'any' });
        openPages.push(popup);
        await waitForConfirm(popup);
        expect(await popup.$eval('#confirmBtn', (el) => el.classList.contains('btn-danger'))).toBe(true);
        expect(await text(popup, '#confirmOrigin')).toBe(env.origins.A);
        expect(await text(popup, '#confirmPreset')).toContain('Wide logout');
        // nothing was deleted: the user still has to click the button
        const state = await readState(env.browser, env.origins.A);
        expect(state.cookies).toContain(SEED.cookieHttpOnly);
        expect(Object.keys(state.localStorage)).toEqual([SEED.localStorage]);

        // single use: a second popup does not see the pending confirmation
        const second = await openPopupForTab(env.browser, env.extensionId, tab);
        openPages.push(second);
        expect(await second.$eval('#screenMain', (el) => el.hidden)).toBe(false);
        expect(await second.evaluate(() => document.body.classList.contains('is-confirming'))).toBe(false);

        // (puppeteer clicks need a visible tab)
        await popup.bringToFront();
        await clickConfirm(popup);
        await waitForResult(popup);
        const after = await readState(env.browser, env.origins.A);
        expect(after.cookies).toEqual([]);
        expect(Object.keys(after.localStorage)).toEqual([]);
    }));
});
