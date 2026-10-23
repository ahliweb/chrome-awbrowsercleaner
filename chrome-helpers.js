/**
 * AW Browser Cleaner - Chrome helpers
 *
 * Small Chrome API helpers shared by the popup and the service worker. The
 * Chrome API object is injected (default: globalThis.chrome) so the helpers
 * stay unit-testable. Nothing here deletes data.
 */

import { normalizeTarget } from './origin-utils.js';

/** Hosts whose pages extensions can neither script nor read cookies for. */
const WEB_STORE_HOSTS = Object.freeze(['chromewebstore.google.com']);

/**
 * Whether a URL is a Chrome Web Store page.
 * @param {URL} url - Parsed URL.
 * @returns {boolean} True for the Web Store.
 */
function isWebStore(url) {
    if (WEB_STORE_HOSTS.includes(url.hostname)) return true;
    return url.hostname === 'chrome.google.com' &&
        (url.pathname === '/webstore' || url.pathname.startsWith('/webstore/'));
}

/**
 * Whether the extension can act on a page URL: http(s) only, and not the
 * Chrome Web Store (extensions cannot script it).
 *
 * @param {unknown} url - Tab URL.
 * @returns {boolean} True for supported pages.
 */
export function isScriptableUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    let parsed;
    try {
        parsed = new URL(url);
    } catch (e) {
        return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return !isWebStore(parsed);
}

/**
 * Returns the active tab of the current window.
 *
 * @param {Object} [api] - Chrome API object.
 * @returns {Promise<Object|null>} The tab, or null when there is none.
 */
export async function getActiveTab(api = globalThis.chrome) {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return Array.isArray(tabs) && tabs.length > 0 ? tabs[0] : null;
}

/**
 * Finds the cookie store (regular, incognito, container) that holds a tab.
 *
 * @param {Object} api - Chrome API object.
 * @param {number} tabId - Tab id.
 * @returns {Promise<string|undefined>} Store id, or undefined when unknown.
 */
export async function getCookieStoreId(api, tabId) {
    try {
        const stores = await api.cookies.getAllCookieStores();
        const store = (stores || []).find(s => Array.isArray(s.tabIds) && s.tabIds.includes(tabId));
        return store ? store.id : undefined;
    } catch (e) {
        return undefined;
    }
}

/**
 * Describes a tab for cleanup: its id, exact origin and cookie store.
 *
 * @param {Object} api - Chrome API object.
 * @param {{id?: number, url?: string}|null|undefined} tab - Tab from chrome.tabs.
 * @returns {Promise<{id: number, origin: string, storeId: string|undefined}|null>}
 *   Null for tabs that cannot be cleaned (chrome://, file://, about:, extension
 *   pages, the Web Store, or a tab without a readable URL).
 */
export async function tabContext(api, tab) {
    if (!tab || !Number.isInteger(tab.id) || !isScriptableUrl(tab.url)) return null;
    const target = normalizeTarget(tab.url);
    if (!target.valid) return null;
    const storeId = await getCookieStoreId(api, tab.id);
    return { id: tab.id, origin: target.origin, storeId };
}
