/**
 * Unit tests for report.js
 */

import {
    diffSnapshots, buildReport, assertNoSensitiveValues, reportToJson, reportToMarkdown,
    summaryText, reportFileName, historyEntry
} from '../../report.js';
import { DATA_TYPE_KEYS } from '../../cleanup-core.js';

const ORIGIN = 'https://app.example.test';
const NOW = Date.UTC(2026, 0, 31, 14, 5, 9); // 2026-01-31T14:05:09Z

const snap = (over = {}) => ({
    cookies: 4, sessionStorage: 2, localStorage: 7, indexedDB: 1, fileSystems: 0,
    cache: null, cacheStorage: 2, serviceWorkers: 1, usage: 5 * 1024 * 1024, quota: 1e9, persisted: false,
    ...over
});
const cleared = () => snap({ cookies: 0, sessionStorage: 0, localStorage: 0, indexedDB: 0, cacheStorage: 0, serviceWorkers: 0, usage: 1024 });

const plan = (over = {}) => ({
    version: 1, source: 'popup', origins: [ORIGIN], dataTypes: ['cookies', 'localStorage'],
    cookieMode: 'exact', since: 0, after: 'reload', startPath: '/', presetId: 'logout', tab: null, ...over
});
const result = (over = {}) => ({
    ok: true, startedAt: NOW, finishedAt: NOW + 120, durationMs: 120,
    perOrigin: [{ origin: ORIGIN, types: {}, cookies: { removed: 4, kept: 0, failed: 0 }, errors: [] }],
    after: { action: 'reload', ok: true },
    ...over
});
const env = { extensionVersion: '1.3.0', chromeVersion: '130.0.0.0', timeZone: 'UTC', now: NOW };
const build = (over = {}) => buildReport({
    plan: plan(), description: { preset: 'logout', scope: 'exact' },
    before: { [ORIGIN]: snap() }, after: { [ORIGIN]: cleared() }, result: result(), env, ...over
});

describe('diffSnapshots', () => {
    test('returns a row per data type plus usage', () => {
        const rows = diffSnapshots(snap(), cleared());
        expect(rows.map(r => r.type)).toEqual([...DATA_TYPE_KEYS, 'usage']);
    });

    test('classifies cleared / unchanged / unknown', () => {
        const rows = Object.fromEntries(diffSnapshots(snap(), snap({ cookies: 0, fileSystems: 0 })).map(r => [r.type, r]));
        expect(rows.cookies.status).toBe('cleared');
        expect(rows.localStorage.status).toBe('unchanged');
        expect(rows.fileSystems.status).toBe('unchanged');
        expect(rows.cache.status).toBe('unknown');
        expect(rows.cache.before).toBeNull();
    });

    test('keeps cookies that survived on purpose', () => {
        const rows = Object.fromEntries(diffSnapshots(snap({ cookies: 5 }), snap({ cookies: 2 }), { keptCookies: 2 }).map(r => [r.type, r]));
        expect(rows.cookies.status).toBe('kept');
        expect(rows.cookies.note).toBe('keptCookies');
    });

    test('partial reduction without kept cookies is cleared (partial)', () => {
        const rows = Object.fromEntries(diffSnapshots(snap({ cookies: 5 }), snap({ cookies: 2 })).map(r => [r.type, r]));
        expect(rows.cookies.status).toBe('cleared');
        expect(rows.cookies.note).toBe('partial');
    });

    test('increase is unchanged (increased)', () => {
        const rows = Object.fromEntries(diffSnapshots(snap({ localStorage: 1 }), snap({ localStorage: 3 })).map(r => [r.type, r]));
        expect(rows.localStorage.status).toBe('unchanged');
        expect(rows.localStorage.note).toBe('increased');
    });

    test('missing snapshots are all unknown', () => {
        for (const r of diffSnapshots(null, undefined)) {
            expect(r.status).toBe('unknown');
            expect(r.before).toBeNull();
            expect(r.after).toBeNull();
        }
    });

    test('ignores non-numeric values', () => {
        const rows = diffSnapshots({ cookies: 'x', localStorage: NaN }, { cookies: 0, localStorage: 0 });
        expect(rows.find(r => r.type === 'cookies').status).toBe('unknown');
        expect(rows.find(r => r.type === 'localStorage').status).toBe('unknown');
    });
});

describe('buildReport', () => {
    test('has the documented shape', () => {
        const r = build();
        expect(r.format).toBe('aw-browser-cleaner-report');
        expect(r.version).toBe(1);
        expect(r.generatedAt).toBe('2026-01-31T14:05:09.000Z');
        expect(r.timeZone).toBe('UTC');
        expect(r.extension).toEqual({ version: '1.3.0' });
        expect(r.browser).toEqual({ chromeVersion: '130.0.0.0' });
        expect(r.origins).toEqual([ORIGIN]);
        expect(r.preset).toBe('logout');
        expect(r.dataTypes).toEqual(['cookies', 'localStorage']);
        expect(r.cookieMode).toBe('exact');
        expect(r.since).toBe(0);
        expect(r.after).toEqual({ action: 'reload', ok: true });
        expect(r.durationMs).toBe(120);
        expect(r.ok).toBe(true);
        expect(r.perOrigin.length).toBe(1);
        expect(r.perOrigin[0].origin).toBe(ORIGIN);
        expect(r.perOrigin[0].cookies).toEqual({ removed: 4, kept: 0, failed: 0 });
        expect(r.perOrigin[0].rows.length).toBe(DATA_TYPE_KEYS.length + 1);
        expect(r.errors).toEqual([]);
    });

    test('includes userAgent only when provided', () => {
        expect(build().browser.userAgent).toBeUndefined();
        expect(build({ env: { ...env, userAgent: 'UA/1' } }).browser.userAgent).toBe('UA/1');
    });

    test('collects per-origin and after-action errors', () => {
        const res = result({
            ok: false,
            perOrigin: [{ origin: ORIGIN, types: {}, cookies: { removed: 1, kept: 0, failed: 2 }, errors: [{ type: 'cookies', code: 'COOKIE_PERMISSION_MISSING', message: 'nope' }] }],
            after: { action: 'reload', ok: false, error: { message: 'tab closed' } }
        });
        const r = build({ result: res });
        expect(r.ok).toBe(false);
        expect(r.errors.length).toBe(2);
        expect(r.errors[0]).toEqual({ origin: ORIGIN, type: 'cookies', code: 'COOKIE_PERMISSION_MISSING', message: 'nope' });
        expect(r.errors[1].code).toBe('AFTER_ACTION_FAILED');
        expect(r.perOrigin[0].errors.length).toBe(1);
    });

    test('feeds kept cookies into the diff', () => {
        const res = result({ perOrigin: [{ origin: ORIGIN, types: {}, cookies: { removed: 2, kept: 2, failed: 0 }, errors: [] }] });
        const r = build({ result: res, after: { [ORIGIN]: snap({ cookies: 2 }) } });
        expect(r.perOrigin[0].rows.find(x => x.type === 'cookies').status).toBe('kept');
    });

    test('handles unmeasured origins and null cookie results', () => {
        const r = build({ before: {}, after: {}, result: result({ perOrigin: [{ origin: ORIGIN, errors: [] }] }) });
        expect(r.perOrigin[0].cookies).toBeNull();
        expect(r.perOrigin[0].rows.every(x => x.status === 'unknown')).toBe(true);
    });

    test('never carries cookie values or storage contents', () => {
        const dirty = result({
            perOrigin: [{ origin: ORIGIN, cookies: { removed: 1, kept: 0, failed: 0, value: 'SECRET' }, errors: [{ type: 'cookies', code: 'X', message: 'm', value: 'SECRET' }] }]
        });
        const json = reportToJson(build({ result: dirty }));
        expect(json).not.toContain('SECRET');
    });

    test('falls back to the plan preset id', () => {
        expect(build({ description: undefined }).preset).toBe('logout');
    });
});

describe('assertNoSensitiveValues', () => {
    test('passes clean objects', () => {
        expect(() => assertNoSensitiveValues({ a: [{ b: 1 }], c: 'text' })).not.toThrow();
        expect(() => assertNoSensitiveValues(null)).not.toThrow();
    });

    test('throws on forbidden keys at any depth', () => {
        for (const key of ['value', 'cookieValue', 'storageValue', 'items', 'entries']) {
            expect(() => assertNoSensitiveValues({ key })).not.toThrow();
            expect(() => assertNoSensitiveValues({ a: { b: [{ [key]: 'x' }] } })).toThrow(/Sensitive key/);
        }
    });
});

describe('reportToJson', () => {
    test('is pretty printed with 2 spaces and parses back', () => {
        const r = build();
        const json = reportToJson(r);
        expect(json).toContain('\n  "format": "aw-browser-cleaner-report"');
        expect(JSON.parse(json)).toEqual(r);
    });

    test('refuses reports with sensitive keys', () => {
        const r = build();
        r.perOrigin[0].cookies.value = 'x';
        expect(() => reportToJson(r)).toThrow();
        expect(() => reportToMarkdown(r)).toThrow();
    });
});

describe('reportToMarkdown', () => {
    test('contains title, metadata, tables and footer', () => {
        const md = reportToMarkdown(build());
        expect(md).toStartWith('# AW Browser Cleaner report');
        expect(md).toContain('| Origins | https://app.example.test |');
        expect(md).toContain('| Type | Before | After | Status |');
        expect(md).toContain('| Cookies | 4 | 0 | cleared |');
        expect(md).toContain('| HTTP cache | – | – | not measurable |');
        expect(md).toContain('| Storage usage | 5.0 MB | 1.0 KB | cleared |');
        expect(md).toContain('## Errors');
        expect(md).toContain('None.');
        expect(md).toContain('Generated 2026-01-31 14:05:09 (UTC) | Chrome 130.0.0.0 | AW Browser Cleaner 1.3.0');
    });

    test('lists errors and escapes table pipes', () => {
        const res = result({ ok: false, perOrigin: [{ origin: ORIGIN, cookies: null, errors: [{ type: 'cookies', code: 'E', message: 'a|b' }] }] });
        const md = reportToMarkdown(build({ result: res }));
        expect(md).toContain('completed with errors');
        expect(md).toContain('a\\|b');
    });

    test('shows the footer time in the report time zone', () => {
        const md = reportToMarkdown(build({ env: { ...env, timeZone: 'Asia/Jakarta' } }));
        expect(md).toContain('2026-01-31 21:05:09 (Asia/Jakarta)');
    });
});

describe('summaryText', () => {
    test('is short multi-line text', () => {
        const text = summaryText(build());
        const lines = text.split('\n');
        expect(lines.length).toBeGreaterThanOrEqual(4);
        expect(lines.length).toBeLessThan(10);
        expect(text).toContain(ORIGIN);
        expect(text).toContain('cookies 4→0');
        expect(text).not.toContain('cache null');
    });

    test('mentions error count', () => {
        const res = result({ ok: false, perOrigin: [{ origin: ORIGIN, cookies: null, errors: [{ type: 't', code: 'c', message: 'm' }] }] });
        expect(summaryText(build({ result: res }))).toContain('Errors: 1');
    });
});

describe('reportFileName', () => {
    const named = (origin, extra = {}) => ({ origins: [origin], generatedAt: '2026-01-31T14:05:09.000Z', timeZone: 'UTC', ...extra });

    test('plain host', () => {
        expect(reportFileName(named(ORIGIN), 'json')).toBe('aw-cleaner-app.example.test-20260131-140509.json');
    });

    test('appends the port with a dash', () => {
        expect(reportFileName(named('http://localhost:3000'), 'md')).toBe('aw-cleaner-localhost-3000-20260131-140509.md');
    });

    test('replaces IPv6 brackets and colons', () => {
        const name = reportFileName(named('http://[::1]:8080'), 'json');
        expect(name).toBe('aw-cleaner---1-8080-20260131-140509.json');
        expect(name).not.toMatch(/[[\]:]/);
    });

    test('uses the local time zone of the report', () => {
        expect(reportFileName(named(ORIGIN, { timeZone: 'Asia/Jakarta' }), 'json')).toContain('20260131-210509');
    });

    test('falls back to UTC for an invalid time zone and sanitizes extension', () => {
        expect(reportFileName(named(ORIGIN, { timeZone: 'Not/AZone' }), '../json')).toBe('aw-cleaner-app.example.test-20260131-140509.json');
    });

    test('handles missing origins', () => {
        expect(reportFileName({ origins: [], generatedAt: '2026-01-31T14:05:09.000Z', timeZone: 'UTC' }, 'json')).toStartWith('aw-cleaner-unknown-');
    });
});

describe('historyEntry', () => {
    test('has only metadata', () => {
        const entry = historyEntry(build());
        expect(Object.keys(entry).sort()).toEqual(['at', 'durationMs', 'id', 'ok', 'origins', 'presetId']);
        expect(entry.at).toBe('2026-01-31T14:05:09.000Z');
        expect(entry.origins).toEqual([ORIGIN]);
        expect(entry.presetId).toBe('logout');
        expect(entry.durationMs).toBe(120);
        expect(entry.ok).toBe(true);
        expect(typeof entry.id).toBe('string');
        expect(() => assertNoSensitiveValues(entry)).not.toThrow();
    });

    test('id is stable for the same report', () => {
        expect(historyEntry(build()).id).toBe(historyEntry(build()).id);
        expect(historyEntry(build({ env: { ...env, now: NOW + 1000 } })).id).not.toBe(historyEntry(build()).id);
    });
});
