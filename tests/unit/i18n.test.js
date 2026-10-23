/**
 * Unit tests for i18n.js (minimal fake DOM, no jsdom)
 */

import { getMessage, localizeDocument, setFallbackMessages } from '../../i18n.js';

function fakeElement(attrs = {}, text = '') {
    const attributes = new Map(Object.entries(attrs));
    return {
        textContent: text,
        innerHTML: undefined,
        getAttribute: n => (attributes.has(n) ? attributes.get(n) : null),
        setAttribute: (n, v) => { attributes.set(n, v); },
        hasAttribute: n => attributes.has(n),
        attributes
    };
}

function fakeDocument(elements) {
    const documentElement = { lang: '' };
    return {
        documentElement,
        querySelectorAll(selector) {
            const attr = selector.slice(1, -1);
            return elements.filter(e => e.hasAttribute(attr));
        }
    };
}

const originalChrome = globalThis.chrome;
afterEach(() => {
    globalThis.chrome = originalChrome;
    setFallbackMessages({});
});

function installChrome(messages, lang = 'id') {
    globalThis.chrome = {
        i18n: {
            getMessage: (key, subs) => {
                const m = messages[key];
                if (!m) return '';
                const list = subs === undefined ? [] : [].concat(subs);
                return m.replace(/\$([1-9])/g, (x, n) => list[n - 1] ?? x);
            },
            getUILanguage: () => lang
        }
    };
}

describe('getMessage', () => {
    test('prefers chrome.i18n', () => {
        installChrome({ hello: 'Halo $1' });
        setFallbackMessages({ hello: 'Hello $1' });
        expect(getMessage('hello', 'Dunia')).toBe('Halo Dunia');
        expect(getMessage('hello', ['A'])).toBe('Halo A');
    });

    test('falls back to the map when chrome returns empty', () => {
        installChrome({});
        setFallbackMessages({ hello: 'Hello $1 and $2' });
        expect(getMessage('hello', ['A', 'B'])).toBe('Hello A and B');
        expect(getMessage('hello', 'A')).toBe('Hello A and $2');
    });

    test('falls back to the map without chrome', () => {
        globalThis.chrome = undefined;
        setFallbackMessages({ ok: 'OK' });
        expect(getMessage('ok')).toBe('OK');
    });

    test('returns the key when nothing is known', () => {
        globalThis.chrome = undefined;
        expect(getMessage('missingKey')).toBe('missingKey');
        expect(getMessage('toString')).toBe('toString');
    });

    test('survives a throwing chrome.i18n', () => {
        globalThis.chrome = { i18n: { getMessage: () => { throw new Error('invalidated'); } } };
        setFallbackMessages({ k: 'v' });
        expect(getMessage('k')).toBe('v');
    });

    test('setFallbackMessages copies and tolerates junk', () => {
        const map = { k: 'v' };
        setFallbackMessages(map);
        map.k = 'changed';
        globalThis.chrome = undefined;
        expect(getMessage('k')).toBe('v');
        setFallbackMessages(null);
        expect(getMessage('k')).toBe('k');
    });
});

describe('localizeDocument', () => {
    test('localizes text and attributes', () => {
        installChrome({ a: 'Teks', b: 'Isi', c: 'Judul', d: 'Label' });
        const text = fakeElement({ 'data-i18n': 'a' }, 'old');
        const input = fakeElement({ 'data-i18n-placeholder': 'b' });
        const btn = fakeElement({ 'data-i18n-title': 'c', 'data-i18n-aria': 'd' });
        const doc = fakeDocument([text, input, btn]);
        localizeDocument(doc);
        expect(text.textContent).toBe('Teks');
        expect(input.getAttribute('placeholder')).toBe('Isi');
        expect(btn.getAttribute('title')).toBe('Judul');
        expect(btn.getAttribute('aria-label')).toBe('Label');
        expect(doc.documentElement.lang).toBe('id');
    });

    test('keeps existing text for unknown keys', () => {
        installChrome({});
        const el = fakeElement({ 'data-i18n': 'nope' }, 'Default text');
        localizeDocument(fakeDocument([el]));
        expect(el.textContent).toBe('Default text');
    });

    test('uses the fallback map and never touches innerHTML', () => {
        globalThis.chrome = undefined;
        setFallbackMessages({ x: '<img src=x onerror=alert(1)>' });
        const el = fakeElement({ 'data-i18n': 'x' });
        localizeDocument(fakeDocument([el]));
        expect(el.textContent).toBe('<img src=x onerror=alert(1)>');
        expect(el.innerHTML).toBeUndefined();
    });

    test('does not set lang without chrome.i18n.getUILanguage', () => {
        globalThis.chrome = undefined;
        const doc = fakeDocument([]);
        localizeDocument(doc);
        expect(doc.documentElement.lang).toBe('');
    });

    test('accepts an element root with ownerDocument', () => {
        installChrome({ a: 'Teks' }, 'en');
        const el = fakeElement({ 'data-i18n': 'a' });
        const doc = fakeDocument([el]);
        const root = { querySelectorAll: doc.querySelectorAll.bind(doc), ownerDocument: doc };
        localizeDocument(root);
        expect(el.textContent).toBe('Teks');
        expect(doc.documentElement.lang).toBe('en');
    });

    test('ignores invalid roots', () => {
        expect(() => localizeDocument(null)).not.toThrow();
        expect(() => localizeDocument({})).not.toThrow();
    });
});
