/**
 * Unit tests for settings.js (in-memory fake StorageArea)
 */

import {
    createSettings, isOriginAllowedForTestMode, KEYS, DEFAULT_TEST_MODE,
    MAX_HISTORY, MAX_ORIGIN_PRESETS
} from '../../settings.js';

/** In-memory chrome.storage.StorageArea stand-in (async, structured-clone like). */
function fakeArea() {
    const data = new Map();
    const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
    return {
        data,
        async get(keys) {
            await Promise.resolve();
            if (keys === null || keys === undefined) return Object.fromEntries([...data].map(([k, v]) => [k, clone(v)]));
            const list = typeof keys === 'string' ? [keys] : keys;
            const out = {};
            for (const k of list) if (data.has(k)) out[k] = clone(data.get(k));
            return out;
        },
        async set(items) {
            await Promise.resolve();
            for (const [k, v] of Object.entries(items)) data.set(k, clone(v));
        },
        async remove(keys) {
            await Promise.resolve();
            for (const k of (typeof keys === 'string' ? [keys] : keys)) data.delete(k);
        }
    };
}

function make() {
    const areas = { sync: fakeArea(), local: fakeArea(), session: fakeArea() };
    return { areas, s: createSettings(areas) };
}

const preset = (over = {}) => ({ id: 'mine', name: 'Mine', dataTypes: ['localStorage'], ...over });

describe('custom presets', () => {
    test('save, list, upsert and delete', async () => {
        const { s, areas } = make();
        expect(await s.getCustomPresets()).toEqual([]);
        const saved = await s.saveCustomPreset(preset());
        expect(saved.ok).toBe(true);
        expect(saved.preset.after).toBe('none');
        await s.saveCustomPreset(preset({ id: 'other', name: 'Alpha' }));
        await s.saveCustomPreset(preset({ name: 'Renamed' }));
        const list = await s.getCustomPresets();
        expect(list.map(p => p.id)).toEqual(['other', 'mine']);
        expect(list[1].name).toBe('Renamed');
        expect([...areas.sync.data.keys()].every(k => k.startsWith('aw.'))).toBe(true);
        expect(await s.deleteCustomPreset('mine')).toBe(true);
        expect((await s.getCustomPresets()).map(p => p.id)).toEqual(['other']);
    });

    test('rejects invalid presets without writing', async () => {
        const { s, areas } = make();
        const res = await s.saveCustomPreset({ id: 'logout', name: 'x', dataTypes: ['cookies'] });
        expect(res.ok).toBe(false);
        expect(res.errors.length).toBeGreaterThan(0);
        expect(areas.sync.data.size).toBe(0);
        expect((await s.saveCustomPreset({ ...preset(), excludeOrigins: [] })).errors.join(' ')).toContain('Scope Guard');
    });

    test('ignores corrupted stored presets', async () => {
        const { s, areas } = make();
        await areas.sync.set({ [KEYS.presetPrefix + 'bad']: { id: 'bad' } });
        await s.saveCustomPreset(preset());
        expect((await s.getCustomPresets()).map(p => p.id)).toEqual(['mine']);
    });

    test('limits the number of presets but still allows updates', async () => {
        const { s } = make();
        for (let i = 0; i < 50; i++) {
            expect((await s.saveCustomPreset(preset({ id: `p${i}`, name: `P${i}` }))).ok).toBe(true);
        }
        expect((await s.saveCustomPreset(preset({ id: 'extra' }))).ok).toBe(false);
        expect((await s.saveCustomPreset(preset({ id: 'p3', name: 'Updated' }))).ok).toBe(true);
    });

    test('deleteCustomPreset refuses non-slug ids', async () => {
        const { s } = make();
        expect(await s.deleteCustomPreset('../x')).toBe(false);
    });
});

describe('last preset', () => {
    test('global and per-origin', async () => {
        const { s } = make();
        expect(await s.getLastPreset()).toBeNull();
        await s.setLastPreset('fresh', 'https://a.test');
        await s.setLastPreset('logout', 'https://b.test');
        expect(await s.getLastPreset()).toBe('logout');
        expect(await s.getLastPresetForOrigin('https://a.test')).toBe('fresh');
        expect(await s.getLastPresetForOrigin('https://b.test')).toBe('logout');
        expect(await s.getLastPresetForOrigin('https://c.test')).toBeNull();
        await s.setLastPreset('custom');
        expect(await s.getLastPreset()).toBe('custom');
    });

    test('rejects invalid ids and ignores non-exact origins', async () => {
        const { s, areas } = make();
        expect(await s.setLastPreset('Bad Id')).toBe(false);
        await s.setLastPreset('fresh', 'https://a.test/path');
        expect(areas.local.data.has(KEYS.lastPresetByOrigin)).toBe(false);
        expect(await s.getLastPreset()).toBe('fresh');
        expect(await s.getLastPresetForOrigin('https://a.test/path')).toBeNull();
    });

    test('caps the per-origin map at 100 entries, dropping the least recently set', async () => {
        const { s } = make();
        for (let i = 0; i < MAX_ORIGIN_PRESETS + 5; i++) await s.setLastPreset('fresh', `https://h${i}.test`);
        expect(await s.getLastPresetForOrigin('https://h0.test')).toBeNull();
        expect(await s.getLastPresetForOrigin('https://h4.test')).toBeNull();
        expect(await s.getLastPresetForOrigin('https://h5.test')).toBe('fresh');
        // refreshing an old entry moves it to the newest position
        await s.setLastPreset('stale', 'https://h5.test');
        for (let i = 0; i < MAX_ORIGIN_PRESETS - 1; i++) await s.setLastPreset('fresh', `https://n${i}.test`);
        expect(await s.getLastPresetForOrigin('https://h5.test')).toBe('stale');
        await s.clearLastPresetMemory();
        expect(await s.getLastPresetForOrigin('https://h5.test')).toBeNull();
    });
});

describe('recent origins', () => {
    test('keeps 3 newest, de-duplicated, exact origins only', async () => {
        const { s } = make();
        expect(await s.addRecentOrigin('https://a.test', 1)).toBe(true);
        await s.addRecentOrigin('https://b.test', 2);
        await s.addRecentOrigin('https://c.test', 3);
        await s.addRecentOrigin('https://a.test', 4);
        await s.addRecentOrigin('https://d.test', 5);
        expect(await s.getRecentOrigins()).toEqual([
            { origin: 'https://d.test', at: 5 },
            { origin: 'https://a.test', at: 4 },
            { origin: 'https://c.test', at: 3 }
        ]);
    });

    test('never stores paths or garbage', async () => {
        const { s } = make();
        expect(await s.addRecentOrigin('https://a.test/path?q=1')).toBe(false);
        expect(await s.addRecentOrigin('example.com')).toBe(false);
        expect(await s.addRecentOrigin('ftp://a.test')).toBe(false);
        expect(await s.addRecentOrigin('https://*.a.test')).toBe(false);
        expect(await s.getRecentOrigins()).toEqual([]);
    });

    test('clear', async () => {
        const { s } = make();
        await s.addRecentOrigin('https://a.test');
        await s.clearRecentOrigins();
        expect(await s.getRecentOrigins()).toEqual([]);
    });
});

describe('history', () => {
    const entry = (n, over = {}) => ({ id: `e${n}`, at: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`, origins: ['https://a.test'], presetId: 'fresh', durationMs: 10, ok: true, ...over });

    test('newest first, max 20', async () => {
        const { s } = make();
        for (let i = 0; i < MAX_HISTORY + 3; i++) await s.addHistoryEntry(entry(i));
        const list = await s.getHistory();
        expect(list.length).toBe(20);
        expect(list[0].id).toBe('e22');
        expect(list[19].id).toBe('e3');
    });

    test('whitelists fields (no stray data persisted)', async () => {
        const { s } = make();
        await s.addHistoryEntry({ ...entry(1), value: 'SECRET', cookies: [{ value: 'SECRET' }] });
        const [stored] = await s.getHistory();
        expect(Object.keys(stored).sort()).toEqual(['at', 'durationMs', 'id', 'ok', 'origins', 'presetId']);
        expect(JSON.stringify(stored)).not.toContain('SECRET');
    });

    test('rejects entries without valid origins', async () => {
        const { s } = make();
        expect(await s.addHistoryEntry(entry(1, { origins: ['https://a.test/x'] }))).toBe(false);
        expect(await s.addHistoryEntry(null)).toBe(false);
        expect(await s.getHistory()).toEqual([]);
    });

    test('clear', async () => {
        const { s } = make();
        await s.addHistoryEntry(entry(1));
        await s.clearHistory();
        expect(await s.getHistory()).toEqual([]);
    });

    test('disabled history makes adds no-ops (history and recent origins)', async () => {
        const { s } = make();
        expect(await s.getHistoryEnabled()).toBe(true);
        await s.setHistoryEnabled(false);
        expect(await s.getHistoryEnabled()).toBe(false);
        expect(await s.addHistoryEntry(entry(1))).toBe(false);
        expect(await s.addRecentOrigin('https://a.test')).toBe(false);
        expect(await s.getHistory()).toEqual([]);
        expect(await s.getRecentOrigins()).toEqual([]);
        await s.setHistoryEnabled(true);
        expect(await s.addHistoryEntry(entry(1))).toBe(true);
    });
});

describe('Test Mode config', () => {
    test('defaults', async () => {
        const { s } = make();
        expect(await s.getTestMode()).toEqual({ enabled: false, allowedOrigins: ['http://localhost', 'http://127.0.0.1'] });
        expect(DEFAULT_TEST_MODE.enabled).toBe(false);
    });

    test('saves and normalizes', async () => {
        const { s } = make();
        const res = await s.setTestMode({ enabled: true, allowedOrigins: ['http://LOCALHOST', 'https://stage.example.test:8443', 'http://localhost'] });
        expect(res.ok).toBe(true);
        expect(res.config.allowedOrigins).toEqual(['http://localhost', 'https://stage.example.test:8443']);
        expect(await s.getTestMode()).toEqual(res.config);
    });

    test('rejects bad entries and leaves config untouched', async () => {
        const { s } = make();
        for (const bad of ['ftp://x.test', 'https://*.test', 'http://x.test/path', 'x.test', 'http://x.test:80', 'https://x.test:443', 'http://x.test?q=1', 5]) {
            const res = await s.setTestMode({ enabled: true, allowedOrigins: [bad] });
            expect(res.ok).toBe(false);
        }
        expect((await s.getTestMode()).enabled).toBe(false);
        expect((await s.setTestMode({ enabled: 'yes', allowedOrigins: [] })).ok).toBe(false);
        expect((await s.setTestMode(null)).ok).toBe(false);
    });

    test('max 20 entries', async () => {
        const { s } = make();
        const many = Array.from({ length: 21 }, (_, i) => `http://h${i}.test`);
        expect((await s.setTestMode({ enabled: true, allowedOrigins: many })).ok).toBe(false);
        expect((await s.setTestMode({ enabled: true, allowedOrigins: many.slice(0, 20) })).ok).toBe(true);
    });
});

describe('isOriginAllowedForTestMode', () => {
    const cfg = (allowedOrigins, enabled = true) => ({ enabled, allowedOrigins });

    test('disabled or missing config allows nothing', () => {
        expect(isOriginAllowedForTestMode('http://localhost:3000', cfg(['http://localhost'], false))).toBe(false);
        expect(isOriginAllowedForTestMode('http://localhost:3000')).toBe(false);
        expect(isOriginAllowedForTestMode('http://localhost:3000', null)).toBe(false);
    });

    test('scheme://host means any port', () => {
        const c = cfg(['http://localhost']);
        expect(isOriginAllowedForTestMode('http://localhost', c)).toBe(true);
        expect(isOriginAllowedForTestMode('http://localhost:3000', c)).toBe(true);
        expect(isOriginAllowedForTestMode('https://localhost:3000', c)).toBe(false);
        expect(isOriginAllowedForTestMode('http://127.0.0.1:8080', c)).toBe(false);
    });

    test('explicit port means exactly that origin', () => {
        const c = cfg(['http://localhost:3000']);
        expect(isOriginAllowedForTestMode('http://localhost:3000', c)).toBe(true);
        expect(isOriginAllowedForTestMode('http://localhost:3001', c)).toBe(false);
        expect(isOriginAllowedForTestMode('http://localhost', c)).toBe(false);
    });

    test('host match is exact, never a suffix', () => {
        const c = cfg(['http://localhost']);
        expect(isOriginAllowedForTestMode('http://evil.localhost', c)).toBe(false);
        expect(isOriginAllowedForTestMode('http://localhost.evil.test', c)).toBe(false);
        expect(isOriginAllowedForTestMode('http://notlocalhost:3000', c)).toBe(false);
    });

    test('IPv6 and non-origin input', () => {
        const c = cfg(['http://[::1]']);
        expect(isOriginAllowedForTestMode('http://[::1]:5173', c)).toBe(true);
        expect(isOriginAllowedForTestMode('http://localhost:3000/path', cfg(['http://localhost']))).toBe(false);
        expect(isOriginAllowedForTestMode('not an origin', cfg(['http://localhost']))).toBe(false);
        expect(isOriginAllowedForTestMode('http://LOCALHOST', cfg(['http://localhost']))).toBe(false);
    });

    test('ignores malformed allow-list entries', () => {
        expect(isOriginAllowedForTestMode('http://localhost', cfg(['*', 'http://*', 42]))).toBe(false);
    });
});

describe('test session', () => {
    test('uses the session area only', async () => {
        const { s, areas } = make();
        expect(await s.getSessionStart()).toBeNull();
        expect(await s.startSession(1234)).toBe(1234);
        expect(await s.getSessionStart()).toBe(1234);
        expect(areas.session.data.size).toBe(1);
        expect(areas.local.data.size).toBe(0);
        await s.clearSession();
        expect(await s.getSessionStart()).toBeNull();
    });
});

describe('permission grants', () => {
    test('record, list, remove', async () => {
        const { s } = make();
        expect(await s.recordPermissionGrant('https://a.test', 'cookies', 10)).toBe(true);
        await s.recordPermissionGrant('https://a.test', 'cookies', 20);
        await s.recordPermissionGrant('https://b.test', 'cookies', 30);
        expect(await s.listPermissionGrants()).toEqual([
            { origin: 'https://a.test', kind: 'cookies', at: 20 },
            { origin: 'https://b.test', kind: 'cookies', at: 30 }
        ]);
        expect(await s.removePermissionGrant('https://a.test')).toBe(true);
        expect(await s.removePermissionGrant('https://a.test')).toBe(false);
        expect((await s.listPermissionGrants()).map(g => g.origin)).toEqual(['https://b.test']);
    });

    test('validates origin and kind', async () => {
        const { s } = make();
        expect(await s.recordPermissionGrant('https://a.test/x', 'cookies')).toBe(false);
        expect(await s.recordPermissionGrant('https://a.test', 'bad kind!')).toBe(false);
        expect(await s.recordPermissionGrant('https://a.test', 5)).toBe(false);
        expect(await s.listPermissionGrants()).toEqual([]);
    });
});

describe('infrastructure', () => {
    test('all keys are namespaced', () => {
        for (const k of Object.values(KEYS)) expect(k.startsWith('aw.')).toBe(true);
    });

    test('concurrent read-modify-write calls do not lose updates', async () => {
        const { s } = make();
        await Promise.all(['a', 'b', 'c'].map(h => s.addRecentOrigin(`https://${h}.test`)));
        expect((await s.getRecentOrigins()).length).toBe(3);
        await Promise.all(Array.from({ length: 5 }, (_, i) => s.addHistoryEntry({ id: `h${i}`, at: 'x', origins: ['https://a.test'], presetId: 'fresh', durationMs: 1, ok: true })));
        expect((await s.getHistory()).length).toBe(5);
    });

    test('missing storage area throws a clear error', async () => {
        const s = createSettings({ sync: undefined, local: fakeArea(), session: undefined });
        await expect(s.getCustomPresets()).rejects.toThrow('chrome.storage.sync');
        await expect(s.getSessionStart()).rejects.toThrow('chrome.storage.session');
        expect(await s.getRecentOrigins()).toEqual([]);
    });

    test('a failed operation does not block the queue', async () => {
        const local = fakeArea();
        const s = createSettings({ sync: fakeArea(), local, session: fakeArea() });
        const origSet = local.set;
        local.set = async () => { throw new Error('quota'); };
        await expect(s.addRecentOrigin('https://a.test')).rejects.toThrow('quota');
        local.set = origSet;
        expect(await s.addRecentOrigin('https://a.test')).toBe(true);
    });
});
