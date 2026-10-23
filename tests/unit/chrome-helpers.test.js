/**
 * Unit tests for chrome-helpers.js
 */

import { describe, test, expect } from 'bun:test';
import { isScriptableUrl, getActiveTab, getCookieStoreId, tabContext } from '../../chrome-helpers.js';

/** Minimal fake chrome API with call recording. */
function fakeApi({ tabs = [], stores = [], storesError = null } = {}) {
    const calls = [];
    return {
        calls,
        api: {
            tabs: {
                query: async query => { calls.push(['tabs.query', query]); return tabs; }
            },
            cookies: {
                getAllCookieStores: async () => {
                    calls.push(['cookies.getAllCookieStores']);
                    if (storesError) throw storesError;
                    return stores;
                }
            }
        }
    };
}

describe('isScriptableUrl', () => {
    test('accepts http and https pages', () => {
        expect(isScriptableUrl('https://app.example.test/path?q=1#h')).toBe(true);
        expect(isScriptableUrl('http://localhost:3000/')).toBe(true);
        expect(isScriptableUrl('https://chrome.google.com/other')).toBe(true);
    });

    test('rejects browser-internal, file, extension and opaque URLs', () => {
        for (const url of [
            'chrome://extensions', 'chrome-untrusted://x/', 'edge://settings', 'about:blank', 'file:///tmp/a.html',
            'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html', 'data:text/html,hi',
            'blob:https://app.example.test/uuid', 'ftp://example.test/', 'javascript:alert(1)',
            'view-source:https://app.example.test/'
        ]) {
            expect(isScriptableUrl(url)).toBe(false);
        }
    });

    test('rejects the Chrome Web Store', () => {
        expect(isScriptableUrl('https://chromewebstore.google.com/')).toBe(false);
        expect(isScriptableUrl('https://chromewebstore.google.com/detail/x/abc')).toBe(false);
        expect(isScriptableUrl('https://chrome.google.com/webstore')).toBe(false);
        expect(isScriptableUrl('https://chrome.google.com/webstore/detail/x/abc')).toBe(false);
    });

    test('rejects non-strings and garbage', () => {
        for (const value of [undefined, null, '', 42, {}, 'not a url', '//example.test']) {
            expect(isScriptableUrl(value)).toBe(false);
        }
    });
});

describe('getActiveTab', () => {
    test('queries the active tab of the current window', async () => {
        const { api, calls } = fakeApi({ tabs: [{ id: 4, url: 'https://a.test/' }] });
        expect(await getActiveTab(api)).toEqual({ id: 4, url: 'https://a.test/' });
        expect(calls[0]).toEqual(['tabs.query', { active: true, currentWindow: true }]);
    });

    test('returns null when there is no tab', async () => {
        expect(await getActiveTab(fakeApi({ tabs: [] }).api)).toBeNull();
    });
});

describe('getCookieStoreId', () => {
    const stores = [{ id: '0', tabIds: [1, 2] }, { id: '1', tabIds: [9] }];

    test('returns the store that contains the tab', async () => {
        const { api } = fakeApi({ stores });
        expect(await getCookieStoreId(api, 2)).toBe('0');
        expect(await getCookieStoreId(api, 9)).toBe('1');
    });

    test('is undefined when no store has the tab', async () => {
        expect(await getCookieStoreId(fakeApi({ stores }).api, 77)).toBeUndefined();
    });

    test('is undefined when the lookup fails', async () => {
        expect(await getCookieStoreId(fakeApi({ storesError: new Error('boom') }).api, 1)).toBeUndefined();
    });
});

describe('tabContext', () => {
    const stores = [{ id: '3', tabIds: [12] }];

    test('returns id, exact origin and store for a normal tab', async () => {
        const { api } = fakeApi({ stores });
        expect(await tabContext(api, { id: 12, url: 'https://App.Example.test:443/a/b?c=d#e' }))
            .toEqual({ id: 12, origin: 'https://app.example.test', storeId: '3' });
    });

    test('keeps non-default ports', async () => {
        const { api } = fakeApi({ stores });
        const ctx = await tabContext(api, { id: 12, url: 'http://localhost:3000/x' });
        expect(ctx.origin).toBe('http://localhost:3000');
    });

    test('storeId is undefined when it cannot be determined', async () => {
        const ctx = await tabContext(fakeApi().api, { id: 12, url: 'https://a.test/' });
        expect(ctx).toEqual({ id: 12, origin: 'https://a.test', storeId: undefined });
    });

    test('returns null and makes no API call for unsupported tabs', async () => {
        for (const tab of [
            null, undefined, {}, { id: 1 }, { url: 'https://a.test/' }, { id: 1, url: 'chrome://extensions' },
            { id: 1, url: 'file:///a.html' }, { id: 1, url: 'about:blank' },
            { id: 1, url: 'chrome-extension://abc/page.html' },
            { id: 1, url: 'https://chromewebstore.google.com/detail/x' },
            { id: 1, url: 'https://chrome.google.com/webstore/detail/x' }
        ]) {
            const { api, calls } = fakeApi({ stores });
            expect(await tabContext(api, tab)).toBeNull();
            expect(calls).toEqual([]);
        }
    });
});

describe('store pages', () => {
    test('the Microsoft Edge Add-ons store is not scriptable', () => {
        expect(isScriptableUrl('https://microsoftedge.microsoft.com/addons/detail/x')).toBe(false);
    });
});
