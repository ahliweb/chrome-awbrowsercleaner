/**
 * AW Browser Cleaner - i18n helpers
 *
 * Shared by the popup and the options page. Uses chrome.i18n when available
 * and falls back to an optional English map (for tests and non-extension
 * contexts). Text is only ever written through textContent / attributes,
 * never innerHTML.
 */

/** @type {Record<string, string>} */
let fallbackMessages = {};

/**
 * Sets the fallback message map (key to message with $1/$2 placeholders).
 *
 * @param {Record<string, string>} [map]
 * @returns {void}
 */
export function setFallbackMessages(map) {
    fallbackMessages = map && typeof map === 'object' ? { ...map } : {};
}

/**
 * @param {string} template
 * @param {string[]} subs
 * @returns {string}
 */
function applySubstitutions(template, subs) {
    return template.replace(/\$([1-9])/g, (match, n) => {
        const value = subs[Number(n) - 1];
        return value === undefined ? match : value;
    });
}

/**
 * @param {unknown} substitutions
 * @returns {string[]}
 */
function toSubstitutionList(substitutions) {
    if (substitutions === undefined || substitutions === null) return [];
    return (Array.isArray(substitutions) ? substitutions : [substitutions]).map(String);
}

/**
 * Looks a message up; null when unknown.
 *
 * @param {string} key
 * @param {unknown} [substitutions]
 * @returns {string|null}
 */
function lookup(key, substitutions) {
    const subs = toSubstitutionList(substitutions);
    try {
        const api = globalThis.chrome?.i18n;
        if (api && typeof api.getMessage === 'function') {
            const message = subs.length ? api.getMessage(key, subs) : api.getMessage(key);
            if (message) return message;
        }
    } catch (e) {
        // fall through to the fallback map
    }
    if (Object.prototype.hasOwnProperty.call(fallbackMessages, key)) {
        return applySubstitutions(String(fallbackMessages[key]), subs);
    }
    return null;
}

/**
 * Returns a localized message, an English fallback, or the key itself.
 *
 * @param {string} key
 * @param {string|string[]} [substitutions]
 * @returns {string}
 */
export function getMessage(key, substitutions) {
    const message = lookup(key, substitutions);
    return message === null ? key : message;
}

const ATTRIBUTE_BINDINGS = Object.freeze([
    { selector: '[data-i18n-placeholder]', attr: 'data-i18n-placeholder', target: 'placeholder' },
    { selector: '[data-i18n-title]', attr: 'data-i18n-title', target: 'title' },
    { selector: '[data-i18n-aria]', attr: 'data-i18n-aria', target: 'aria-label' }
]);

/**
 * Localizes a document or subtree.
 *
 * Handles data-i18n (textContent), data-i18n-placeholder, data-i18n-title and
 * data-i18n-aria (aria-label). Elements whose key is unknown keep their
 * existing text. Also sets documentElement.lang from chrome.i18n.getUILanguage().
 *
 * @param {Document|Element} [root]
 * @returns {void}
 */
export function localizeDocument(root = globalThis.document) {
    if (!root || typeof root.querySelectorAll !== 'function') return;

    for (const el of root.querySelectorAll('[data-i18n]')) {
        const message = lookup(el.getAttribute('data-i18n'));
        if (message !== null) el.textContent = message;
    }
    for (const { selector, attr, target } of ATTRIBUTE_BINDINGS) {
        for (const el of root.querySelectorAll(selector)) {
            const message = lookup(el.getAttribute(attr));
            if (message !== null) el.setAttribute(target, message);
        }
    }

    const docEl = root.documentElement || root.ownerDocument?.documentElement;
    try {
        const lang = globalThis.chrome?.i18n?.getUILanguage?.();
        if (docEl && lang) docEl.lang = lang;
    } catch (e) {
        // leave lang untouched
    }
}
