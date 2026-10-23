/**
 * AW Browser Cleaner - Options page markup, i18n and helper tests
 *
 * - every i18n key used by options.html / options.js exists in the merged locales
 *   (or in the options fragments that are merged into them),
 * - options.js never renders dynamic text through innerHTML,
 * - the page structure the navigation and the controller rely on exists,
 * - pure helpers (slugs, formatting, origin lists, error routing, history export).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    slugify, uniqueId, parseList, parseOriginList, parseOriginLines, originFromPattern, grantMatchesPattern,
    formatClock, formatEntryTime, formatDuration, formatDateStamp, formatDateTimeStamp,
    presetsFileName, historyFileName, buildHistoryExport, messagesToFallback, routeErrors
} from '../../options.js';
import { validatePreset, BUILTIN_PRESETS } from '../../presets.js';
import { DATA_TYPES } from '../../cleanup-core.js';

const ROOT_DIR = path.resolve(import.meta.dir, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT_DIR, p), 'utf8');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

const html = read('options.html');
const js = read('options.js');
const css = read('options.css');

/** Locale messages shipped in _locales; `fragment` holds the options-page keys. */
function localeMessages(lang) {
    const merged = readJson(path.join(ROOT_DIR, '_locales', lang, 'messages.json'));
    const fragment = Object.fromEntries(Object.entries(merged).filter(([k]) => k.startsWith('options')));
    return { merged, fragment, all: merged };
}

function collectKeys() {
    const keys = new Set();
    for (const m of html.matchAll(/data-i18n(?:-[a-z]+)?="([A-Za-z]+)"/g)) keys.add(m[1]);
    for (const m of js.matchAll(/getMessage\('([A-Za-z]+)'/g)) keys.add(m[1]);
    for (const m of js.matchAll(/'(options[A-Za-z0-9]+)'/g)) keys.add(m[1]);
    for (const def of DATA_TYPES) keys.add(def.labelKey);
    for (const preset of BUILTIN_PRESETS) keys.add(preset.nameKey);
    return [...keys].sort();
}

describe('Options i18n coverage', () => {
    const keys = collectKeys();

    test('collects a meaningful set of keys', () => {
        expect(keys.length).toBeGreaterThan(60);
    });

    for (const lang of ['en', 'id']) {
        test(`every referenced key exists in ${lang}`, () => {
            const { all } = localeMessages(lang);
            expect(keys.filter(k => !all[k])).toEqual([]);
        });
    }

    test('options keys have identical key sets in EN and ID and valid placeholders', () => {
        const en = localeMessages('en').fragment;
        const id = localeMessages('id').fragment;
        expect(Object.keys(en).sort()).toEqual(Object.keys(id).sort());
        for (const [lang, fragment] of [['en', en], ['id', id]]) {
            for (const [key, entry] of Object.entries(fragment)) {
                expect(typeof entry.message).toBe('string');
                expect(entry.message.trim().length).toBeGreaterThan(0);
                const used = [...entry.message.matchAll(/\$([A-Z_]+)\$/g)].map(m => m[1].toLowerCase());
                for (const name of used) {
                    if (!entry.placeholders || !entry.placeholders[name]) {
                        throw new Error(`${lang}:${key} uses $${name.toUpperCase()}$ without a placeholder`);
                    }
                }
            }
        }
    });

    test('every options key is used by the page', () => {
        const unused = Object.keys(localeMessages('en').fragment).filter(k => !html.includes(`"${k}"`) && !js.includes(`'${k}'`));
        expect(unused).toEqual([]);
    });
});

describe('Options rendering safety', () => {
    test('options.js does not assign innerHTML, outerHTML or use insertAdjacentHTML', () => {
        expect(js).not.toMatch(/\.innerHTML\s*=/);
        expect(js).not.toMatch(/\.outerHTML\s*=/);
        expect(js).not.toMatch(/insertAdjacentHTML/);
        expect(js).not.toMatch(/document\.write/);
    });

    test('options.html has no inline script or handler and loads the module', () => {
        expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
        expect(html).not.toMatch(/\son[a-z]+="/);
        expect(html).toMatch(/<script type="module" src="options\.js">/);
    });
});

describe('Options page structure', () => {
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

    test('links the shared tokens and the page stylesheet, and overrides the popup body width', () => {
        expect(html).toMatch(/<link rel="stylesheet" href="styles\.css">/);
        expect(html).toMatch(/<link rel="stylesheet" href="options\.css">/);
        expect(html).toMatch(/<body class="options-page">/);
        expect(css).toMatch(/body\.options-page\s*\{[^}]*width:\s*auto/);
        expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
    });

    test('navigation items link to existing sections', () => {
        const hrefs = [...html.matchAll(/<a href="#([a-z]+)" data-section="([a-z]+)"/g)];
        expect(hrefs.map(m => m[1])).toEqual(['presets', 'permissions', 'testmode', 'history', 'shortcuts']);
        for (const [, href, section] of hrefs) {
            expect(href).toBe(section);
            expect(ids.has(href)).toBe(true);
            expect(html).toMatch(new RegExp(`<section id="${href}"`));
        }
        expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    });

    test('switches have role="switch" and aria-checked, test mode starts off', () => {
        const switches = [...html.matchAll(/<button[^>]*class="switch"[^>]*>/g)].map(m => m[0]);
        expect(switches).toHaveLength(2);
        for (const tag of switches) {
            expect(tag).toMatch(/role="switch"/);
            expect(tag).toMatch(/aria-checked="(true|false)"/);
        }
        expect(html).toMatch(/id="testModeSwitch"[^>]*aria-checked="false"/);
        expect(html).toMatch(/id="testOrigins"[^>]*\bdisabled\b/);
    });

    test('every element id used by options.js exists in options.html', () => {
        const used = new Set();
        for (const m of js.matchAll(/\$\('([A-Za-z]+)'\)/g)) used.add(m[1]);
        for (const m of js.matchAll(/(?:error|control): '([A-Za-z]+)'/g)) used.add(m[1]);
        for (const m of js.matchAll(/'(?:section|id)'\)\?\.querySelector/g)) used.add(m[1]);
        expect([...used].filter(id => !ids.has(id))).toEqual([]);
    });

    test('Shortcuts is hidden until the commands API answers', () => {
        expect(html).toMatch(/<section id="shortcuts"[^>]*\bhidden\b/);
    });

    test('the preset editor is a labelled dialog with a field per preset property', () => {
        expect(html).toMatch(/<dialog id="presetDialog"[^>]*aria-labelledby="editorTitle"/);
        for (const id of ['fName', 'fId', 'fTypes', 'fAfter', 'fStartPath', 'fBound', 'fOrigins', 'fKeep']) {
            expect(ids.has(id)).toBe(true);
        }
        expect(html).toMatch(/name="cookieMode" value="exact"/);
        expect(html).toMatch(/name="cookieMode" value="domainWide"/);
        for (const value of ['none', 'reload', 'hard', 'start']) {
            expect(html).toContain(`<option value="${value}"`);
        }
    });

    test('documents the Test Mode message protocol', () => {
        expect(html).toContain("chrome.runtime.sendMessage(EXTENSION_ID, { action: 'clean', preset: 'fresh' })");
    });
});

describe('slugify / uniqueId', () => {
    test('slugifies names into valid preset ids', () => {
        expect(slugify('QA checkout')).toBe('qa-checkout');
        expect(slugify('  Ünit  test: Ça va?  ')).toBe('unit-test-ca-va');
        expect(slugify('!!!')).toBe('');
        expect(slugify(undefined)).toBe('');
        const long = slugify('a'.repeat(30) + ' ' + 'b'.repeat(30));
        expect(long.length).toBeLessThanOrEqual(40);
        expect(long).not.toMatch(/-$/);
    });

    test('slugs that survive validatePreset', () => {
        const res = validatePreset({ id: slugify('My Preset #1'), name: 'My Preset #1', dataTypes: ['localStorage'] });
        expect(res.ok).toBe(true);
    });

    test('uniqueId appends a counter and respects the length limit', () => {
        expect(uniqueId('qa', [])).toBe('qa');
        expect(uniqueId('qa', ['qa'])).toBe('qa-2');
        expect(uniqueId('qa', ['qa', 'qa-2'])).toBe('qa-3');
        const base = 'x'.repeat(40);
        const next = uniqueId(base, [base]);
        expect(next.length).toBeLessThanOrEqual(40);
        expect(next.endsWith('-2')).toBe(true);
        expect(uniqueId('', [])).toBe('');
    });
});

describe('list parsing', () => {
    test('parseOriginList accepts commas, spaces and newlines', () => {
        expect(parseOriginList('http://localhost, http://127.0.0.1\nhttp://a.test:3000')).toEqual([
            'http://localhost', 'http://127.0.0.1', 'http://a.test:3000'
        ]);
        expect(parseOriginList('  ,\n ')).toEqual([]);
        expect(parseList(undefined)).toEqual([]);
    });

    test('parseOriginLines keeps one entry per non-empty line', () => {
        expect(parseOriginLines('https://a.test\r\n\n  https://b.test  \n')).toEqual(['https://a.test', 'https://b.test']);
    });

    test('originFromPattern only accepts exact http(s) host patterns', () => {
        expect(originFromPattern('https://app.example.test/*')).toBe('https://app.example.test');
        expect(originFromPattern('http://localhost:5173/*')).toBe('http://localhost:5173');
        expect(originFromPattern('*://*/*')).toBeNull();
        expect(originFromPattern('https://*.example.test/*')).toBeNull();
        expect(originFromPattern('<all_urls>')).toBeNull();
        expect(originFromPattern(undefined)).toBeNull();
    });

    test('grantMatchesPattern treats a port-less pattern as any port', () => {
        expect(grantMatchesPattern('http://localhost:5173', 'http://localhost')).toBe(true);
        expect(grantMatchesPattern('http://localhost:5173', 'http://localhost:5173')).toBe(true);
        expect(grantMatchesPattern('http://localhost:5173', 'http://localhost:3000')).toBe(false);
        expect(grantMatchesPattern('https://localhost', 'http://localhost')).toBe(false);
        expect(grantMatchesPattern('nonsense', 'http://localhost')).toBe(false);
    });
});

describe('formatting', () => {
    test('formatClock and formatEntryTime use local HH:mm', () => {
        const at = new Date(2026, 9, 21, 9, 5).toISOString();
        expect(formatClock(new Date(at))).toBe('09:05');
        expect(formatClock('nope')).toBe('--:--');
        const sameDay = new Date(2026, 9, 21, 23, 0).getTime();
        expect(formatEntryTime(at, sameDay)).toBe('09:05');
        const nextDay = new Date(2026, 9, 22, 8, 0).getTime();
        const other = formatEntryTime(at, nextDay, 'en');
        expect(other).toMatch(/09:05$/);
        expect(other.length).toBeGreaterThan(5);
        expect(formatEntryTime('bad')).toBe('--:--');
    });

    test('formatDuration', () => {
        expect(formatDuration(0)).toBe('0 ms');
        expect(formatDuration(420.4)).toBe('420 ms');
        expect(formatDuration(1240)).toBe('1.2 s');
        expect(formatDuration(125000)).toBe('2 min 5 s');
        expect(formatDuration(NaN)).toBe('-');
        expect(formatDuration(-5)).toBe('-');
    });

    test('file names use local date stamps', () => {
        const when = new Date(2026, 0, 2, 3, 4, 5);
        expect(formatDateStamp(when)).toBe('20260102');
        expect(formatDateTimeStamp(when)).toBe('20260102-030405');
        expect(presetsFileName(when)).toBe('aw-cleaner-presets-20260102.json');
        expect(historyFileName(when)).toBe('aw-cleaner-history-20260102-030405.json');
    });
});

describe('buildHistoryExport', () => {
    const entry = {
        id: 'a1', at: '2026-10-21T10:42:00.000Z', origins: ['https://app.example.test'],
        presetId: 'fresh', durationMs: 420, ok: true
    };

    test('exports only the summary fields, with a format header', () => {
        const parsed = JSON.parse(buildHistoryExport([{ ...entry, cookieValue: 'secret', extra: { value: 'x' } }], new Date(0)));
        expect(parsed.format).toBe('aw-browser-cleaner-history');
        expect(parsed.version).toBe(1);
        expect(parsed.exportedAt).toBe('1970-01-01T00:00:00.000Z');
        expect(parsed.history).toEqual([entry]);
        expect(JSON.stringify(parsed)).not.toContain('secret');
    });

    test('handles empty or invalid input', () => {
        expect(JSON.parse(buildHistoryExport(undefined)).history).toEqual([]);
        expect(JSON.parse(buildHistoryExport([null])).history).toHaveLength(1);
    });
});

describe('messagesToFallback', () => {
    test('turns named placeholders into positional ones', () => {
        const map = messagesToFallback({
            plain: { message: 'Hello' },
            withPlaceholder: {
                message: 'Cleaned $ORIGIN$ in $MS$',
                placeholders: { origin: { content: '$1' }, ms: { content: '$2' } }
            },
            broken: {}
        });
        expect(map).toEqual({ plain: 'Hello', withPlaceholder: 'Cleaned $1 in $2' });
        expect(messagesToFallback(null)).toEqual({});
    });

    test('converts the real English messages', () => {
        const map = messagesToFallback(localeMessages('en').merged);
        expect(map.optionsAfterStartPath).toBe('Open $1');
        expect(map.optionsPresetsDesc).not.toContain('$');
    });
});

describe('routeErrors', () => {
    test('routes real validatePreset errors to their editor fields', () => {
        const res = validatePreset({
            id: 'Bad Id', name: '', dataTypes: [], cookieMode: 'x', after: 'y', startPath: 'z',
            boundOrigin: 'ftp://x', origins: ['not an origin'], keepCookieNames: ['bad name']
        });
        expect(res.ok).toBe(false);
        const routes = routeErrors(res.errors);
        expect(Object.keys(routes).sort()).toEqual(
            ['after', 'bound', 'cookieMode', 'id', 'keep', 'name', 'origins', 'startPath', 'types']
        );
        expect(routes.general).toBeUndefined();
    });

    test('routes the origin limit and unknown messages', () => {
        const routes = routeErrors(['At most 10 origins are allowed in total (boundOrigin included).', 'At most 50 custom presets can be saved.']);
        expect(routes.origins).toHaveLength(1);
        expect(routes.general).toEqual(['At most 50 custom presets can be saved.']);
        expect(routeErrors(undefined)).toEqual({});
    });
});
