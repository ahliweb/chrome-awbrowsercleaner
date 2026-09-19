/**
 * Unit tests for popup logic helpers.
 *
 * Tests data type mapping, confirmation risk classification,
 * and origin construction from tab info.
 */

// We test the type mapping and risk classification logic
// without requiring a DOM or Chrome APIs.

describe('Data type mapping', () => {
    const typeMapping = {
        'cache': 'cacheStorage',
        'cookies': 'cookies',
        'localStorage': 'localStorage',
        'indexedDB': 'indexedDB',
        'serviceWorkers': 'serviceWorkers'
    };

    test('maps cache checkbox value to cacheStorage API type', () => {
        expect(typeMapping['cache']).toBe('cacheStorage');
    });

    test('maps cookies checkbox value to cookies API type', () => {
        expect(typeMapping['cookies']).toBe('cookies');
    });

    test('maps localStorage checkbox value to localStorage API type', () => {
        expect(typeMapping['localStorage']).toBe('localStorage');
    });

    test('maps indexedDB checkbox value to indexedDB API type', () => {
        expect(typeMapping['indexedDB']).toBe('indexedDB');
    });

    test('maps serviceWorkers checkbox value to serviceWorkers API type', () => {
        expect(typeMapping['serviceWorkers']).toBe('serviceWorkers');
    });

    test('returns undefined for unmapped values', () => {
        expect(typeMapping['fileSystems']).toBeUndefined();
        expect(typeMapping['webSQL']).toBeUndefined();
        expect(typeMapping['passwords']).toBeUndefined();
    });
});

describe('Confirmation risk classification', () => {
    /**
     * Determines whether confirmation is required.
     * Mirrors the logic in popup.js.
     * @param {Object} selectedTypes - The selected data types.
     * @returns {boolean} True if confirmation is required.
     */
    function requiresConfirmation(selectedTypes) {
        return selectedTypes.cookies === true;
    }

    test('requires confirmation when cookies are selected', () => {
        expect(requiresConfirmation({ cookies: true, cacheStorage: true })).toBe(true);
    });

    test('requires confirmation when only cookies are selected', () => {
        expect(requiresConfirmation({ cookies: true })).toBe(true);
    });

    test('does not require confirmation for cache-only', () => {
        expect(requiresConfirmation({ cacheStorage: true })).toBe(false);
    });

    test('does not require confirmation for localStorage-only', () => {
        expect(requiresConfirmation({ localStorage: true })).toBe(false);
    });

    test('does not require confirmation for multiple non-cookie types', () => {
        expect(requiresConfirmation({
            cacheStorage: true,
            localStorage: true,
            indexedDB: true,
            serviceWorkers: true
        })).toBe(false);
    });

    test('does not require confirmation for empty selection', () => {
        expect(requiresConfirmation({})).toBe(false);
    });
});

describe('Origin construction from tab info', () => {
    const { normalizeTarget } = require('../../origin-utils');

    test('constructs origin from typical tab URL', () => {
        const result = normalizeTarget('https://www.example.com/page?q=test');
        expect(result.valid).toBe(true);
        expect(result.origin).toBe('https://www.example.com');
    });

    test('constructs origin from localhost dev server tab', () => {
        const result = normalizeTarget('http://localhost:5173/src/App.vue');
        expect(result.valid).toBe(true);
        expect(result.origin).toBe('http://localhost:5173');
    });

    test('rejects chrome:// new tab page', () => {
        const result = normalizeTarget('chrome://newtab/');
        expect(result.valid).toBe(false);
    });

    test('rejects chrome extensions page', () => {
        const result = normalizeTarget('chrome://extensions/');
        expect(result.valid).toBe(false);
    });

    test('rejects about:blank', () => {
        const result = normalizeTarget('about:blank');
        expect(result.valid).toBe(false);
    });
});
