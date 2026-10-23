/**
 * Unit tests for page-probes.js
 *
 * Probes are serialized by Chrome, so each must be self-contained. The tests
 * re-create every probe from its source text inside a `with (proxy)` scope whose
 * proxy records every free identifier the probe touches. Only page globals are
 * allowed; anything else (module-scope helpers, imports) fails the test.
 */

import { snapshotProbe, clearSessionStorageProbe, mergeFrameResults } from '../../page-probes.js';

const PAGE_GLOBALS = new Set(['location', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'navigator']);
const JS_BUILTINS = new Set(['Number', 'Promise', 'Object', 'Array', 'String', 'Error', 'Math', 'JSON', 'Boolean', 'undefined', 'Symbol', 'Infinity', 'NaN']);

/**
 * Rebuilds `fn` from its source with `fakes` as the only page globals.
 * @returns {{fn: Function, touched: Set<string>}}
 */
function isolate(fn, fakes) {
    const touched = new Set();
    const scope = new Proxy({}, {
        has: (_t, key) => typeof key === 'string',
        get: (_t, key) => {
            if (key === Symbol.unscopables) return undefined;
            touched.add(key);
            if (key in fakes) return fakes[key];
            if (JS_BUILTINS.has(key)) return globalThis[key];
            return undefined;
        }
    });
    // eslint-disable-next-line no-new-func
    const factory = new Function('scope', `with (scope) { return (${fn.toString()}); }`);
    return { fn: factory(scope), touched };
}

function fakePage(over = {}) {
    const store = (n) => ({ length: n, clear() { this.length = 0; }, getItem() { throw new Error('probe must not read values'); } });
    const files = ['a.txt', 'dir'];
    return {
        location: { origin: 'https://app.test' },
        localStorage: store(3),
        sessionStorage: store(2),
        indexedDB: { databases: async () => [{ name: 'a' }, { name: 'b' }] },
        caches: { keys: async () => ['v1'] },
        navigator: {
            serviceWorker: { getRegistrations: async () => [{}] },
            storage: {
                getDirectory: async () => ({ keys: async function* () { for (const f of files) yield f; } }),
                estimate: async () => ({ usage: 1234, quota: 99999 }),
                persisted: async () => true
            }
        },
        ...over
    };
}

describe('snapshotProbe', () => {
    test('is self-contained: touches only page globals', async () => {
        const { fn, touched } = isolate(snapshotProbe, fakePage());
        await fn('https://app.test');
        const outside = [...touched].filter(k => !PAGE_GLOBALS.has(k) && !JS_BUILTINS.has(k));
        expect(outside).toEqual([]);
        expect(touched.has('location')).toBe(true);
    });

    test('source does not rely on imports or module scope', () => {
        const src = snapshotProbe.toString();
        expect(src).not.toMatch(/\bimport\b/);
        expect(src).not.toMatch(/\brequire\b/);
        expect(src).not.toMatch(/\bchrome\b/);
    });

    test('returns null when the frame origin differs', async () => {
        const { fn } = isolate(snapshotProbe, fakePage());
        expect(await fn('https://other.test')).toBeNull();
    });

    test('returns null for opaque origins', async () => {
        const { fn } = isolate(snapshotProbe, fakePage({ location: { origin: 'null' } }));
        expect(await fn('https://app.test')).toBeNull();
    });

    test('collects counts and metadata', async () => {
        const { fn } = isolate(snapshotProbe, fakePage());
        expect(await fn('https://app.test')).toEqual({
            origin: 'https://app.test',
            localStorage: 3,
            sessionStorage: 2,
            indexedDB: 2,
            cacheStorage: 1,
            serviceWorkers: 1,
            fileSystems: 2,
            usage: 1234,
            quota: 99999,
            persisted: true
        });
    });

    test('returns only numbers/booleans/origin (no contents)', async () => {
        const { fn } = isolate(snapshotProbe, fakePage());
        const res = await fn('https://app.test');
        for (const [k, v] of Object.entries(res)) {
            if (k === 'origin') continue;
            expect(['number', 'boolean']).toContain(typeof v);
        }
    });

    test('each failing part becomes null independently', async () => {
        const boom = async () => { throw new Error('denied'); };
        const page = fakePage({
            localStorage: { get length() { throw new Error('denied'); } },
            indexedDB: { databases: boom },
            caches: { keys: boom },
            navigator: {
                serviceWorker: { getRegistrations: boom },
                storage: { getDirectory: boom, estimate: boom, persisted: boom }
            }
        });
        const { fn } = isolate(snapshotProbe, page);
        const res = await fn('https://app.test');
        expect(res).toEqual({
            origin: 'https://app.test', localStorage: null, sessionStorage: 2, indexedDB: null,
            cacheStorage: null, serviceWorkers: null, fileSystems: null, usage: null, quota: null, persisted: null
        });
    });

    test('missing APIs (databases, serviceWorker, storage) give null', async () => {
        const page = fakePage({ indexedDB: {}, navigator: {} });
        const { fn } = isolate(snapshotProbe, page);
        const res = await fn('https://app.test');
        expect(res.indexedDB).toBeNull();
        expect(res.serviceWorkers).toBeNull();
        expect(res.fileSystems).toBeNull();
        expect(res.usage).toBeNull();
        expect(res.persisted).toBeNull();
        expect(res.localStorage).toBe(3);
    });

    test('missing globals (no caches) do not throw', async () => {
        const page = fakePage();
        delete page.caches;
        const { fn } = isolate(snapshotProbe, page);
        expect((await fn('https://app.test')).cacheStorage).toBeNull();
    });
});

describe('clearSessionStorageProbe', () => {
    test('is self-contained', () => {
        const { fn, touched } = isolate(clearSessionStorageProbe, fakePage());
        fn('https://app.test');
        expect([...touched].filter(k => !PAGE_GLOBALS.has(k) && !JS_BUILTINS.has(k))).toEqual([]);
    });

    test('clears only on the matching origin and reports a count', () => {
        const page = fakePage();
        const { fn } = isolate(clearSessionStorageProbe, page);
        expect(fn('https://other.test')).toBeNull();
        expect(page.sessionStorage.length).toBe(2);
        expect(fn('https://app.test')).toEqual({ origin: 'https://app.test', cleared: 2 });
        expect(page.sessionStorage.length).toBe(0);
    });

    test('returns null when sessionStorage is inaccessible', () => {
        const page = fakePage({ sessionStorage: { get length() { throw new Error('denied'); } } });
        const { fn } = isolate(clearSessionStorageProbe, page);
        expect(fn('https://app.test')).toBeNull();
    });
});

describe('mergeFrameResults', () => {
    test('returns the first non-null result', () => {
        const a = { origin: 'x' };
        const b = { origin: 'y' };
        expect(mergeFrameResults([{ result: null }, { result: a }, { result: b }])).toBe(a);
    });

    test('returns null for nothing useful', () => {
        expect(mergeFrameResults([])).toBeNull();
        expect(mergeFrameResults([{ result: null }, { result: undefined }, {}, null])).toBeNull();
        expect(mergeFrameResults(undefined)).toBeNull();
        expect(mergeFrameResults(null)).toBeNull();
    });

    test('keeps falsy-but-meaningful results', () => {
        expect(mergeFrameResults([{ result: 0 }])).toBe(0);
    });
});
