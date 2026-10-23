/**
 * AW Browser Cleaner - E2E confirmation flow and popup state sync
 *
 * Cookies are cleared domain-wide, so selecting them requires an explicit confirmation:
 * clicking "Clear" only opens the confirmation panel; nothing is deleted until "Confirm".
 * Cancel and Escape leave the data untouched.
 */

import { describe, test, expect, afterAll, beforeEach } from 'bun:test';
import {
    launchE2E, guarded, openPopupPage, readState, seedOrigin, resetBrowserState, setTarget, selectTypes,
    selectAllTypes, getOfferedTypes, getSelectedTypes, clickClear, clickConfirm, clickCancel, pressEscape,
    isConfirming, waitForConfirm, waitForNoConfirm, waitForStatus, SEED, sleep
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
        await selectTypes(popup, ['cookies']);
        expect(await cookiesOfA()).toContain(SEED.cookieHttpOnly);

        await clickClear(popup);
        await waitForConfirm(popup);
        expect(await isConfirming(popup)).toBe(true);
        expect(await popup.$eval('#confirmArea', (el) => el.classList.contains('hidden'))).toBe(false);
        expect(await popup.evaluate(() => document.body.classList.contains('is-confirming'))).toBe(true);
        expect(await popup.$eval('#confirmOrigin', (el) => el.textContent)).toBe(env.origins.A);
        expect(await popup.$eval('#clearBtn', (el) => el.disabled)).toBe(true);

        // still there while the confirmation is showing
        await sleep(500);
        const whileConfirming = await cookiesOfA();
        expect(whileConfirming).toContain(SEED.cookieHost);
        expect(whileConfirming).toContain(SEED.cookieHttpOnly);
        expect(whileConfirming).toContain(SEED.cookieShared);

        await clickConfirm(popup);
        await waitForStatus(popup, 'success');
        expect(await cookiesOfA()).toEqual([]);
        expect(await isConfirming(popup)).toBe(false);
    }));

    test('Cancel button aborts: cookies stay and the panel closes', guarded(env, 'confirm-cancel-button', async () => {
        popup = await openFresh();
        await selectTypes(popup, ['cookies']);
        await clickClear(popup);
        await waitForConfirm(popup);

        await clickCancel(popup);
        await waitForNoConfirm(popup);
        expect(await popup.$eval('#clearBtn', (el) => el.disabled)).toBe(false);
        const cookies = await cookiesOfA();
        expect(cookies).toContain(SEED.cookieHost);
        expect(cookies).toContain(SEED.cookieHttpOnly);
        expect(cookies).toContain(SEED.cookieShared);
    }));

    test('Escape aborts: cookies stay and the panel closes', guarded(env, 'confirm-escape', async () => {
        popup = await openFresh();
        await selectTypes(popup, ['cookies']);
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
        await selectTypes(popup, ['cookies']);
        await clickClear(popup);
        await waitForConfirm(popup);
        // the checkboxes are hidden while confirming; changing state programmatically must reset it
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
        await waitForStatus(popup, 'success');
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
        await clickClear(popup);
        await waitForStatus(popup, 'error');
        expect(await isConfirming(popup)).toBe(false);
        expect(await cookiesOfA()).toContain(SEED.cookieHttpOnly);
    }));

    test('success message stays visible after the cleanup', guarded(env, 'status-persists', async () => {
        popup = await openFresh();
        await selectTypes(popup, ['cookies']);
        await clickClear(popup);
        await waitForConfirm(popup);
        await clickConfirm(popup);
        const text = await waitForStatus(popup, 'success');
        expect(text).toContain(env.origins.A);
        // error/info messages time out after 5 s; success must not
        await sleep(6500);
        expect(await popup.$eval('#statusMessage', (el) => el.classList.contains('success') && !el.classList.contains('hidden'))).toBe(true);
        expect(await popup.$eval('#statusMessage', (el) => el.textContent.trim())).toBe(text);
    }));
});

suite('Popup state sync', () => {
    let popup;
    afterAll(async () => {
        if (popup && !popup.isClosed()) await popup.close();
    });

    test('#scopeNote[data-scope] is "wide" with Cookies checked and "exact" otherwise', guarded(env, 'scope-note', async () => {
        popup = await openPopupPage(env.browser, env.extensionId);
        const scope = () => popup.$eval('#scopeNote', (el) => el.dataset.scope);

        await selectTypes(popup, ['cookies']);
        expect(await scope()).toBe('wide');

        const others = (await getOfferedTypes(popup)).filter((t) => t !== 'cookies');
        await selectTypes(popup, others);
        expect(await scope()).toBe('exact');

        await selectTypes(popup, ['cookies', ...others]);
        expect(await scope()).toBe('wide');

        await selectTypes(popup, []);
        expect(await scope()).toBe('exact');
        await popup.close();
    }));

    test('#selectedCount and the #selectAll label follow the checkboxes', guarded(env, 'selection-sync', async () => {
        popup = await openPopupPage(env.browser, env.extensionId);
        const offered = await getOfferedTypes(popup);
        const total = offered.length;
        const read = async () => ({
            count: await popup.$eval('#selectedCount', (el) => el.textContent.trim()),
            label: await popup.$eval('#selectAll', (el) => el.textContent.trim()),
            checked: (await getSelectedTypes(popup)).length
        });
        const countMatches = (count, n) => {
            const numbers = count.match(/\d+/g).map(Number);
            return numbers.includes(n) && numbers.includes(total);
        };

        await selectAllTypes(popup);
        let s = await read();
        expect(s.checked).toBe(total);
        expect(countMatches(s.count, total)).toBe(true);
        const allLabel = s.label;
        expect(allLabel).toMatch(/deselect|clear|none/i);

        await selectTypes(popup, offered.slice(1));
        s = await read();
        expect(s.checked).toBe(total - 1);
        expect(countMatches(s.count, total - 1)).toBe(true);
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
        expect(s.checked).toBe(total);
        expect(s.label).toBe(allLabel);
        await popup.close();
    }));
});
