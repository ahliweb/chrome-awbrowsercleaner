/**
 * AW Browser Cleaner - E2E confirmation flow and popup state sync
 *
 * Selecting cookies requires an explicit confirmation: clicking "Clear" only opens the confirmation
 * screen (screen 3); nothing is deleted until "Confirm". Domain-wide cookies get the red "danger"
 * button, exact cookies the blue "review" button (see hostAccess tests in popup-active-tab.test.js).
 * Cancel, Escape and changing any input leave the data untouched. Cookies use the domain-wide
 * scope here because granting host access for Exact Cookie Mode cannot be automated.
 */

import { describe, test, expect, afterAll, beforeEach } from 'bun:test';
import {
    launchE2E, guarded, openPopupPage, readState, seedOrigin, resetBrowserState, setTarget, selectTypes,
    selectAllTypes, getOfferedTypes, getSelectedTypes, getDisabledTypes, getScope, setCookieMode, clickClear,
    clickConfirm, clickCancel, pressEscape, isConfirming, waitForConfirm, waitForNoConfirm, waitForStatus,
    waitForResult, SEED, sleep
} from './helpers.js';

const env = await launchE2E();
afterAll(async () => { await env?.close(); });

const suite = env ? describe : describe.skip;

/** Fresh seeded origin A + a fresh popup targeting it. */
async function openFresh() {
    await resetBrowserState(env.browser, Object.values(env.origins));
    const page = await env.browser.newPage();
    try {
        await seedOrigin(page, env.origins.A);
    } finally {
        await page.close();
    }
    const popup = await openPopupPage(env.browser, env.extensionId);
    await setTarget(popup, env.origins.A);
    return popup;
}

/** Selects only cookies and switches them to the domain-wide scope. */
async function armCookies(popup) {
    await selectTypes(popup, ['cookies']);
    await setCookieMode(popup, 'wide');
}

async function cookiesOfA() {
    return (await readState(env.browser, env.origins.A)).cookies;
}

suite('Confirmation flow for cookie cleanup', () => {
    let popup;
    beforeEach(async () => {
        if (popup && !popup.isClosed()) await popup.close();
        popup = null;
    });
    afterAll(async () => {
        if (popup && !popup.isClosed()) await popup.close();
    });

    test('Clear with Cookies selected asks for confirmation and deletes nothing until Confirm', guarded(env, 'confirm-required', async () => {
        popup = await openFresh();
        await armCookies(popup);
        expect(await cookiesOfA()).toContain(SEED.cookieHttpOnly);

        await clickClear(popup);
        await waitForConfirm(popup);
        expect(await isConfirming(popup)).toBe(true);
        expect(await popup.evaluate(() => document.body.dataset.screen)).toBe('confirm');
        expect(await popup.$eval('#screenMain', (el) => el.hidden)).toBe(true);
        expect(await popup.$eval('#confirmOrigin', (el) => el.textContent)).toBe(env.origins.A);
        // domain-wide cookies: red button and a wide scope badge
        expect(await popup.$eval('#confirmBtn', (el) => el.classList.contains('btn-danger'))).toBe(true);
        expect(await popup.$eval('#confirmScope', (el) => el.dataset.scope)).toBe('wide');

        // still there while the confirmation is showing
        await sleep(500);
        const whileConfirming = await cookiesOfA();
        expect(whileConfirming).toContain(SEED.cookieHost);
        expect(whileConfirming).toContain(SEED.cookieHttpOnly);
        expect(whileConfirming).toContain(SEED.cookieShared);

        await clickConfirm(popup);
        expect((await waitForResult(popup)).tone).toBe('success');
        expect(await cookiesOfA()).toEqual([]);
        expect(await isConfirming(popup)).toBe(false);
    }));

    test('Cancel button aborts: cookies stay and the panel closes', guarded(env, 'confirm-cancel-button', async () => {
        popup = await openFresh();
        await armCookies(popup);
        await clickClear(popup);
        await waitForConfirm(popup);

        await clickCancel(popup);
        await waitForNoConfirm(popup);
        expect(await popup.$eval('#clearBtn', (el) => el.disabled)).toBe(false);
        expect(await popup.$eval('#screenMain', (el) => el.hidden)).toBe(false);
        const cookies = await cookiesOfA();
        expect(cookies).toContain(SEED.cookieHost);
        expect(cookies).toContain(SEED.cookieHttpOnly);
        expect(cookies).toContain(SEED.cookieShared);
    }));

    test('Escape aborts: cookies stay and the panel closes', guarded(env, 'confirm-escape', async () => {
        popup = await openFresh();
        await armCookies(popup);
        await clickClear(popup);
        await waitForConfirm(popup);

        await pressEscape(popup);
        await waitForNoConfirm(popup);
        const cookies = await cookiesOfA();
        expect(cookies).toContain(SEED.cookieHost);
        expect(cookies).toContain(SEED.cookieHttpOnly);
    }));

    test('Changing the selection while confirming drops the pending confirmation', guarded(env, 'confirm-selection-change', async () => {
        popup = await openFresh();
        await armCookies(popup);
        await clickClear(popup);
        await waitForConfirm(popup);
        // the form is hidden while confirming; changing an input programmatically must close the screen
        await popup.evaluate(() => {
            const cb = document.querySelector('.checkbox-grid input[value="cookies"]');
            cb.checked = false;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await waitForNoConfirm(popup);
        expect(await cookiesOfA()).toContain(SEED.cookieHttpOnly);
    }));

    test('Without Cookies no confirmation is needed and only that type is removed', guarded(env, 'no-confirm-without-cookies', async () => {
        popup = await openFresh();
        await selectTypes(popup, ['localStorage']);
        await clickClear(popup);
        expect((await waitForResult(popup)).tone).toBe('success');
        expect(await isConfirming(popup)).toBe(false);
        const state = await readState(env.browser, env.origins.A);
        expect(Object.keys(state.localStorage)).toEqual([]);
        expect(state.cookies).toContain(SEED.cookieHttpOnly);
    }));

    test('Clear without any data type selected shows an error and deletes nothing', guarded(env, 'nothing-selected', async () => {
        popup = await openFresh();
        await selectTypes(popup, []);
        await clickClear(popup);
        await waitForStatus(popup, 'error');
        expect(await isConfirming(popup)).toBe(false);
        expect(await cookiesOfA()).toContain(SEED.cookieHttpOnly);
    }));

    test('Clear with an invalid target shows an error and deletes nothing', guarded(env, 'invalid-target', async () => {
        popup = await openFresh();
        await setTarget(popup, 'chrome://settings');
        await selectTypes(popup, ['cookies']);
        // the origin-utils error is shown next to the field and the button is disabled
        expect(await popup.$eval('#originError', (el) => !el.hidden && el.textContent.length > 0)).toBe(true);
        expect(await popup.$eval('#originError', (el) => el.textContent)).toMatch(/scheme/i);
        expect(await popup.$eval('#clearBtn', (el) => el.disabled)).toBe(true);
        expect(await isConfirming(popup)).toBe(false);
        expect(await cookiesOfA()).toContain(SEED.cookieHttpOnly);
    }));

    test('the result screen stays until Done and lists the origin and per-type rows', guarded(env, 'result-persists', async () => {
        popup = await openFresh();
        await armCookies(popup);
        await clickClear(popup);
        await waitForConfirm(popup);
        await clickConfirm(popup);
        const { tone, text } = await waitForResult(popup);
        expect(tone).toBe('success');
        expect(text.length).toBeGreaterThan(0);
        expect(await popup.evaluate(() => document.body.dataset.screen)).toBe('result');
        expect(await popup.$eval('#screenResult', (el) => el.textContent)).toContain(env.origins.A);
        expect(await popup.$('#resultTable tr[data-type="cookies"] .before')).not.toBeNull();
        expect(await popup.$('#resultTable tr[data-type="cookies"] .after')).not.toBeNull();
        await sleep(6500);
        expect(await popup.$eval('#screenResult', (el) => el.hidden)).toBe(false);

        // Done returns to the form
        await popup.click('#resultDoneBtn');
        await popup.waitForSelector('#screenMain:not([hidden])');
        expect(await popup.evaluate(() => document.body.dataset.screen)).toBe('main');
    }));
});

suite('Popup state sync', () => {
    let popup;
    afterAll(async () => {
        if (popup && !popup.isClosed()) await popup.close();
    });

    test('#scopeNote[data-scope] follows the cookie scope, not the Cookies checkbox alone', guarded(env, 'scope-note', async () => {
        popup = await openPopupPage(env.browser, env.extensionId);
        const tagVisible = () => popup.$eval('[data-row="cookies"] .scope-tag', (el) => !el.hidden);

        // Exact scope (default): green note and no "domain-wide" tag, even with Cookies checked
        await selectTypes(popup, ['cookies']);
        expect(await getScope(popup)).toBe('exact');
        expect(await tagVisible()).toBe(false);

        // Domain-wide scope with Cookies checked: wide warning and the tag
        await setCookieMode(popup, 'wide');
        expect(await getScope(popup)).toBe('wide');
        expect(await tagVisible()).toBe(true);

        // Domain-wide scope but no cookies selected: nothing is removed domain-wide
        const others = (await getOfferedTypes(popup)).filter((t) => t !== 'cookies' && !['sessionStorage'].includes(t));
        await selectTypes(popup, others);
        expect(await getScope(popup)).toBe('exact');

        await selectTypes(popup, ['cookies', ...others]);
        expect(await getScope(popup)).toBe('wide');

        await selectTypes(popup, []);
        expect(await getScope(popup)).toBe('exact');
        await popup.close();
    }));

    test('#selectedCount and the #selectAll label follow the checkboxes', guarded(env, 'selection-sync', async () => {
        popup = await openPopupPage(env.browser, env.extensionId);
        const offered = await getOfferedTypes(popup);
        const total = offered.length;
        // Session Storage needs the active tab, so it is disabled for a typed target
        const disabled = await getDisabledTypes(popup);
        expect(disabled).toEqual(['sessionStorage']);
        const enabled = offered.filter((t) => !disabled.includes(t));
        const read = async () => ({
            count: await popup.$eval('#selectedCount', (el) => el.textContent.trim()),
            label: await popup.$eval('#selectAll', (el) => el.textContent.trim()),
            checked: (await getSelectedTypes(popup)).length
        });
        // "N of TOTAL selected": TOTAL counts all 8 types
        const countMatches = (count, n) => {
            const numbers = count.match(/\d+/g).map(Number);
            return numbers.includes(n) && numbers.includes(total);
        };

        await selectAllTypes(popup);
        let s = await read();
        expect(s.checked).toBe(enabled.length);
        expect(countMatches(s.count, enabled.length)).toBe(true);
        const allLabel = s.label;
        expect(allLabel).toMatch(/deselect|clear|none/i);

        await selectTypes(popup, enabled.slice(1));
        s = await read();
        expect(s.checked).toBe(enabled.length - 1);
        expect(countMatches(s.count, enabled.length - 1)).toBe(true);
        expect(s.label).not.toBe(allLabel);
        expect(s.label).toMatch(/select all/i);

        await selectTypes(popup, []);
        s = await read();
        expect(s.checked).toBe(0);
        expect(countMatches(s.count, 0)).toBe(true);
        expect(s.label).toMatch(/select all/i);

        // clicking the toggle selects everything again and the label flips back
        await popup.click('#selectAll');
        s = await read();
        expect(s.checked).toBe(enabled.length);
        expect(s.label).toBe(allLabel);
        await popup.close();
    }));
});
