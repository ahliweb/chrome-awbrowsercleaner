/**
 * Unit tests for presets.js
 */

import {
    BUILTIN_PRESETS, validatePreset, getPreset, listPresets, duplicatePreset,
    exportPresets, importPresets, presetMatchesSelection, presetToPlanInput, MAX_CUSTOM_PRESETS
} from '../../presets.js';
import { DATA_TYPE_KEYS, MAX_ORIGINS, createPlan } from '../../cleanup-core.js';

const base = () => ({ id: 'my-preset', name: 'My preset', dataTypes: ['localStorage'] });

describe('BUILTIN_PRESETS', () => {
    test('has the four built-ins in order with i18n keys', () => {
        expect(BUILTIN_PRESETS.map(p => p.id)).toEqual(['logout', 'fresh', 'stale', 'full']);
        for (const p of BUILTIN_PRESETS) {
            expect(p.builtin).toBe(true);
            expect(p.nameKey).toMatch(/^preset[A-Z]/);
            expect(p.descriptionKey).toBe(`${p.nameKey}Desc`);
        }
    });

    test('definitions match the spec', () => {
        const byId = Object.fromEntries(BUILTIN_PRESETS.map(p => [p.id, p]));
        expect(byId.logout.dataTypes).toEqual(['cookies', 'sessionStorage']);
        expect(byId.logout.after).toBe('reload');
        expect(byId.fresh.dataTypes).not.toContain('cache');
        expect(byId.fresh.after).toBe('start');
        expect(byId.fresh.startPath).toBe('/');
        expect(byId.stale.dataTypes).toEqual(['cache', 'cacheStorage', 'serviceWorkers']);
        expect(byId.stale.after).toBe('hard');
        expect(byId.full.dataTypes).toEqual([...DATA_TYPE_KEYS]);
        expect(byId.full.cookieMode).toBe('exact');
    });

    test('are frozen', () => {
        expect(Object.isFrozen(BUILTIN_PRESETS)).toBe(true);
        expect(Object.isFrozen(BUILTIN_PRESETS[0])).toBe(true);
        expect(Object.isFrozen(BUILTIN_PRESETS[0].dataTypes)).toBe(true);
    });

    test('data types are valid and ordered', () => {
        for (const p of BUILTIN_PRESETS) {
            const idx = p.dataTypes.map(t => DATA_TYPE_KEYS.indexOf(t));
            expect(idx.every(i => i >= 0)).toBe(true);
            expect([...idx].sort((a, b) => a - b)).toEqual(idx);
        }
    });
});

describe('validatePreset', () => {
    test('accepts a minimal preset and applies defaults', () => {
        const res = validatePreset(base());
        expect(res.ok).toBe(true);
        expect(res.errors).toEqual([]);
        expect(res.preset).toEqual({
            id: 'my-preset', name: 'My preset', dataTypes: ['localStorage'],
            cookieMode: 'exact', after: 'none', startPath: '/'
        });
    });

    test('returns a frozen copy', () => {
        const input = base();
        const res = validatePreset(input);
        expect(Object.isFrozen(res.preset)).toBe(true);
        expect(Object.isFrozen(res.preset.dataTypes)).toBe(true);
        expect(res.preset).not.toBe(input);
        expect(res.preset.dataTypes).not.toBe(input.dataTypes);
    });

    test('rejects non-objects', () => {
        for (const v of [null, undefined, 'x', 5, []]) {
            expect(validatePreset(v).ok).toBe(false);
        }
    });

    test('trims name and enforces length/control chars', () => {
        expect(validatePreset({ ...base(), name: '  Hi  ' }).preset.name).toBe('Hi');
        expect(validatePreset({ ...base(), name: '   ' }).ok).toBe(false);
        expect(validatePreset({ ...base(), name: 'a'.repeat(61) }).ok).toBe(false);
        expect(validatePreset({ ...base(), name: 'a'.repeat(60) }).ok).toBe(true);
        expect(validatePreset({ ...base(), name: 'bad\nname' }).ok).toBe(false);
        expect(validatePreset({ ...base(), name: 'bad\u0000name' }).ok).toBe(false);
        expect(validatePreset({ ...base(), name: 42 }).ok).toBe(false);
    });

    test('id must be a slug and not a built-in id', () => {
        for (const id of ['', 'Upper', '-lead', 'has space', 'a'.repeat(41), 'ünï', 5]) {
            expect(validatePreset({ ...base(), id }).ok).toBe(false);
        }
        expect(validatePreset({ ...base(), id: 'a'.repeat(40) }).ok).toBe(true);
        expect(validatePreset({ ...base(), id: '0-x' }).ok).toBe(true);
        for (const p of BUILTIN_PRESETS) {
            const res = validatePreset({ ...base(), id: p.id });
            expect(res.ok).toBe(false);
            expect(res.errors.join(' ')).toContain('reserved');
        }
    });

    test('dataTypes: non-empty, known only, de-duplicated and ordered', () => {
        expect(validatePreset({ ...base(), dataTypes: [] }).ok).toBe(false);
        expect(validatePreset({ ...base(), dataTypes: undefined }).ok).toBe(false);
        expect(validatePreset({ ...base(), dataTypes: ['history'] }).ok).toBe(false);
        expect(validatePreset({ ...base(), dataTypes: ['cookies', 'passwords'] }).ok).toBe(false);
        expect(validatePreset({ ...base(), dataTypes: [1] }).ok).toBe(false);
        const res = validatePreset({ ...base(), dataTypes: ['indexedDB', 'cookies', 'indexedDB', 'cache'] });
        expect(res.preset.dataTypes).toEqual(['cookies', 'indexedDB', 'cache']);
    });

    test('cookieMode and after are enumerated', () => {
        expect(validatePreset({ ...base(), cookieMode: 'domainWide' }).preset.cookieMode).toBe('domainWide');
        expect(validatePreset({ ...base(), cookieMode: 'all' }).ok).toBe(false);
        for (const a of ['none', 'reload', 'hard', 'start']) {
            expect(validatePreset({ ...base(), after: a }).ok).toBe(true);
        }
        expect(validatePreset({ ...base(), after: 'close' }).ok).toBe(false);
    });

    test('startPath rules', () => {
        expect(validatePreset({ ...base(), startPath: '/app?x=1' }).ok).toBe(true);
        for (const p of ['app', '//evil.example', '', '/a\nb', '/\\evil', '/' + 'a'.repeat(200), 5]) {
            expect(validatePreset({ ...base(), startPath: p }).ok).toBe(false);
        }
        expect(validatePreset({ ...base(), startPath: '/' + 'a'.repeat(199) }).ok).toBe(true);
    });

    test('boundOrigin must be an exact origin', () => {
        expect(validatePreset({ ...base(), boundOrigin: 'https://app.example.test:8443' }).preset.boundOrigin)
            .toBe('https://app.example.test:8443');
        for (const o of ['example.com', 'https://example.com/', 'https://example.com/path', 'ftp://example.com',
            'https://*.example.com', 'HTTPS://EXAMPLE.COM', '', 5]) {
            expect(validatePreset({ ...base(), boundOrigin: o }).ok).toBe(false);
        }
    });

    test('origins: exact, de-duplicated, capped with boundOrigin', () => {
        const res = validatePreset({ ...base(), origins: ['https://a.test', 'https://a.test', 'http://b.test:3000'] });
        expect(res.preset.origins).toEqual(['https://a.test', 'http://b.test:3000']);
        expect(validatePreset({ ...base(), origins: ['https://*.test'] }).ok).toBe(false);
        expect(validatePreset({ ...base(), origins: ['https://a.test/x'] }).ok).toBe(false);
        expect(validatePreset({ ...base(), origins: 'https://a.test' }).ok).toBe(false);

        const ten = Array.from({ length: MAX_ORIGINS }, (_, i) => `https://h${i}.test`);
        expect(validatePreset({ ...base(), origins: ten }).ok).toBe(true);
        expect(validatePreset({ ...base(), boundOrigin: 'https://other.test', origins: ten }).ok).toBe(false);
        expect(validatePreset({ ...base(), boundOrigin: ten[0], origins: ten }).ok).toBe(true);
        expect(validatePreset({ ...base(), origins: [...ten, 'https://h99.test'] }).ok).toBe(false);
    });

    test('keepCookieNames: RFC 6265 tokens, max 20', () => {
        expect(validatePreset({ ...base(), keepCookieNames: ['consent', '_ga', 'a.b-c', 'x', 'x'] }).preset.keepCookieNames)
            .toEqual(['consent', '_ga', 'a.b-c', 'x']);
        for (const n of ['has space', 'semi;colon', 'eq=ual', '', 'comma,', '"q"', 5]) {
            expect(validatePreset({ ...base(), keepCookieNames: [n] }).ok).toBe(false);
        }
        const twenty = Array.from({ length: 20 }, (_, i) => `c${i}`);
        expect(validatePreset({ ...base(), keepCookieNames: twenty }).ok).toBe(true);
        expect(validatePreset({ ...base(), keepCookieNames: [...twenty, 'c20'] }).ok).toBe(false);
        expect(validatePreset({ ...base(), keepCookieNames: 'a' }).ok).toBe(false);
    });

    test('rejects unknown properties', () => {
        const res = validatePreset({ ...base(), color: 'red' });
        expect(res.ok).toBe(false);
        expect(res.errors.join(' ')).toContain('Unknown property "color"');
        expect(validatePreset({ ...base(), builtin: true }).ok).toBe(false);
    });

    test('rejects any "exclude" property with a Scope Guard message', () => {
        for (const key of ['excludeOrigins', 'excludeCookies', 'ExcludeAll', 'notExcluded']) {
            const res = validatePreset({ ...base(), [key]: ['https://a.test'] });
            expect(res.ok).toBe(false);
            expect(res.errors.join(' ')).toContain('Scope Guard');
        }
    });

    test('collects multiple errors', () => {
        const res = validatePreset({ id: 'X', name: '', dataTypes: [] });
        expect(res.ok).toBe(false);
        expect(res.errors.length).toBeGreaterThanOrEqual(3);
        expect(res.preset).toBeNull();
    });
});

describe('getPreset / listPresets', () => {
    const custom = [validatePreset(base()).preset];

    test('getPreset finds built-ins and customs', () => {
        expect(getPreset('logout', custom).id).toBe('logout');
        expect(getPreset('my-preset', custom).name).toBe('My preset');
        expect(getPreset('nope', custom)).toBeNull();
        expect(getPreset('logout')).toBe(BUILTIN_PRESETS[0]);
    });

    test('listPresets puts built-ins first', () => {
        const all = listPresets(custom);
        expect(all.map(p => p.id)).toEqual(['logout', 'fresh', 'stale', 'full', 'my-preset']);
        expect(listPresets().length).toBe(4);
    });
});

describe('duplicatePreset', () => {
    test('creates a valid custom preset from a built-in', () => {
        const res = duplicatePreset(BUILTIN_PRESETS[1], 'fresh-copy', 'Fresh copy');
        expect(res.ok).toBe(true);
        expect(res.preset.builtin).toBeUndefined();
        expect(res.preset.nameKey).toBeUndefined();
        expect(res.preset.dataTypes).toEqual([...BUILTIN_PRESETS[1].dataTypes]);
        expect(res.preset.after).toBe('start');
    });

    test('reports invalid ids and builtin collisions', () => {
        expect(duplicatePreset(BUILTIN_PRESETS[0], 'logout', 'x').ok).toBe(false);
        expect(duplicatePreset(BUILTIN_PRESETS[0], 'Bad Id', 'x').ok).toBe(false);
        expect(duplicatePreset(null, 'ok', 'x').ok).toBe(false);
    });
});

describe('exportPresets / importPresets', () => {
    const a = validatePreset({ ...base(), id: 'a', name: 'A', boundOrigin: 'https://a.test' }).preset;
    const b = validatePreset({ ...base(), id: 'b', name: 'B', after: 'hard' }).preset;
    const NOW = new Date('2026-01-02T03:04:05.000Z');

    test('export has the documented envelope', () => {
        const data = JSON.parse(exportPresets([a, b], NOW));
        expect(data.format).toBe('aw-browser-cleaner-presets');
        expect(data.version).toBe(1);
        expect(data.exportedAt).toBe('2026-01-02T03:04:05.000Z');
        expect(data.presets.length).toBe(2);
    });

    test('export throws on invalid presets', () => {
        expect(() => exportPresets([{ id: 'x' }])).toThrow();
    });

    test('round trips', () => {
        const res = importPresets(exportPresets([a, b], NOW));
        expect(res.ok).toBe(true);
        expect(res.presets).toEqual([a, b]);
        expect(res.imported).toEqual([a, b]);
    });

    test('merges with existing by id (import wins)', () => {
        const old = validatePreset({ ...base(), id: 'a', name: 'Old A' }).preset;
        const keep = validatePreset({ ...base(), id: 'keep', name: 'Keep' }).preset;
        const res = importPresets(exportPresets([a]), [old, keep]);
        expect(res.ok).toBe(true);
        expect(res.presets.map(p => p.id)).toEqual(['keep', 'a']);
        expect(res.presets[1].name).toBe('A');
    });

    const wrap = (presets, extra = {}) => JSON.stringify({ format: 'aw-browser-cleaner-presets', version: 1, presets, ...extra });

    test('rejects bad JSON, format, version, shape', () => {
        expect(importPresets('{nope').ok).toBe(false);
        expect(importPresets('null').ok).toBe(false);
        expect(importPresets(JSON.stringify({ format: 'other', version: 1, presets: [] })).ok).toBe(false);
        expect(importPresets(wrap([], { version: 2 })).ok).toBe(false);
        expect(importPresets(JSON.stringify({ format: 'aw-browser-cleaner-presets', version: 1 })).ok).toBe(false);
    });

    test('is atomic: one invalid preset rejects everything', () => {
        const res = importPresets(wrap([a, { id: 'bad', name: '', dataTypes: [] }]));
        expect(res.ok).toBe(false);
        expect(res.presets).toEqual([]);
        expect(res.errors.join(' ')).toContain('Preset #2');
    });

    test('rejects builtin id collisions and duplicate ids', () => {
        expect(importPresets(wrap([{ ...base(), id: 'full' }])).ok).toBe(false);
        expect(importPresets(wrap([a, a])).errors.join(' ')).toContain('duplicate');
    });

    test('rejects exclude properties', () => {
        const res = importPresets(wrap([{ ...base(), excludeOrigins: ['https://x.test'] }]));
        expect(res.ok).toBe(false);
        expect(res.errors.join(' ')).toContain('Scope Guard');
    });

    test('enforces the preset count limits', () => {
        const many = Array.from({ length: MAX_CUSTOM_PRESETS + 1 }, (_, i) => ({ ...base(), id: `p${i}` }));
        expect(importPresets(wrap(many)).ok).toBe(false);
        const fifty = many.slice(0, MAX_CUSTOM_PRESETS);
        expect(importPresets(wrap(fifty)).ok).toBe(true);
        const existing = [validatePreset({ ...base(), id: 'existing' }).preset];
        expect(importPresets(wrap(fifty), existing).ok).toBe(false);
    });
});

describe('presetMatchesSelection', () => {
    const logout = BUILTIN_PRESETS[0];

    test('matches regardless of order', () => {
        expect(presetMatchesSelection(logout, { dataTypes: ['sessionStorage', 'cookies'], cookieMode: 'exact', after: 'reload' })).toBe(true);
    });

    test('diverges on types, mode, or after', () => {
        expect(presetMatchesSelection(logout, { dataTypes: ['cookies'], cookieMode: 'exact', after: 'reload' })).toBe(false);
        expect(presetMatchesSelection(logout, { dataTypes: ['cookies', 'sessionStorage'], cookieMode: 'domainWide', after: 'reload' })).toBe(false);
        expect(presetMatchesSelection(logout, { dataTypes: ['cookies', 'sessionStorage'], cookieMode: 'exact', after: 'none' })).toBe(false);
    });

    test('cookie mode is ignored when cookies are not selected', () => {
        expect(presetMatchesSelection(BUILTIN_PRESETS[2], { dataTypes: ['cache', 'cacheStorage', 'serviceWorkers'], cookieMode: 'domainWide', after: 'hard' })).toBe(true);
    });

    test('handles missing input', () => {
        expect(presetMatchesSelection(null, { dataTypes: [] })).toBe(false);
        expect(presetMatchesSelection(logout, null)).toBe(false);
    });
});

describe('presetToPlanInput', () => {
    const ORIGIN = 'https://app.example.test';
    const tab = { id: 7, origin: ORIGIN, storeId: '0' };
    const logout = () => BUILTIN_PRESETS.find(p => p.id === 'logout');

    test('maps a built-in preset to createPlan input', () => {
        const { input, dropped } = presetToPlanInput(logout(), { origin: ORIGIN, tab, source: 'shortcut' });
        expect(dropped).toEqual([]);
        expect(input).toEqual({
            origins: [ORIGIN],
            dataTypes: ['cookies', 'sessionStorage'],
            cookieMode: 'exact',
            cookieSelection: { includeShared: [], keepNames: [] },
            since: 0,
            after: 'reload',
            startPath: '/',
            presetId: 'logout',
            tab,
            source: 'shortcut'
        });
    });

    test('the result is accepted by createPlan', () => {
        const { input } = presetToPlanInput(logout(), { origin: ORIGIN, tab, source: 'contextMenu' });
        const res = createPlan(input);
        expect(res.ok).toBe(true);
        expect(res.plan.origins).toEqual([ORIGIN]);
        expect(res.plan.source).toBe('contextMenu');
    });

    test('puts the given origin first and de-duplicates extra origins', () => {
        const preset = {
            id: 'multi', name: 'Multi', dataTypes: ['localStorage'], cookieMode: 'exact', after: 'none', startPath: '/',
            origins: ['https://api.example.test', ORIGIN, 'https://api.example.test']
        };
        const { input } = presetToPlanInput(preset, { origin: ORIGIN, tab: null, source: 'popup' });
        expect(input.origins).toEqual([ORIGIN, 'https://api.example.test']);
    });

    test('caps origins at MAX_ORIGINS and keeps the primary origin', () => {
        const extra = Array.from({ length: 15 }, (_, i) => `https://s${i}.example.test`);
        const preset = { id: 'many', dataTypes: ['cache'], origins: extra };
        const { input } = presetToPlanInput(preset, { origin: ORIGIN, tab: null, source: 'popup' });
        expect(input.origins).toHaveLength(MAX_ORIGINS);
        expect(input.origins[0]).toBe(ORIGIN);
    });

    test('a different boundOrigin never replaces the given origin', () => {
        const preset = {
            id: 'bound', name: 'Bound', dataTypes: ['localStorage'], cookieMode: 'exact', after: 'none',
            startPath: '/', boundOrigin: 'https://other.example.test'
        };
        const { input } = presetToPlanInput(preset, { origin: ORIGIN, tab: null, source: 'popup' });
        expect(input.origins).toEqual([ORIGIN]);
    });

    test('passes keepCookieNames, cookieMode, startPath and since through', () => {
        const preset = {
            id: 'keep', dataTypes: ['cookies', 'localStorage'], cookieMode: 'domainWide', after: 'start',
            startPath: '/home', keepCookieNames: ['theme', 'lang']
        };
        const { input } = presetToPlanInput(preset, { origin: ORIGIN, tab, source: 'popup', since: 1234 });
        expect(input.cookieMode).toBe('domainWide');
        expect(input.startPath).toBe('/home');
        expect(input.since).toBe(1234);
        expect(input.cookieSelection).toEqual({ includeShared: [], keepNames: ['theme', 'lang'] });
        expect(input.after).toBe('start');
    });

    test('without a tab, drops sessionStorage and the after-action and reports both', () => {
        const { input, dropped } = presetToPlanInput(logout(), { origin: ORIGIN, tab: null, source: 'testMode' });
        expect(input.dataTypes).toEqual(['cookies']);
        expect(input.after).toBe('none');
        expect(input.tab).toBeNull();
        expect(dropped).toEqual([
            { type: 'sessionStorage', reason: 'noTab' },
            { after: 'reload', reason: 'noTab' }
        ]);
        expect(createPlan(input).ok).toBe(true);
    });

    test('without a tab, nothing is dropped when nothing needs a tab', () => {
        const stale = BUILTIN_PRESETS.find(p => p.id === 'stale');
        const { input, dropped } = presetToPlanInput({ ...stale, after: 'none' }, { origin: ORIGIN, tab: null, source: 'popup' });
        expect(dropped).toEqual([]);
        expect(input.dataTypes).toEqual(['cache', 'cacheStorage', 'serviceWorkers']);
    });

    test('does not mutate the preset', () => {
        const preset = logout();
        presetToPlanInput(preset, { origin: ORIGIN, tab: null, source: 'popup' });
        expect(preset.dataTypes).toEqual(['cookies', 'sessionStorage']);
        expect(preset.after).toBe('reload');
    });
});
