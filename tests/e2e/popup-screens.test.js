/**
 * AW Browser Cleaner - E2E: popup screens, presets, origins and accessibility hooks
 *
 * Default extension build (optional host permissions only), popup opened in a tab. The popup is its
 * own active tab there, so it starts on screen 5 (unsupported page) and continues with a typed
 * target. Exact Cookie Mode needs host access, which automation cannot grant: the denied path is
 * tested here (notice, no silent fallback), the granted path in popup-active-tab.test.js.
 */

import { describe, test, expect, afterAll } from 'bun:test';
import {
    launchE2E, guarded, openPopupPage, continueFromUnsupported, readState, seedOrigin, resetBrowserState,
    selectTypes, getSelectedTypes, getDisabledTypes, getOfferedTypes, getScope, setCookieMode, setTarget,
    clickClear, waitForConfirm, waitForResult, waitForMain, waitForStatus, SEED
} from './helpers.js';

const env = await launchE2E();
afterAll(async () => { await env?.close(); });

const suite = env ? describe : describe.skip;

const text = (popup, selector) => popup.$eval(selector, (el) => el.textContent.trim());
const hidden = (popup, selector) => popup.$eval(selector, (el) => el.hidden);
const attr = (popup, selector, name) => popup.$eval(selector, (el, n) => el.getAttribute(n), name);
const pressed = (popup, preset) => attr(popup, `[data-preset="${preset}"]`, 'aria-pressed');

/** Runs `fn` inside a short-lived extension page (storage access). */
async function inExtensionPage(fn, arg) {
    const page = await env.browser.newPage();
    try {
        await page.goto(`chrome-extension://${env.extensionId}/options.html`, { waitUntil: 'load' });
        return await page.evaluate(fn, arg);
    } finally {
        await page.close();
    }
}

/** Replaces the text of an input with real key presses. */
async function replaceText(popup, selector, value) {
    await popup.$eval(selector, (el) => { el.focus(); el.select(); });
    await popup.keyboard.press('Backspace');
    await popup.type(selector, value);
}

/** Opens a popup on a typed target and runs `fn`, closing it afterwards. */
async function withPopup(fn, options) {
    const popup = await openPopupPage(env.browser, env.extensionId, options);
    try {
        return await fn(popup);
    } finally {
        if (!popup.isClosed()) await popup.close();
    }
}

suite('Screen 5: unsupported page', () => {
    test('a page the extension cannot clean shows the manual target form instead of an empty form', guarded(env, 'unsupported-screen', async () => {
        await withPopup(async (popup) => {
            expect(await popup.evaluate(() => document.body.dataset.screen)).toBe('unsupported');
            expect(await hidden(popup, '#screenMain')).toBe(true);
            // (without the "tabs" permission Chrome hides the URL of such pages, so the label may be generic)
            expect((await text(popup, '#unsupportedScheme')).length).toBeGreaterThan(0);
            expect(await popup.$eval('#continueBtn', (el) => el.disabled)).toBe(true);

            // live normalization preview
            await popup.type('#manualTargetInput', 'Staging.Example.test/login?next=%2F#x');
            expect(await hidden(popup, '#manualPreview')).toBe(false);
            expect(await text(popup, '#manualPreview')).toContain('https://staging.example.test');
            expect(await popup.$eval('#continueBtn', (el) => el.disabled)).toBe(false);

            // an unsupported scheme is rejected with the origin-utils error
            await replaceText(popup, '#manualTargetInput', 'ftp://example.test');
            expect(await hidden(popup, '#manualError')).toBe(false);
            expect(await text(popup, '#manualError')).toMatch(/scheme/i);
            expect(await popup.$eval('#continueBtn', (el) => el.disabled)).toBe(true);

            await replaceText(popup, '#manualTargetInput', 'https://staging.example.test:8443/login');
            await popup.click('#continueBtn');
            await waitForMain(popup);
            // the typed target is carried over, normalized, as a plain origin
            expect(await popup.$eval('#originInput', (el) => el.value)).toBe('https://staging.example.test:8443');
            expect(await hidden(popup, '#normalizedPreview')).toBe(true);
            // no active tab for that origin
            expect(await popup.$eval('#fillCurrent', (el) => el.disabled)).toBe(true);
        }, { target: null });
    }));

    test('recent origins are offered after a cleanup', guarded(env, 'unsupported-recent', async () => {
        await resetBrowserState(env.browser, Object.values(env.origins));
        await withPopup(async (popup) => {
            await selectTypes(popup, ['localStorage']);
            await clickClear(popup);
            await waitForResult(popup);
        }, { target: env.origins.A });
        await withPopup(async (popup) => {
            expect(await popup.$$eval('#recentOrigins [data-origin]', (els) => els.map((e) => e.dataset.origin))).toContain(env.origins.A);
            await popup.click(`#recentOrigins [data-origin="${env.origins.A}"]`);
            expect(await popup.$eval('#manualTargetInput', (el) => el.value)).toBe(env.origins.A);
        }, { target: null });
    }));
});

suite('Screen 1: target field and header', () => {
    test('a typed value that differs from its origin shows the preview; invalid input disables Clear', guarded(env, 'target-preview', async () => {
        await withPopup(async (popup) => {
            await setTarget(popup, 'https://api.example.test:9000/path?q=1');
            expect(await hidden(popup, '#normalizedPreview')).toBe(false);
            expect(await text(popup, '#normalizedOrigin')).toBe('https://api.example.test:9000');
            expect(await popup.$eval('#clearBtn', (el) => el.disabled)).toBe(false);

            await setTarget(popup, 'https://api.example.test:9000');
            expect(await hidden(popup, '#normalizedPreview')).toBe(true);

            await setTarget(popup, 'https://*.example.test');
            expect(await hidden(popup, '#originError')).toBe(false);
            expect(await text(popup, '#originError')).toMatch(/wildcard|invalid/i);
            expect(await attr(popup, '#originInput', 'aria-invalid')).toBe('true');
            expect(await popup.$eval('#clearBtn', (el) => el.disabled)).toBe(true);

            await setTarget(popup, '');
            expect(await popup.$eval('#clearBtn', (el) => el.disabled)).toBe(true);
            expect(await hidden(popup, '#originError')).toBe(true);
        });
    }));

    test('the header has the options button and the Test Mode tag follows the setting', guarded(env, 'header', async () => {
        await withPopup(async (popup) => {
            expect(await hidden(popup, '#testModeTag')).toBe(true);
            expect(await attr(popup, '#optionsBtn', 'aria-label')).toBeTruthy();
            expect(await text(popup, '#versionTag')).toMatch(/^v\d+\.\d+\.\d+$/);
        });

        await inExtensionPage(() => chrome.storage.local.set({ 'aw.testMode': { enabled: true, allowedOrigins: ['http://localhost'] } }));
        try {
            await withPopup(async (popup) => {
                expect(await hidden(popup, '#testModeTag')).toBe(false);
                expect(await text(popup, '#testModeTag')).toMatch(/test/i);
            });
        } finally {
            await inExtensionPage(() => chrome.storage.local.remove('aw.testMode'));
        }

        // the options button opens the options page in a tab
        await withPopup(async (popup) => {
            const opened = env.browser.waitForTarget((t) => t.url().endsWith('/options.html'), { timeout: 10000 });
            await popup.click('#optionsBtn');
            const page = await (await opened).page();
            await page?.close();
        });
    }));

    test('every control has an accessible name and the status region is live', guarded(env, 'a11y-names', async () => {
        await withPopup(async (popup) => {
            const unnamed = await popup.$$eval('#screenMain input, #screenMain select, #screenMain button', (els) => els
                .filter((el) => {
                    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') ||
                        (el.labels && el.labels.length > 0) || el.textContent.trim() || el.title;
                    return !labelled;
                })
                .map((el) => el.id || el.outerHTML.slice(0, 80)));
            expect(unnamed).toEqual([]);
            expect(await attr(popup, '#statusMessage', 'aria-live')).toBe('polite');
            expect(await attr(popup, '#scopeNote', 'aria-live')).toBe('polite');
            expect(await attr(popup, '#presetBar', 'role')).toBe('group');
        });
    }));
});

suite('Presets', () => {
    test('Fresh start is the default; presets set the checkboxes and mark themselves pressed', guarded(env, 'presets-apply', async () => {
        await withPopup(async (popup) => {
            expect(await pressed(popup, 'fresh')).toBe('true');
            expect(await getSelectedTypes(popup)).toEqual(['cookies', 'localStorage', 'indexedDB', 'fileSystems', 'cacheStorage', 'serviceWorkers']);
            expect(await hidden(popup, '#presetStatus')).toBe(true);

            await popup.click('[data-preset="logout"]');
            expect(await pressed(popup, 'logout')).toBe('true');
            expect(await pressed(popup, 'fresh')).toBe('false');
            // sessionStorage belongs to the logout preset but needs the active tab
            expect(await getSelectedTypes(popup)).toEqual(['cookies']);

            await popup.click('[data-preset="stale"]');
            expect(await getSelectedTypes(popup)).toEqual(['cache', 'cacheStorage', 'serviceWorkers']);
            expect(await getScope(popup)).toBe('exact');

            await popup.click('[data-preset="full"]');
            expect(await pressed(popup, 'full')).toBe('true');
            expect((await getSelectedTypes(popup)).length).toBe(7);
            expect(await getDisabledTypes(popup)).toEqual(['sessionStorage']);
        });
    }));

    test('diverging from the preset shows "Custom · N of 8 selected" and unpresses the buttons', guarded(env, 'presets-custom', async () => {
        await withPopup(async (popup) => {
            await popup.click('[data-preset="fresh"]');
            await popup.$eval('input[value="indexedDB"]', (el) => el.click());
            expect(await hidden(popup, '#presetStatus')).toBe(false);
            expect(await text(popup, '#presetStatus')).toMatch(/custom/i);
            expect((await text(popup, '#presetStatus')).match(/\d+/g)).toEqual(['5', '8']);
            for (const preset of ['logout', 'fresh', 'stale', 'full']) expect(await pressed(popup, preset)).toBe('false');

            // restoring the selection restores the preset
            await popup.$eval('input[value="indexedDB"]', (el) => el.click());
            expect(await hidden(popup, '#presetStatus')).toBe(true);
            expect(await pressed(popup, 'fresh')).toBe('true');
        });
    }));

    test('the preset bar is a roving-tabindex group operable with arrow keys, Enter and Space', guarded(env, 'presets-keyboard', async () => {
        await withPopup(async (popup) => {
            const tabindexes = () => popup.$$eval('#presetBar [data-preset]', (els) => els.map((e) => e.tabIndex));
            expect(await tabindexes()).toEqual([-1, 0, -1, -1]); // Fresh start is active

            await popup.focus('[data-preset="fresh"]');
            await popup.keyboard.press('ArrowRight');
            expect(await popup.evaluate(() => document.activeElement.dataset.preset)).toBe('stale');
            expect(await tabindexes()).toEqual([-1, -1, 0, -1]);
            // arrows only move focus; Enter applies
            expect(await pressed(popup, 'stale')).toBe('false');
            await popup.keyboard.press('Enter');
            expect(await pressed(popup, 'stale')).toBe('true');

            await popup.keyboard.press('ArrowRight');
            await popup.keyboard.press('Space');
            expect(await pressed(popup, 'full')).toBe('true');
            await popup.keyboard.press('ArrowRight'); // wraps around
            expect(await popup.evaluate(() => document.activeElement.dataset.preset)).toBe('logout');
            await popup.keyboard.press('End');
            expect(await popup.evaluate(() => document.activeElement.dataset.preset)).toBe('full');
            await popup.keyboard.press('Home');
            expect(await popup.evaluate(() => document.activeElement.dataset.preset)).toBe('logout');
        });
    }));

    test('custom presets from settings appear in the "more presets" select and carry their origins', guarded(env, 'presets-custom-list', async () => {
        const setup = await env.browser.newPage();
        try {
            await setup.goto(`chrome-extension://${env.extensionId}/options.html`, { waitUntil: 'load' });
            await setup.evaluate(() => chrome.storage.sync.set({
                'aw.preset.my-api': {
                    id: 'my-api', name: 'My API reset', dataTypes: ['localStorage', 'indexedDB'], cookieMode: 'exact',
                    after: 'none', startPath: '/', origins: ['https://api.example.test:8443', 'https://cdn.example.test']
                }
            }));
            await withPopup(async (popup) => {
                expect(await hidden(popup, '#presetMore')).toBe(false);
                expect(await popup.$$eval('#presetMore option', (els) => els.map((e) => e.textContent.trim()))).toContain('My API reset');
                await popup.select('#presetMore', 'my-api');
                expect(await getSelectedTypes(popup)).toEqual(['localStorage', 'indexedDB']);
                expect(await popup.$eval('#presetMore', (el) => el.value)).toBe('my-api');
                // origins of the preset are pre-filled as chips
                expect(await popup.$$eval('#extraOrigins .chip .mono', (els) => els.map((e) => e.textContent)))
                    .toEqual(['https://api.example.test:8443', 'https://cdn.example.test']);
                expect(await text(popup, '#clearBtn')).toMatch(/3/);
            });
        } finally {
            await setup.evaluate(() => chrome.storage.sync.remove('aw.preset.my-api')).catch(() => {});
            await setup.close();
        }
    }));
});

suite('Origins, range and disabled states', () => {
    test('extra origins: add, duplicate, remove, limit and sign-in provider warning', guarded(env, 'extra-origins-ui', async () => {
        await withPopup(async (popup) => {
            expect(await hidden(popup, '#extraOrigins')).toBe(true);
            await popup.click('#addOriginBtn');
            expect(await attr(popup, '#addOriginBtn', 'aria-expanded')).toBe('true');

            await popup.type('#extraOriginInput', 'https://api.example.test:8443/ignored\n');
            expect(await popup.$$eval('#extraOrigins .chip .mono', (els) => els.map((e) => e.textContent))).toEqual(['https://api.example.test:8443']);

            // adding the same origin or the primary one again is refused
            await replaceText(popup, '#extraOriginInput', 'https://api.example.test:8443\n');
            expect(await popup.$$eval('#extraOrigins .chip', (els) => els.length)).toBe(1);
            await replaceText(popup, '#extraOriginInput', `${DEFAULT_PRIMARY}\n`);
            expect(await popup.$$eval('#extraOrigins .chip', (els) => els.length)).toBe(1);
            // wildcards are refused
            await replaceText(popup, '#extraOriginInput', 'https://*.example.test\n');
            expect(await waitForStatus(popup, 'error')).toMatch(/wildcard|invalid/i);
            expect(await popup.$$eval('#extraOrigins .chip', (els) => els.length)).toBe(1);

            // third-party sign-in provider: warning about other sites
            expect(await hidden(popup, '#idpWarning')).toBe(true);
            await replaceText(popup, '#extraOriginInput', 'accounts.google.com\n');
            expect(await hidden(popup, '#idpWarning')).toBe(false);
            expect(await text(popup, '#idpWarning')).toContain('accounts.google.com');

            // chips are removable; the warning goes with the chip
            await popup.click('#extraOrigins .chip:nth-child(2) .chip-remove');
            expect(await hidden(popup, '#idpWarning')).toBe(true);

            // at most 10 origins in total (primary + 9)
            for (let i = 0; i < 12; i++) await popup.type('#extraOriginInput', `https://s${i}.example.test\n`);
            expect(await popup.$$eval('#extraOrigins .chip', (els) => els.length)).toBe(9);
            expect(await text(popup, '#clearBtn')).toMatch(/10/);
            expect(await waitForStatus(popup, 'error')).toMatch(/10/);
        });
    }));

    test('Session Storage and the after-action are disabled with an explanation for a typed target', guarded(env, 'disabled-explained', async () => {
        await withPopup(async (popup) => {
            expect(await getDisabledTypes(popup)).toEqual(['sessionStorage']);
            expect(await popup.$eval('[data-row="sessionStorage"]', (el) => el.title)).toMatch(/active tab/i);
            expect(await popup.$eval('[data-row="sessionStorage"]', (el) => getComputedStyle(el).opacity)).toBe('0.6');
            expect(await popup.$eval('#afterSelect', (el) => ({ disabled: el.disabled, value: el.value, title: el.title })))
                .toEqual({ disabled: true, value: 'none', title: expect.stringMatching(/active tab/i) });
            // counts are not measurable without the tab; the HTTP cache never is
            for (const type of await getOfferedTypes(popup)) {
                expect(await text(popup, `[data-count-for="${type}"]`)).toBe('–');
            }
        });
    }));

    test('the time range: options, note, and exact cookies cannot be limited by time', guarded(env, 'range-ui', async () => {
        await withPopup(async (popup) => {
            const options = await popup.$$eval('#rangeSelect option', (els) => els.map((e) => ({ value: e.value, disabled: e.disabled })));
            expect(options).toEqual([
                { value: 'all', disabled: false }, { value: '15m', disabled: false },
                { value: '1h', disabled: false }, { value: 'session', disabled: true }
            ]);
            expect(await popup.$eval('#rangeSelect', (el) => el.value)).toBe('all');
            expect(await hidden(popup, '#rangeNote')).toBe(true);

            await popup.select('#rangeSelect', '15m');
            expect(await hidden(popup, '#rangeNote')).toBe(false);
            expect(await getDisabledTypes(popup)).toEqual(['cookies', 'sessionStorage']);
            expect(await popup.$eval('[data-row="cookies"]', (el) => el.title)).toMatch(/time/i);
            // the summary stays reachable so the scope can be switched to domain-wide
            expect(await hidden(popup, '#cookieSummary')).toBe(false);
            await setCookieMode(popup, 'wide');
            expect(await getDisabledTypes(popup)).toEqual(['sessionStorage']);
            expect(await getSelectedTypes(popup)).toContain('cookies');
        });
    }));

    test('the "since test session" option needs a started session', guarded(env, 'range-session', async () => {
        const setup = await env.browser.newPage();
        try {
            await setup.goto(`chrome-extension://${env.extensionId}/options.html`, { waitUntil: 'load' });
            await setup.evaluate(() => chrome.storage.session.set({ 'aw.sessionStart': Date.now() - 60000 }));
            await withPopup(async (popup) => {
                expect(await popup.$eval('#rangeSelect option[value="session"]', (el) => ({ disabled: el.disabled, label: el.textContent }))).toEqual({
                    disabled: false, label: expect.stringMatching(/\d/)
                });
            });
        } finally {
            await setup.evaluate(() => chrome.storage.session.remove('aw.sessionStart')).catch(() => {});
            await setup.close();
        }
    }));

    test('the clear button shows the shortcut of "clean last preset" when one is set', guarded(env, 'shortcut-tag', async () => {
        await withPopup(async (popup) => {
            const expected = await popup.evaluate(async () => {
                const command = (await chrome.commands.getAll()).find((c) => c.name === 'clean-last-preset');
                return command && command.shortcut ? command.shortcut.replace(/\s+/g, '') : '';
            });
            const tag = await popup.$eval('#clearBtn .shortcut-tag', (el) => ({ hidden: el.hidden, text: el.textContent }));
            expect(tag.hidden).toBe(!expected);
            expect(tag.text).toBe(expected);
        });
    }));
});

suite('Screen 2 without host access (denied path)', () => {
    const DENIED_ORIGIN = 'https://staging.example.test';

    test('Clear with exact cookies sends the user to the cookie screen; nothing is deleted or widened silently', guarded(env, 'cookies-no-access', async () => {
        await resetBrowserState(env.browser, Object.values(env.origins));
        const page = await env.browser.newPage();
        try { await seedOrigin(page, env.origins.A); } finally { await page.close(); }

        await withPopup(async (popup) => {
            await setTarget(popup, env.origins.A);
            await selectTypes(popup, ['cookies']);
            expect(await getScope(popup)).toBe('exact');
            expect(await text(popup, '#cookieSummary')).toMatch(/exact/i);

            await clickClear(popup);
            await popup.waitForSelector('#screenCookies:not([hidden])');
            expect(await popup.evaluate(() => document.body.dataset.screen)).toBe('cookies');
            await popup.waitForSelector('#cookiePermissionNotice:not([hidden])');
            expect(await popup.$eval('#cookieGrantBtn', (el) => el.disabled)).toBe(false);
            // no list without access, and the mode was not changed behind the user's back
            expect(await popup.$$eval('input[data-cookie-id]', (els) => els.length)).toBe(0);
            expect(await attr(popup, '#cookieModeExact', 'aria-pressed')).toBe('true');
            expect(await attr(popup, '#cookieModeWide', 'aria-pressed')).toBe('false');
            expect(await isShown(popup, '#cookieSaveBtn')).toBe(true);

            // the cookies are untouched
            expect((await readState(env.browser, env.origins.A)).cookies).toContain(SEED.cookieHttpOnly);

            // going back keeps the exact scope
            await popup.click('#cookieBackBtn');
            await waitForMain(popup);
            expect(await getScope(popup)).toBe('exact');
        });
    }));

    test('choosing Domain-wide explicitly works without host access and asks for the red confirmation', guarded(env, 'cookies-wide-explicit', async () => {
        await withPopup(async (popup) => {
            await setTarget(popup, DENIED_ORIGIN);
            await selectTypes(popup, ['cookies']);
            await popup.click('#cookieManageBtn');
            await popup.waitForSelector('#cookiePermissionNotice:not([hidden])');
            await popup.click('#cookieModeWide');
            expect(await attr(popup, '#cookieModeWide', 'aria-pressed')).toBe('true');
            expect(await text(popup, '#cookieFooterNote')).toMatch(/domain-wide/i);
            await popup.click('#cookieSaveBtn');
            await waitForMain(popup);
            expect(await getScope(popup)).toBe('wide');
            expect(await hidden(popup, '[data-row="cookies"] .scope-tag')).toBe(false);

            await clickClear(popup);
            await waitForConfirm(popup);
            expect(await popup.$eval('#confirmBtn', (el) => el.classList.contains('btn-danger'))).toBe(true);
            await popup.keyboard.press('Escape');
            await waitForMain(popup);
            expect(await text(popup, '#statusMessage')).toMatch(/cancel/i);
        });
    }));

    test('Enter confirms from the confirmation screen (the button is focused) and Escape cancels', guarded(env, 'confirm-keyboard', async () => {
        await resetBrowserState(env.browser, Object.values(env.origins));
        const page = await env.browser.newPage();
        try { await seedOrigin(page, env.origins.A); } finally { await page.close(); }
        await withPopup(async (popup) => {
            await setTarget(popup, env.origins.A);
            await selectTypes(popup, ['cookies']);
            await setCookieMode(popup, 'wide');
            await clickClear(popup);
            await waitForConfirm(popup);
            expect(await popup.evaluate(() => document.activeElement.id)).toBe('confirmBtn');
            await popup.keyboard.press('Enter');
            expect((await waitForResult(popup)).tone).toBe('success');
            expect((await readState(env.browser, env.origins.A)).cookies).toEqual([]);
            expect(await hidden(popup, '#screenConfirm')).toBe(true);
        });
    }));
});

const DEFAULT_PRIMARY = 'http://localhost:9';

/** True when the element is rendered (not display:none). */
async function isShown(popup, selector) {
    return popup.$eval(selector, (el) => el.getClientRects().length > 0);
}
