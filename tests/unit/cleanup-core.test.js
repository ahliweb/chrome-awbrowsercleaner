/**
 * Unit tests for cleanup-core.js: registry, plan creation, Scope Guard,
 * confirmation levels, plan description and execution order.
 */

import { describe, test, expect } from 'bun:test';
import {
    MAX_ORIGINS,
    DATA_TYPES,
    DATA_TYPE_KEYS,
    FORBIDDEN_TYPES,
    AFTER_ACTIONS,
    ScopeGuardError,
    buildDataTypeSet,
    buildRemovalOptions,
    createPlan,
    validatePlan,
    confirmationLevel,
    requiresConfirmation,
    describePlan,
    executePlan,
    clearSessionStorageInFrame
} from '../../cleanup-core.js';

const ORIGIN = 'https://app.example.test';
const NOW = 1_700_000_000_000;
const clock = () => NOW;

/**
 * Creates a valid plan, throwing when the input is rejected.
 * @param {Object} over - Input overrides.
 * @returns {Object} Plan.
 */
function plan(over = {}) {
    const result = createPlan({
        source: 'popup',
        origins: [ORIGIN],
        dataTypes: ['localStorage', 'indexedDB'],
        cookieMode: 'exact',
        ...over
    }, { now: clock });
    if (!result.ok) throw new Error(`${result.code}: ${result.error}`);
    return result.plan;
}

/**
 * Creates a recording fake of the Chrome APIs used by executePlan.
 * @param {Object} [opts] - Behavior overrides.
 * @returns {{api: Object, calls: Array<Array>}} Fake API and call log.
 */
function fakeApi(opts = {}) {
    const calls = [];
    const rec = (name, impl) => async (...args) => {
        calls.push([name, ...args]);
        return impl ? impl(...args) : undefined;
    };
    const api = {
        scripting: {
            executeScript: rec('scripting.executeScript', opts.executeScript || (() => [{ frameId: 0, result: { cleared: true, count: 2 } }]))
        },
        cookies: {
            getAll: rec('cookies.getAll', opts.getAll || (() => [])),
            remove: rec('cookies.remove', opts.removeCookie || (() => ({ name: 'x' })))
        },
        permissions: {
            contains: rec('permissions.contains', opts.contains || (() => true))
        },
        browsingData: {
            remove: rec('browsingData.remove', opts.browsingData)
        },
        tabs: {
            reload: rec('tabs.reload', opts.reload),
            update: rec('tabs.update', opts.update)
        }
    };
    return { api, calls };
}

const names = (calls) => calls.map(c => c[0]);

describe('constants', () => {
    test('registry is consistent and frozen', () => {
        expect(MAX_ORIGINS).toBe(10);
        expect(DATA_TYPE_KEYS).toEqual(DATA_TYPES.map(t => t.key));
        expect(Object.isFrozen(DATA_TYPES)).toBe(true);
        expect(Object.isFrozen(DATA_TYPES[0])).toBe(true);
        expect(DATA_TYPE_KEYS).toContain('cacheStorage');
        expect(AFTER_ACTIONS).toEqual(['none', 'reload', 'hard', 'start']);
    });

    test('forbidden types are never in the registry', () => {
        for (const type of FORBIDDEN_TYPES) {
            expect(DATA_TYPE_KEYS).not.toContain(type);
        }
        expect(FORBIDDEN_TYPES).toContain('history');
        expect(FORBIDDEN_TYPES).toContain('passwords');
    });
});

describe('ScopeGuardError', () => {
    test('carries an errors array and a readable message', () => {
        const e = new ScopeGuardError([{ code: 'A', message: 'one' }, { code: 'B', message: 'two' }]);
        expect(e).toBeInstanceOf(Error);
        expect(e.name).toBe('ScopeGuardError');
        expect(e.errors).toHaveLength(2);
        expect(e.message).toContain('A: one');
        expect(new ScopeGuardError({ code: 'C', message: 'x' }).errors).toEqual([{ code: 'C', message: 'x' }]);
    });
});

describe('buildDataTypeSet', () => {
    test('maps keys to the browsingData DataTypeSet', () => {
        expect(buildDataTypeSet(['localStorage', 'cacheStorage', 'fileSystems', 'cache', 'serviceWorkers', 'indexedDB']))
            .toEqual({
                localStorage: true, cacheStorage: true, fileSystems: true,
                cache: true, serviceWorkers: true, indexedDB: true
            });
    });

    test('never includes sessionStorage', () => {
        expect(buildDataTypeSet(['sessionStorage'], { domainWide: true })).toEqual({});
    });

    test('includes cookies only when domain-wide', () => {
        expect(buildDataTypeSet(['cookies', 'localStorage'])).toEqual({ localStorage: true });
        expect(buildDataTypeSet(['cookies'], { domainWide: true })).toEqual({ cookies: true });
    });

    test('rejects forbidden, unknown and non-array input', () => {
        for (const type of FORBIDDEN_TYPES) {
            expect(() => buildDataTypeSet([type])).toThrow(ScopeGuardError);
        }
        expect(() => buildDataTypeSet(['bogus'])).toThrow(ScopeGuardError);
        expect(() => buildDataTypeSet('localStorage')).toThrow(ScopeGuardError);
        try {
            buildDataTypeSet(['history']);
        } catch (e) {
            expect(e.errors[0].code).toBe('DATATYPE_FORBIDDEN');
        }
    });
});

describe('buildRemovalOptions', () => {
    test('always sets originTypes.unprotectedWeb and the exact origins', () => {
        const options = buildRemovalOptions({ origins: [ORIGIN] });
        expect(options).toEqual({ origins: [ORIGIN], originTypes: { unprotectedWeb: true } });
        expect('since' in options).toBe(false);
    });

    test('includes since only when positive', () => {
        expect(buildRemovalOptions({ origins: [ORIGIN], since: 5 }).since).toBe(5);
        expect('since' in buildRemovalOptions({ origins: [ORIGIN], since: 0 })).toBe(false);
    });

    test('de-duplicates origins', () => {
        expect(buildRemovalOptions({ origins: [ORIGIN, ORIGIN] }).origins).toEqual([ORIGIN]);
    });

    test('throws on exclusion keys, empty or invalid origins and bad since', () => {
        expect(() => buildRemovalOptions({ origins: [ORIGIN], excludeOrigins: ['https://x.test'] })).toThrow(ScopeGuardError);
        expect(() => buildRemovalOptions({ origins: [ORIGIN], nested: { excludeOrigins: [] } })).toThrow(ScopeGuardError);
        expect(() => buildRemovalOptions({ origins: [] })).toThrow(ScopeGuardError);
        expect(() => buildRemovalOptions({})).toThrow(ScopeGuardError);
        expect(() => buildRemovalOptions(null)).toThrow(ScopeGuardError);
        expect(() => buildRemovalOptions({ origins: ['*'] })).toThrow(ScopeGuardError);
        expect(() => buildRemovalOptions({ origins: ['example.com'] })).toThrow(ScopeGuardError);
        expect(() => buildRemovalOptions({ origins: [ORIGIN + '/path'] })).toThrow(ScopeGuardError);
        expect(() => buildRemovalOptions({ origins: [42] })).toThrow(ScopeGuardError);
        expect(() => buildRemovalOptions({ origins: [ORIGIN], since: -1 })).toThrow(ScopeGuardError);
        expect(() => buildRemovalOptions({ origins: [ORIGIN], since: NaN })).toThrow(ScopeGuardError);
        const tooMany = Array.from({ length: MAX_ORIGINS + 1 }, (_, i) => `https://h${i}.test`);
        expect(() => buildRemovalOptions({ origins: tooMany })).toThrow(ScopeGuardError);
    });
});

describe('createPlan', () => {
    test('applies safe defaults', () => {
        const p = plan({ cookieMode: undefined });
        expect(p).toEqual({
            version: 1,
            source: 'popup',
            origins: [ORIGIN],
            dataTypes: ['localStorage', 'indexedDB'],
            cookieMode: 'exact',
            cookieSelection: { includeShared: [], keepNames: [] },
            since: 0,
            after: 'none',
            startPath: '/',
            presetId: 'custom',
            tab: null
        });
    });

    test('sorts data types in registry order and drops duplicates of origins', () => {
        const p = plan({ origins: [ORIGIN, ORIGIN + '/', 'HTTPS://APP.EXAMPLE.TEST:443'], dataTypes: ['indexedDB', 'cookies', 'indexedDB'], cookieMode: 'domainWide' });
        expect(p.origins).toEqual([ORIGIN]);
        expect(p.dataTypes).toEqual(['cookies', 'indexedDB']);
    });

    test('accepts a valid tab, after-action and preset', () => {
        const p = plan({ after: 'reload', tab: { id: 3, origin: ORIGIN, storeId: '0' }, presetId: 'login' });
        expect(p.after).toBe('reload');
        expect(p.presetId).toBe('login');
    });

    test('returns {ok:false, code, error} instead of throwing', () => {
        const bad = createPlan({ origins: ['example.com'], dataTypes: ['localStorage'] });
        expect(bad.ok).toBe(false);
        expect(bad.code).toBe('ORIGIN_INVALID');
        expect(typeof bad.error).toBe('string');
        expect(createPlan(null).code).toBe('PLAN_INVALID');
        expect(createPlan({ dataTypes: ['cache'] }).code).toBe('ORIGINS_REQUIRED');
        expect(createPlan({ origins: [ORIGIN], dataTypes: ['cache'], excludeOrigins: [] }).code).toBe('EXCLUDE_FORBIDDEN');
    });
});

describe('Scope Guard (validatePlan)', () => {
    const valid = () => plan();

    test('accepts a valid plan', () => {
        expect(validatePlan(valid())).toEqual({ ok: true, errors: [] });
    });

    test('rejects non-object plans', () => {
        for (const p of [null, undefined, 'x', 5, []]) {
            expect(validatePlan(p).ok).toBe(false);
        }
    });

    test.each([
        ['empty origins', { origins: [] }, 'ORIGINS_REQUIRED'],
        ['undefined origins', { origins: undefined }, 'ORIGINS_REQUIRED'],
        ['non-array origins', { origins: 'https://a.test' }, 'ORIGINS_REQUIRED'],
        ['wildcard', { origins: ['*'] }, 'ORIGIN_WILDCARD'],
        ['embedded wildcard', { origins: ['https://*.a.test'] }, 'ORIGIN_WILDCARD'],
        ['bare host', { origins: ['example.com'] }, 'ORIGIN_INVALID'],
        ['path', { origins: ['https://a.test/path'] }, 'ORIGIN_INVALID'],
        ['query', { origins: ['https://a.test/?q=1'] }, 'ORIGIN_INVALID'],
        ['hash', { origins: ['https://a.test/#h'] }, 'ORIGIN_INVALID'],
        ['credentials', { origins: ['https://user:pw@a.test'] }, 'ORIGIN_INVALID'],
        ['non-canonical', { origins: ['https://A.test'] }, 'ORIGIN_INVALID'],
        ['ftp scheme', { origins: ['ftp://a.test'] }, 'ORIGIN_INVALID'],
        ['non-string', { origins: [123] }, 'ORIGIN_INVALID'],
        ['too many', { origins: Array.from({ length: 11 }, (_, i) => `https://h${i}.test`) }, 'ORIGINS_TOO_MANY'],
        ['excludeOrigins', { excludeOrigins: ['https://x.test'] }, 'EXCLUDE_FORBIDDEN'],
        ['nested exclude key', { cookieSelection: { includeShared: [], keepNames: [], excludeX: 1 } }, 'EXCLUDE_FORBIDDEN'],
        ['no data types', { dataTypes: [] }, 'DATATYPES_REQUIRED'],
        ['non-array data types', { dataTypes: 'cache' }, 'DATATYPES_REQUIRED'],
        ['forbidden history', { dataTypes: ['history'] }, 'DATATYPE_FORBIDDEN'],
        ['forbidden passwords', { dataTypes: ['localStorage', 'passwords'] }, 'DATATYPE_FORBIDDEN'],
        ['unknown type', { dataTypes: ['bogus'] }, 'DATATYPE_UNKNOWN'],
        ['bad source', { source: 'cron' }, 'SOURCE_INVALID'],
        ['bad cookie mode', { cookieMode: 'all' }, 'COOKIE_MODE_INVALID'],
        ['bad selection', { cookieSelection: { includeShared: [1], keepNames: [] } }, 'COOKIE_SELECTION_INVALID'],
        ['bad selection shape', { cookieSelection: 'x' }, 'COOKIE_SELECTION_INVALID'],
        ['future since', { since: NOW + 1000 }, 'SINCE_FUTURE'],
        ['negative since', { since: -5 }, 'SINCE_INVALID'],
        ['NaN since', { since: NaN }, 'SINCE_INVALID'],
        ['string since', { since: '5' }, 'SINCE_INVALID'],
        ['since with exact cookies', { dataTypes: ['cookies'], cookieMode: 'exact', since: NOW - 1000 }, 'SINCE_WITH_EXACT_COOKIES'],
        ['domainWide in testMode', { source: 'testMode', cookieMode: 'domainWide' }, 'DOMAIN_WIDE_IN_TEST_MODE'],
        ['bad after', { after: 'explode' }, 'AFTER_INVALID'],
        ['after without tab', { after: 'reload', tab: null }, 'TAB_REQUIRED'],
        ['sessionStorage without tab', { dataTypes: ['sessionStorage'], tab: null }, 'TAB_REQUIRED'],
        ['tab without numeric id', { after: 'hard', tab: { id: 'x', origin: ORIGIN } }, 'TAB_REQUIRED'],
        ['tab origin not in plan', { after: 'reload', tab: { id: 1, origin: 'https://other.test' } }, 'TAB_ORIGIN_MISMATCH'],
        ['start path without slash', { after: 'start', startPath: 'x', tab: { id: 1, origin: ORIGIN } }, 'START_PATH_INVALID'],
        ['start path protocol-relative', { after: 'start', startPath: '//evil.test', tab: { id: 1, origin: ORIGIN } }, 'START_PATH_INVALID'],
        ['start path backslash', { after: 'start', startPath: '/\\evil', tab: { id: 1, origin: ORIGIN } }, 'START_PATH_INVALID']
    ])('rejects %s', (_label, patch, code) => {
        const result = validatePlan({ ...valid(), ...patch }, { now: clock });
        expect(result.ok).toBe(false);
        expect(result.errors.map(e => e.code)).toContain(code);
        for (const e of result.errors) {
            expect(typeof e.message).toBe('string');
        }
    });

    test('allows exact cookies with since = 0 and domain-wide cookies with since', () => {
        expect(validatePlan({ ...valid(), dataTypes: ['cookies'], cookieMode: 'exact', since: 0 }, { now: clock }).ok).toBe(true);
        expect(validatePlan({ ...valid(), dataTypes: ['cookies'], cookieMode: 'domainWide', since: NOW - 1 }, { now: clock }).ok).toBe(true);
    });

    test('accepts start path with a single slash and a matching tab', () => {
        const p = { ...valid(), after: 'start', startPath: '/home?x=1', tab: { id: 2, origin: ORIGIN } };
        expect(validatePlan(p, { now: clock }).ok).toBe(true);
    });

    test('createPlan surfaces the same rejections as codes', () => {
        const base = { origins: [ORIGIN], dataTypes: ['localStorage'] };
        expect(createPlan({ ...base, origins: [] }).code).toBe('ORIGINS_REQUIRED');
        expect(createPlan({ ...base, origins: undefined }).code).toBe('ORIGINS_REQUIRED');
        expect(createPlan({ ...base, origins: ['*'] }).code).toBe('ORIGIN_WILDCARD');
        expect(createPlan({ ...base, origins: ['example.com'] }).code).toBe('ORIGIN_INVALID');
        expect(createPlan({ ...base, origins: ['https://a.test/path'] }).code).toBe('ORIGIN_INVALID');
        expect(createPlan({ ...base, excludeOrigins: ['https://x.test'] }).code).toBe('EXCLUDE_FORBIDDEN');
        expect(createPlan({ ...base, origins: Array.from({ length: 11 }, (_, i) => `https://h${i}.test`) }).code).toBe('ORIGINS_TOO_MANY');
        expect(createPlan({ ...base, dataTypes: ['history'] }).code).toBe('DATATYPE_FORBIDDEN');
        expect(createPlan({ ...base, dataTypes: ['nope'] }).code).toBe('DATATYPE_UNKNOWN');
        expect(createPlan({ ...base, since: Date.now() + 60_000 }).code).toBe('SINCE_FUTURE');
        expect(createPlan({ ...base, dataTypes: ['cookies'], since: 5 }).code).toBe('SINCE_WITH_EXACT_COOKIES');
        expect(createPlan({ ...base, source: 'testMode', cookieMode: 'domainWide' }).code).toBe('DOMAIN_WIDE_IN_TEST_MODE');
        expect(createPlan({ ...base, dataTypes: ['sessionStorage'] }).code).toBe('TAB_REQUIRED');
        expect(createPlan({ ...base, after: 'reload' }).code).toBe('TAB_REQUIRED');
    });
});

describe('Scope Guard runs before any API call', () => {
    const base = () => plan();
    const bad = [
        ['empty origins', { origins: [] }],
        ['undefined origins', { origins: undefined }],
        ['wildcard', { origins: ['*'] }],
        ['bare host', { origins: ['example.com'] }],
        ['path', { origins: ['https://a.test/path'] }],
        ['excludeOrigins', { excludeOrigins: ['https://x.test'] }],
        ['too many origins', { origins: Array.from({ length: 11 }, (_, i) => `https://h${i}.test`) }],
        ['forbidden type', { dataTypes: ['history'] }],
        ['unknown type', { dataTypes: ['bogus'] }],
        ['future since', { since: Date.now() + 86_400_000 }],
        ['since with exact cookies', { dataTypes: ['cookies'], cookieMode: 'exact', since: 1000 }],
        ['domainWide in testMode', { source: 'testMode', cookieMode: 'domainWide', dataTypes: ['cookies'] }],
        ['sessionStorage without tab', { dataTypes: ['sessionStorage'], tab: null }],
        ['after without tab', { after: 'reload', tab: null }],
        ['tab for another origin', { after: 'reload', tab: { id: 1, origin: 'https://other.test' } }]
    ];

    test.each(bad)('executePlan throws ScopeGuardError for %s without touching the API', async (_label, patch) => {
        const { api, calls } = fakeApi();
        const broken = { ...base(), ...patch };
        let caught = null;
        try {
            await executePlan(broken, { api });
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(ScopeGuardError);
        expect(caught.errors.length).toBeGreaterThan(0);
        expect(calls).toEqual([]);
    });
});

describe('confirmationLevel / requiresConfirmation', () => {
    const cases = [
        ['no cookies', { dataTypes: ['localStorage'], cookieMode: 'exact' }, 'none'],
        ['no cookies, domainWide flag', { dataTypes: ['localStorage'], cookieMode: 'domainWide' }, 'none'],
        ['exact cookies', { dataTypes: ['cookies'], cookieMode: 'exact' }, 'review'],
        ['domain-wide cookies', { dataTypes: ['cookies'], cookieMode: 'domainWide' }, 'danger'],
        ['exact cookies with shared', { dataTypes: ['cookies'], cookieMode: 'exact', cookieSelection: { includeShared: ['id'], keepNames: [] } }, 'danger']
    ];
    test.each(cases)('%s -> %s', (_label, patch, level) => {
        const p = plan(patch);
        expect(confirmationLevel(p)).toBe(level);
        expect(requiresConfirmation(p)).toBe(level !== 'none');
    });

    test('tolerates sparse plans', () => {
        expect(confirmationLevel({})).toBe('none');
        expect(confirmationLevel({ dataTypes: ['cookies'], cookieMode: 'exact' })).toBe('review');
    });
});

describe('describePlan', () => {
    test('lists removals in registry order with label keys and counts', () => {
        const p = plan({ dataTypes: ['indexedDB', 'localStorage', 'cacheStorage'] });
        const d = describePlan(p, { counts: { localStorage: 4 } });
        expect(d.origin).toBe(ORIGIN);
        expect(d.origins).toEqual([ORIGIN]);
        expect(d.scope).toBe('exact');
        expect(d.preset).toBe('custom');
        expect(d.remove).toEqual([
            { type: 'localStorage', labelKey: 'dataTypeLocalStorage', count: 4 },
            { type: 'indexedDB', labelKey: 'dataTypeIndexedDB', count: null },
            { type: 'cacheStorage', labelKey: 'dataTypeCacheStorage', count: null }
        ]);
        expect(d.after).toBe('none');
        expect(d.since).toBe(0);
    });

    test('keep always has otherOrigins and browserData', () => {
        for (const patch of [
            { dataTypes: ['localStorage'] },
            { dataTypes: ['cookies'], cookieMode: 'domainWide' },
            { dataTypes: ['cookies'], cookieMode: 'exact' }
        ]) {
            const kinds = describePlan(plan(patch)).keep.map(k => k.kind);
            expect(kinds).toContain('otherOrigins');
            expect(kinds).toContain('browserData');
        }
        expect(describePlan({}).keep.map(k => k.kind)).toEqual(['otherOrigins', 'browserData']);
    });

    test('reports kept shared cookies in exact mode only', () => {
        const extras = { sharedCookies: { count: 3, domain: 'example.test' } };
        const exact = describePlan(plan({ dataTypes: ['cookies'], cookieMode: 'exact' }), extras);
        expect(exact.keep[0]).toEqual({ kind: 'sharedCookies', count: 3, domain: 'example.test' });
        const wide = describePlan(plan({ dataTypes: ['cookies'], cookieMode: 'domainWide' }), extras);
        expect(wide.keep.map(k => k.kind)).not.toContain('sharedCookies');
        expect(wide.scope).toBe('wide');
        const selected = describePlan(
            plan({ dataTypes: ['cookies'], cookieSelection: { includeShared: ['x'], keepNames: [] } }), extras);
        expect(selected.keep.map(k => k.kind)).not.toContain('sharedCookies');
        expect(selected.scope).toBe('wide');
    });

    test('marks sessionStorage as not applicable for non-active origins', () => {
        const other = 'https://other.example.test';
        const p = plan({
            origins: [ORIGIN, other],
            dataTypes: ['sessionStorage'],
            tab: { id: 1, origin: ORIGIN }
        });
        const d = describePlan(p);
        expect(d.notApplicable).toEqual([{ type: 'sessionStorage', origin: other, reason: 'notActiveTab' }]);
    });
});

describe('clearSessionStorageInFrame', () => {
    /**
     * Runs the injected function against fake page globals.
     * @param {Object} page - Fake location and sessionStorage.
     * @param {string} target - Target origin.
     * @returns {Object} Frame result.
     */
    function run(page, target) {
        const saved = { location: globalThis.location, sessionStorage: globalThis.sessionStorage };
        Object.defineProperty(globalThis, 'location', { value: page.location, configurable: true, writable: true });
        Object.defineProperty(globalThis, 'sessionStorage', { value: page.sessionStorage, configurable: true, writable: true });
        try {
            return clearSessionStorageInFrame(target);
        } finally {
            Object.defineProperty(globalThis, 'location', { value: saved.location, configurable: true, writable: true });
            Object.defineProperty(globalThis, 'sessionStorage', { value: saved.sessionStorage, configurable: true, writable: true });
        }
    }

    test('clears only when the frame origin matches', () => {
        let cleared = 0;
        const storage = { length: 3, clear: () => { cleared++; } };
        expect(run({ location: { origin: ORIGIN }, sessionStorage: storage }, ORIGIN)).toEqual({ cleared: true, count: 3 });
        expect(cleared).toBe(1);
        expect(run({ location: { origin: 'https://ad.test' }, sessionStorage: storage }, ORIGIN))
            .toEqual({ cleared: false, count: 0, skipped: true });
        expect(cleared).toBe(1);
    });

    test('reports errors instead of throwing', () => {
        const storage = { length: 1, clear: () => { throw new Error('denied'); } };
        const result = run({ location: { origin: ORIGIN }, sessionStorage: storage }, ORIGIN);
        expect(result.cleared).toBe(false);
        expect(result.error).toBe('denied');
    });

    test('is self-contained (no free variables from the module)', () => {
        const src = clearSessionStorageInFrame.toString();
        expect(src).not.toMatch(/ORIGIN|MAX_ORIGINS|DATA_TYPES|validateOrigin/);
    });
});

describe('executePlan', () => {
    test('runs sessionStorage -> cookies -> browsingData -> after in order', async () => {
        const { api, calls } = fakeApi({
            getAll: () => [{ name: 'sid', domain: 'app.example.test', hostOnly: true, path: '/', secure: true, storeId: '0', value: 'v' }]
        });
        const p = plan({
            dataTypes: ['cookies', 'sessionStorage', 'localStorage'],
            cookieMode: 'exact',
            after: 'reload',
            tab: { id: 7, origin: ORIGIN, storeId: '0' }
        });
        const result = await executePlan(p, { api, now: clock });

        const order = names(calls);
        const first = (n) => order.indexOf(n);
        expect(first('scripting.executeScript')).toBeLessThan(first('permissions.contains'));
        expect(first('permissions.contains')).toBeLessThan(first('cookies.getAll'));
        expect(order.lastIndexOf('cookies.getAll')).toBeLessThan(first('cookies.remove'));
        expect(first('cookies.remove')).toBeLessThan(first('browsingData.remove'));
        expect(first('browsingData.remove')).toBeLessThan(first('tabs.reload'));
        expect(order.filter(n => n === 'tabs.reload')).toHaveLength(1);

        expect(result.ok).toBe(true);
        expect(result.startedAt).toBe(NOW);
        expect(result.durationMs).toBe(0);
        expect(result.after).toEqual({ action: 'reload', ok: true });
        expect(result.perOrigin).toEqual([{
            origin: ORIGIN,
            types: { sessionStorage: 'ok', cookies: 'ok', localStorage: 'ok' },
            cookies: { removed: 1, kept: 0, failed: 0 },
            errors: []
        }]);
    });

    test('sessionStorage injection targets the tab with allFrames and the origin', async () => {
        const { api, calls } = fakeApi();
        const p = plan({ dataTypes: ['sessionStorage'], tab: { id: 9, origin: ORIGIN } });
        await executePlan(p, { api, now: clock });
        const call = calls.find(c => c[0] === 'scripting.executeScript')[1];
        expect(call.target).toEqual({ tabId: 9, allFrames: true });
        expect(call.func).toBe(clearSessionStorageInFrame);
        expect(call.args).toEqual([ORIGIN]);
        expect(names(calls)).not.toContain('browsingData.remove');
    });

    test('sessionStorage is skipped for non-active origins and when no frame cleared', async () => {
        const other = 'https://other.example.test';
        const { api } = fakeApi({ executeScript: () => [{ frameId: 0, result: { cleared: false, count: 0, skipped: true } }] });
        const p = plan({ origins: [ORIGIN, other], dataTypes: ['sessionStorage'], tab: { id: 1, origin: ORIGIN } });
        const result = await executePlan(p, { api, now: clock });
        expect(result.perOrigin.map(o => o.types.sessionStorage)).toEqual(['skipped', 'skipped']);
        expect(result.ok).toBe(true);
    });

    test('sessionStorage failures are recorded, not thrown', async () => {
        const thrown = fakeApi({ executeScript: () => { throw new Error('no access'); } });
        const p = plan({ dataTypes: ['sessionStorage', 'localStorage'], tab: { id: 1, origin: ORIGIN } });
        const r1 = await executePlan(p, { api: thrown.api, now: clock });
        expect(r1.ok).toBe(false);
        expect(r1.perOrigin[0].types.sessionStorage).toBe('error');
        expect(r1.perOrigin[0].types.localStorage).toBe('ok');
        expect(r1.perOrigin[0].errors[0]).toMatchObject({ type: 'sessionStorage', code: 'SESSION_STORAGE_FAILED', message: 'no access' });

        const frameError = fakeApi({ executeScript: () => [{ result: { cleared: false, count: 0, error: 'boom' } }] });
        const r2 = await executePlan(p, { api: frameError.api, now: clock });
        expect(r2.perOrigin[0].errors[0].message).toBe('boom');
    });

    test('browsingData receives exactly the plan origin and unprotectedWeb', async () => {
        const { api, calls } = fakeApi();
        const p = plan({ dataTypes: ['localStorage', 'cacheStorage'], since: NOW - 5000 });
        await executePlan(p, { api, now: clock });
        const [, options, set] = calls.find(c => c[0] === 'browsingData.remove');
        expect(options.origins).toEqual([ORIGIN]);
        expect(options.originTypes).toEqual({ unprotectedWeb: true });
        expect(options.since).toBe(NOW - 5000);
        expect(Object.keys(options).some(k => /exclude/i.test(k))).toBe(false);
        expect(set).toEqual({ localStorage: true, cacheStorage: true });
    });

    test('origins execute sequentially, one browsingData call each', async () => {
        const origins = ['https://a.test', 'https://b.test:8443', 'http://c.test'];
        const { api, calls } = fakeApi();
        const result = await executePlan(plan({ origins }), { api, now: clock });
        const removals = calls.filter(c => c[0] === 'browsingData.remove');
        expect(removals.map(c => c[1].origins)).toEqual(origins.map(o => [o]));
        expect(result.perOrigin.map(o => o.origin)).toEqual(origins);
    });

    test('domain-wide mode sends cookies:true to browsingData and never uses chrome.cookies', async () => {
        const { api, calls } = fakeApi();
        const p = plan({ dataTypes: ['cookies', 'localStorage'], cookieMode: 'domainWide' });
        const result = await executePlan(p, { api, now: clock });
        const [, , set] = calls.find(c => c[0] === 'browsingData.remove');
        expect(set).toEqual({ cookies: true, localStorage: true });
        expect(names(calls).some(n => n.startsWith('cookies.') || n === 'permissions.contains')).toBe(false);
        expect(result.perOrigin[0].types.cookies).toBe('ok');
        expect(result.perOrigin[0].cookies).toBeNull();
    });

    test('exact mode never sends cookies to browsingData', async () => {
        const { api, calls } = fakeApi();
        await executePlan(plan({ dataTypes: ['cookies', 'localStorage'], cookieMode: 'exact' }), { api, now: clock });
        const [, , set] = calls.find(c => c[0] === 'browsingData.remove');
        expect(set).toEqual({ localStorage: true });
    });

    test('exact cookies only: no browsingData call at all', async () => {
        const { api, calls } = fakeApi();
        await executePlan(plan({ dataTypes: ['cookies'], cookieMode: 'exact' }), { api, now: clock });
        expect(names(calls)).not.toContain('browsingData.remove');
    });

    test('missing cookie permission yields COOKIE_PERMISSION_MISSING with no fallback', async () => {
        const { api, calls } = fakeApi({ contains: () => false });
        const p = plan({ dataTypes: ['cookies', 'localStorage'], cookieMode: 'exact' });
        const result = await executePlan(p, { api, now: clock });
        const origin = result.perOrigin[0];
        expect(origin.types.cookies).toBe('error');
        expect(origin.errors[0]).toMatchObject({ type: 'cookies', code: 'COOKIE_PERMISSION_MISSING' });
        expect(origin.cookies).toBeNull();
        expect(result.ok).toBe(false);
        expect(names(calls)).not.toContain('cookies.getAll');
        expect(names(calls)).not.toContain('cookies.remove');
        const [, , set] = calls.find(c => c[0] === 'browsingData.remove');
        expect(set.cookies).toBeUndefined();
        expect(origin.types.localStorage).toBe('ok');
        expect(calls.find(c => c[0] === 'permissions.contains')[1]).toEqual({ origins: [`${ORIGIN}/*`] });
    });

    test('a throwing permissions.contains counts as missing', async () => {
        const { api } = fakeApi({ contains: () => { throw new Error('nope'); } });
        const result = await executePlan(plan({ dataTypes: ['cookies'] }), { api, now: clock });
        expect(result.perOrigin[0].errors[0].code).toBe('COOKIE_PERMISSION_MISSING');
    });

    test('exact cookie removal: host-only and partitioned go, shared stays unless selected', async () => {
        const cookies = [
            { name: 'own', domain: 'app.example.test', hostOnly: true, path: '/', secure: true, storeId: '0' },
            { name: 'chips', domain: 'app.example.test', hostOnly: true, path: '/', secure: true, storeId: '0',
                partitionKey: { topLevelSite: 'https://example.test' } },
            { name: 'wide', domain: '.example.test', hostOnly: false, path: '/', secure: true, storeId: '0' },
            { name: 'sibling', domain: 'other.example.test', hostOnly: true, path: '/', secure: true, storeId: '0' }
        ];
        const run = async (patch) => {
            const { api, calls } = fakeApi({ getAll: () => cookies });
            const result = await executePlan(plan({ dataTypes: ['cookies'], cookieMode: 'exact', ...patch }), { api, now: clock });
            return { result, removed: calls.filter(c => c[0] === 'cookies.remove').map(c => c[1].name), calls };
        };

        const base = await run({});
        expect(base.removed).toEqual(['own', 'chips']);
        expect(base.result.perOrigin[0].cookies).toEqual({ removed: 2, kept: 1, failed: 0 });
        // every remove stays on the target origin
        for (const c of base.calls.filter(x => x[0] === 'cookies.remove')) {
            expect(c[1].url.startsWith(ORIGIN)).toBe(true);
        }

        const sharedId = 'wide|example.test|/|0|';
        const withShared = await run({ cookieSelection: { includeShared: [sharedId], keepNames: [] } });
        expect(withShared.removed).toEqual(['own', 'chips', 'wide']);
        expect(withShared.result.perOrigin[0].cookies.kept).toBe(0);

        const keep = await run({ cookieSelection: { includeShared: [], keepNames: ['own'] } });
        expect(keep.removed).toEqual(['chips']);
        expect(keep.result.perOrigin[0].cookies).toEqual({ removed: 1, kept: 2, failed: 0 });
    });

    test('cookies.getAll queries url, host and parent domains with all partitions and the tab store', async () => {
        const { api, calls } = fakeApi();
        const p = plan({
            origins: ['https://a.b.example.test'],
            dataTypes: ['cookies'],
            after: 'none',
            tab: { id: 1, origin: 'https://a.b.example.test', storeId: '1' }
        });
        await executePlan(p, { api, now: clock });
        const queries = calls.filter(c => c[0] === 'cookies.getAll').map(c => c[1]);
        expect(queries).toEqual([
            { url: 'https://a.b.example.test/', partitionKey: {}, storeId: '1' },
            { domain: 'a.b.example.test', partitionKey: {}, storeId: '1' },
            { domain: 'b.example.test', partitionKey: {}, storeId: '1' },
            { domain: 'example.test', partitionKey: {}, storeId: '1' }
        ]);
    });

    test('cookie read and remove failures are recorded', async () => {
        const readFail = fakeApi({ getAll: () => { throw new Error('read denied'); } });
        const r1 = await executePlan(plan({ dataTypes: ['cookies'] }), { api: readFail.api, now: clock });
        expect(r1.perOrigin[0].errors[0]).toMatchObject({ code: 'COOKIE_READ_FAILED', message: 'read denied' });

        const cookies = [
            { name: 'a', domain: 'app.example.test', hostOnly: true, path: '/', secure: true },
            { name: 'b', domain: 'app.example.test', hostOnly: true, path: '/', secure: true },
            { name: 'c', domain: 'app.example.test', hostOnly: true, path: '/', secure: true }
        ];
        let n = 0;
        const removeFail = fakeApi({
            getAll: () => cookies,
            removeCookie: () => {
                n++;
                if (n === 1) throw new Error('remove denied');
                return n === 2 ? null : { name: 'c' };
            }
        });
        const r2 = await executePlan(plan({ dataTypes: ['cookies'] }), { api: removeFail.api, now: clock });
        expect(r2.perOrigin[0].cookies).toEqual({ removed: 1, kept: 0, failed: 2 });
        expect(r2.perOrigin[0].errors[0]).toMatchObject({ code: 'COOKIE_REMOVE_FAILED', message: 'remove denied' });
        expect(r2.ok).toBe(false);

        const nullOnly = fakeApi({ getAll: () => cookies.slice(0, 1), removeCookie: () => null });
        const r3 = await executePlan(plan({ dataTypes: ['cookies'] }), { api: nullOnly.api, now: clock });
        expect(r3.perOrigin[0].errors[0].message).toContain('could not be removed');
    });

    test('browsingData failure marks every API-backed type as error and continues', async () => {
        const { api, calls } = fakeApi({ browsingData: () => { throw new Error('quota'); } });
        const p = plan({
            origins: ['https://a.test', 'https://b.test'],
            dataTypes: ['localStorage', 'indexedDB'],
            after: 'reload',
            tab: { id: 4, origin: 'https://a.test' }
        });
        const result = await executePlan(p, { api, now: clock });
        expect(result.perOrigin[0].types).toEqual({ localStorage: 'error', indexedDB: 'error' });
        expect(result.perOrigin[0].errors.map(e => e.code)).toEqual(['BROWSING_DATA_FAILED', 'BROWSING_DATA_FAILED']);
        expect(calls.filter(c => c[0] === 'browsingData.remove')).toHaveLength(2);
        expect(names(calls)).toContain('tabs.reload');
        expect(result.ok).toBe(false);
    });

    test('after-actions: reload, hard, start, none', async () => {
        const tab = { id: 5, origin: ORIGIN };
        const run = async (after, extra = {}) => {
            const { api, calls } = fakeApi();
            const result = await executePlan(plan({ after, tab, ...extra }), { api, now: clock });
            return { calls: calls.filter(c => c[0].startsWith('tabs.')), result };
        };
        expect((await run('reload')).calls).toEqual([['tabs.reload', 5, { bypassCache: false }]]);
        expect((await run('hard')).calls).toEqual([['tabs.reload', 5, { bypassCache: true }]]);
        const start = await run('start', { startPath: '/dashboard' });
        expect(start.calls).toEqual([['tabs.update', 5, { url: `${ORIGIN}/dashboard` }]]);
        const none = await run('none');
        expect(none.calls).toEqual([]);
        expect(none.result.after).toEqual({ action: 'none', ok: true });
    });

    test('after-action runs once for multiple origins and failures are recorded', async () => {
        const { api, calls } = fakeApi({ reload: () => { throw new Error('tab closed'); } });
        const p = plan({
            origins: ['https://a.test', 'https://b.test'],
            after: 'reload',
            tab: { id: 2, origin: 'https://b.test' }
        });
        const result = await executePlan(p, { api, now: clock });
        expect(calls.filter(c => c[0] === 'tabs.reload')).toHaveLength(1);
        expect(result.after).toEqual({ action: 'reload', ok: false, error: 'tab closed' });
        expect(result.ok).toBe(false);
    });

    test('de-duplicates origins that bypass createPlan', async () => {
        const { api, calls } = fakeApi();
        const p = { ...plan(), origins: [ORIGIN, ORIGIN] };
        await executePlan(p, { api, now: clock });
        expect(calls.filter(c => c[0] === 'browsingData.remove')).toHaveLength(1);
    });

    test('records timing from the injected clock', async () => {
        let t = 1000;
        const { api } = fakeApi();
        const result = await executePlan(plan(), { api, now: () => (t += 50) });
        expect(result.finishedAt - result.startedAt).toBe(result.durationMs);
        expect(result.durationMs).toBeGreaterThan(0);
    });
});
