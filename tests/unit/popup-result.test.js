/**
 * Unit tests for popup-result.js (minimal fake DOM, no jsdom)
 */

import { renderResult, defaultDownload, formatBytes, formatTimestamp } from '../../popup-result.js';
import { buildReport, summaryText, reportToJson, reportToMarkdown, reportFileName } from '../../report.js';
import { getMessage, setFallbackMessages } from '../../i18n.js';

/* ---------- Tiny fake DOM ---------- */

class FakeText {
    constructor(text) { this.text = String(text); }
    get textContent() { return this.text; }
}

class FakeElement {
    constructor(tagName, ownerDocument) {
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDocument;
        this.children = [];
        this.attributes = new Map();
        this.listeners = {};
        this.className = '';
        this.hidden = false;
        this.disabled = false;
        this.value = '';
        const classes = new Set();
        this.classList = { add: (...n) => n.forEach(c => classes.add(c)), contains: c => classes.has(c) };
        this._classes = classes;
        this.focused = false;
    }

    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    removeAttribute(name) { this.attributes.delete(name); }
    get id() { return this.getAttribute('id') || ''; }
    focus() { this.focused = true; }
    append(...nodes) {
        for (const node of nodes) this.children.push(typeof node === 'string' ? new FakeText(node) : node);
    }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    get textContent() { return this.children.map(c => c.textContent).join(''); }
    set textContent(value) { this.children = value === '' ? [] : [new FakeText(value)]; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    fire(type, event = {}) {
        const evt = { preventDefault() {}, ...event };
        for (const fn of this.listeners[type] || []) fn(evt);
    }
    classes() { return new Set([...this.className.split(/\s+/).filter(Boolean), ...this._classes]); }
    matches(compound) {
        const re = /(^[a-z0-9]+)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=([^\]]+))?\]/gi;
        let m;
        while ((m = re.exec(compound))) {
            if (m[1] && this.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
            if (m[2] && this.id !== m[2]) return false;
            if (m[3] && !this.classes().has(m[3])) return false;
            if (m[4]) {
                const v = this.getAttribute(m[4]);
                if (v === null || (m[5] !== undefined && v !== m[5])) return false;
            }
        }
        return true;
    }
    all() {
        const out = [];
        for (const c of this.children) {
            if (c instanceof FakeElement) out.push(c, ...c.all());
        }
        return out;
    }
    querySelectorAll(selector) {
        const parts = selector.trim().split(/\s+/);
        let scope = [this];
        for (const part of parts) {
            const next = [];
            for (const s of scope) for (const el of s.all()) if (el.matches(part) && !next.includes(el)) next.push(el);
            scope = next;
        }
        return scope;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function fakeDocument() {
    const doc = {
        createElement: tag => new FakeElement(tag, doc),
        createElementNS: (ns, tag) => new FakeElement(tag, doc)
    };
    return doc;
}

const MESSAGES = {
    dataTypeCookies: 'Cookies',
    dataTypeSessionStorage: 'Session Storage',
    dataTypeLocalStorage: 'Local Storage',
    dataTypeIndexedDB: 'IndexedDB',
    dataTypeFileSystems: 'File systems',
    dataTypeHttpCache: 'HTTP cache',
    dataTypeCacheStorage: 'Cache Storage',
    dataTypeServiceWorkers: 'Service Workers',
    resultTitle: 'Cleanup result',
    resultDone: 'Done',
    resultCleanedIn: 'Cleaned in $1 ms',
    resultCleanedWithErrors: 'Cleaned with errors',
    resultAfterNone: 'The tab was left as it was.',
    resultAfterReload: 'Tab reloaded.',
    resultAfterHard: 'Tab reloaded without cache.',
    resultAfterStart: 'Opened the start page.',
    resultOriginsOne: 'Only 1 origin processed.',
    resultOriginsMany: '$1 origins processed.',
    resultMoreErrors: '+$1 more',
    resultColType: 'Type',
    resultColBefore: 'Before',
    resultColAfter: 'After',
    resultStorageUsage: 'Storage usage',
    resultKeptCookiesOne: '1 shared domain cookie kept on purpose ($2).',
    resultKeptCookiesMany: '$1 shared domain cookies kept on purpose ($2).',
    resultKeptCookiesNoDomainOne: '1 shared domain cookie kept on purpose.',
    resultKeptCookiesNoDomainMany: '$1 shared domain cookies kept on purpose.',
    resultCopySummary: 'Copy summary',
    resultExportJson: 'Export JSON',
    resultExportMd: 'Markdown',
    resultCopied: 'Copied',
    resultCopyFailed: 'Could not copy',
    resultExported: 'Exported $1',
    resultExportFailed: 'Could not export the report'
};

const O = 'https://staging.app.example.test';
const NOW = Date.UTC(2026, 9, 23, 3, 42, 18);
const snap = (over = {}) => ({
    cookies: 9, sessionStorage: 4, localStorage: 14, indexedDB: 2, fileSystems: 0, cache: null,
    cacheStorage: 3, serviceWorkers: 1, usage: 18.4 * 1024 * 1024, quota: 1e9, persisted: false, ...over
});
const cleared = (over = {}) => snap({
    cookies: 3, sessionStorage: 0, localStorage: 0, indexedDB: 0, cacheStorage: 0, serviceWorkers: 0, usage: 0.2 * 1024 * 1024, ...over
});
const DATA_TYPES = ['cookies', 'sessionStorage', 'localStorage', 'indexedDB', 'cacheStorage', 'serviceWorkers'];

function makeReport({ origins = [O], result = {}, before, after, dataTypes = DATA_TYPES, timeZone = 'UTC' } = {}) {
    const plan = {
        version: 1, source: 'popup', origins, dataTypes, cookieMode: 'exact', since: 0, after: 'hard',
        startPath: '/', presetId: 'fresh', tab: null
    };
    const b = {};
    const a = {};
    for (const o of origins) {
        b[o] = before || snap();
        a[o] = after || cleared();
    }
    return buildReport({
        plan, description: { preset: 'fresh', scope: 'exact' }, before: b, after: a,
        result: {
            ok: true, durationMs: 412,
            perOrigin: origins.map(o => ({ origin: o, types: {}, cookies: { removed: 6, kept: 3, failed: 0 }, errors: [] })),
            after: { action: 'hard', ok: true },
            ...result
        },
        env: { extensionVersion: '1.3.0', chromeVersion: '154.0.7000.1', timeZone, now: NOW }
    });
}

function mount(report, options = {}) {
    setFallbackMessages(MESSAGES);
    const doc = fakeDocument();
    const container = new FakeElement('section', doc);
    const calls = { done: 0, downloads: [], clipboard: [] };
    const api = renderResult(container, {
        report,
        getMessage,
        onDone: () => { calls.done += 1; },
        clipboard: { writeText: async text => { calls.clipboard.push(text); } },
        download: (filename, text, mime) => calls.downloads.push({ filename, text, mime }),
        ...options
    });
    return { container, calls, api };
}

const cell = (container, type, which) => container.querySelector(`#resultTable tr[data-type=${type}] td.${which}`);

describe('renderResult - structure', () => {
    test('banner, hooks and rows', () => {
        const { container } = mount(makeReport());
        const banner = container.querySelector('#resultBanner');
        expect(banner.getAttribute('data-tone')).toBe('success');
        expect(banner.getAttribute('role')).toBe('status');
        expect(banner.textContent).toContain('Cleaned in 412 ms');
        expect(banner.textContent).toContain('Tab reloaded without cache.');
        expect(banner.textContent).toContain('Only 1 origin processed.');
        for (const id of ['#resultTable', '#copySummaryBtn', '#exportJsonBtn', '#exportMdBtn', '#resultDoneBtn']) {
            expect(container.querySelector(id)).not.toBeNull();
        }
        expect(container.querySelector('.result-origin').textContent).toBe(O);
        const header = container.querySelector('#resultTable thead').textContent;
        expect(header).toBe('TypeBeforeAfter');
    });

    test('one tr[data-type] per selected type plus usage, in report order', () => {
        const { container } = mount(makeReport());
        const rows = container.querySelectorAll('#resultTable tr[data-type]');
        expect(rows.map(r => r.getAttribute('data-type'))).toEqual([...DATA_TYPES, 'usage']);
        expect(rows[0].querySelector('th').textContent).toBe('Cookies');
        expect(rows[6].querySelector('th').textContent).toBe('Storage usage');
    });

    test('before/after values, tones, kept-cookie star and footnote', () => {
        const report = makeReport();
        report.perOrigin[0].cookies.domain = '.example.test';
        const { container } = mount(report);
        expect(cell(container, 'cookies', 'before').textContent).toBe('9');
        expect(cell(container, 'cookies', 'after').textContent).toBe('3*');
        expect(cell(container, 'cookies', 'after').className).toContain('tone-warn');
        expect(cell(container, 'localStorage', 'after').textContent).toBe('0');
        expect(cell(container, 'localStorage', 'after').className).toContain('tone-ok');
        expect(cell(container, 'usage', 'before').textContent).toMatch(/^18[.,]4 MB$/);
        expect(cell(container, 'usage', 'after').textContent).toMatch(/^20[0-9] KB$/);
        expect(container.querySelector('.result-footnote').textContent)
            .toBe('* 3 shared domain cookies kept on purpose (.example.test).');
    });

    test('footnote without a known domain', () => {
        const { container } = mount(makeReport());
        expect(container.querySelector('.result-footnote').textContent)
            .toBe('* 3 shared domain cookies kept on purpose.');
    });

    test('not measurable values render an en dash; unselected types are omitted', () => {
        const report = makeReport({ dataTypes: ['cookies', 'cache'] });
        const { container } = mount(report);
        expect(container.querySelectorAll('#resultTable tr[data-type]').map(r => r.getAttribute('data-type')))
            .toEqual(['cookies', 'cache', 'usage']);
        expect(cell(container, 'cache', 'before').textContent).toBe('\u2013');
        expect(cell(container, 'cache', 'after').textContent).toBe('\u2013');
        expect(cell(container, 'cache', 'after').className).not.toContain('tone-');
    });

    test('unchanged non-zero count after cleaning is flagged', () => {
        const { container } = mount(makeReport({ after: cleared({ indexedDB: 2 }) }));
        expect(cell(container, 'indexedDB', 'after').className).toContain('tone-bad');
    });

    test('multiple origins get one table each', () => {
        const origins = [O, 'http://localhost:5173', 'https://api.example.test:8443'];
        const { container } = mount(makeReport({ origins }));
        const tables = container.querySelectorAll('table');
        expect(tables.length).toBe(3);
        expect(tables.map(t => t.getAttribute('data-origin'))).toEqual(origins);
        expect(container.querySelector('#resultBanner').textContent).toContain('3 origins processed.');
        expect(container.querySelectorAll('#resultTable').length).toBe(1);
        expect(container.querySelectorAll('h3').map(h => h.textContent)).toEqual(origins);
    });

    test('after-action sentences', () => {
        const sentence = (action, extra = {}) => {
            const { container } = mount(makeReport({ result: { after: { action, ok: true } } }), extra);
            return container.querySelector('#resultBanner').textContent;
        };
        expect(sentence('none')).toContain('The tab was left as it was.');
        expect(sentence('reload')).toContain('Tab reloaded.');
        expect(sentence('hard')).toContain('Tab reloaded without cache.');
        expect(sentence('start')).toContain('Opened the start page.');
        expect(sentence('none', { afterAction: 'start' })).toContain('Opened the start page.');
    });

    test('error banner lists the first error and a count of the rest', () => {
        const report = makeReport({
            result: {
                ok: false,
                perOrigin: [{
                    origin: O, types: {}, cookies: null,
                    errors: [
                        { type: 'cookies', code: 'COOKIE_PERMISSION_MISSING', message: 'Permission missing.' },
                        { type: 'localStorage', code: 'REMOVE_FAILED', message: 'Nope.' }
                    ]
                }]
            }
        });
        const { container } = mount(report);
        const banner = container.querySelector('#resultBanner');
        expect(banner.getAttribute('data-tone')).not.toBe('success');
        expect(banner.getAttribute('role')).toBe('alert');
        expect(banner.textContent).toContain('Cleaned with errors');
        expect(banner.textContent).toContain('COOKIE_PERMISSION_MISSING Permission missing.');
        expect(banner.textContent).not.toContain('REMOVE_FAILED');
        expect(banner.textContent).toContain('+1 more');
    });

    test('failed after-action does not claim a reload', () => {
        const report = makeReport({ result: { after: { action: 'hard', ok: false, error: { message: 'Tab closed.' } } } });
        const { container } = mount(report);
        const banner = container.querySelector('#resultBanner');
        expect(banner.textContent).not.toContain('Tab reloaded');
        expect(banner.textContent).toContain('AFTER_ACTION_FAILED Tab closed.');
    });

    test('footer shows local time with zone, Chrome major and extension version', () => {
        const { container } = mount(makeReport());
        expect(container.querySelector('.result-meta').textContent).toBe('2026-10-23 03:42:18 UTC \u00B7 Chrome 154 \u00B7 v1.3.0');
    });
});

describe('renderResult - privacy', () => {
    test('never renders cookie values or unknown fields, even when present in the report', () => {
        const report = makeReport();
        report.perOrigin[0].cookies.value = 'SECRET-COOKIE-VALUE';
        report.perOrigin[0].rows[0].cookieValue = 'SECRET-ROW-VALUE';
        report.perOrigin[0].extra = { value: 'SECRET-EXTRA', items: [{ value: 'SECRET-ITEM' }] };
        report.extra = { storageValue: 'SECRET-STORAGE' };
        const { container } = mount(report);
        const text = container.textContent;
        expect(text).not.toContain('SECRET');
        expect(text.toLowerCase()).not.toContain('value');
        for (const el of container.all()) {
            for (const v of el.attributes.values()) expect(v).not.toContain('SECRET');
        }
    });

    test('exports refuse a report that contains forbidden keys', () => {
        const report = makeReport();
        report.perOrigin[0].cookies.value = 'SECRET-COOKIE-VALUE';
        const { container, calls, api } = mount(report);
        container.querySelector('#exportJsonBtn').fire('click');
        container.querySelector('#exportMdBtn').fire('click');
        expect(calls.downloads).toEqual([]);
        expect(container.querySelector('#resultLive').textContent).toBe('Could not export the report');
        expect(typeof api.announce).toBe('function');
    });

    test('uses textContent only (no innerHTML assignments)', () => {
        const { container } = mount(makeReport());
        for (const el of container.all()) expect(el.innerHTML).toBeUndefined();
    });
});

describe('renderResult - actions', () => {
    test('Done calls onDone', () => {
        const { container, calls } = mount(makeReport());
        container.querySelector('#resultDoneBtn').fire('click');
        expect(calls.done).toBe(1);
    });

    test('copy summary writes the report summary and gives feedback', async () => {
        const report = makeReport();
        const { container, calls } = mount(report);
        const btn = container.querySelector('#copySummaryBtn');
        await Promise.all(btn.listeners.click.map(fn => fn({})));
        expect(calls.clipboard).toEqual([summaryText(report)]);
        expect(btn.textContent).toBe('Copied');
        expect(container.querySelector('#resultLive').textContent).toBe('Copied');
        expect(container.querySelector('#resultLive').getAttribute('aria-live')).toBe('polite');
    });

    test('copy failure is reported, not thrown', async () => {
        const { container } = mount(makeReport(), { clipboard: { writeText: async () => { throw new Error('denied'); } } });
        const btn = container.querySelector('#copySummaryBtn');
        await Promise.all(btn.listeners.click.map(fn => fn({})));
        expect(btn.textContent).toBe('Could not copy');
    });

    test('exports use report.js serializers and file names', () => {
        const report = makeReport({ timeZone: 'UTC' });
        const { container, calls } = mount(report);
        container.querySelector('#exportJsonBtn').fire('click');
        container.querySelector('#exportMdBtn').fire('click');
        expect(calls.downloads.length).toBe(2);
        const [json, md] = calls.downloads;
        expect(json.filename).toMatch(/^aw-cleaner-staging\.app\.example\.test-\d{8}-\d{6}\.json$/);
        expect(md.filename).toMatch(/^aw-cleaner-staging\.app\.example\.test-\d{8}-\d{6}\.md$/);
        expect(json.filename).toBe(reportFileName(report, 'json'));
        expect(json.filename).toBe('aw-cleaner-staging.app.example.test-20261023-034218.json');
        expect(md.filename).toBe('aw-cleaner-staging.app.example.test-20261023-034218.md');
        expect(json.text).toBe(reportToJson(report));
        expect(md.text).toBe(reportToMarkdown(report));
        expect(json.mime).toContain('application/json');
        expect(md.mime).toContain('text/markdown');
        expect(container.querySelector('#resultLive').textContent).toBe(`Exported ${md.filename}`);
    });

    test('export file name uses the report time zone', () => {
        const report = makeReport({ timeZone: 'Asia/Jakarta' });
        const { container, calls } = mount(report);
        container.querySelector('#exportJsonBtn').fire('click');
        expect(calls.downloads[0].filename).toBe('aw-cleaner-staging.app.example.test-20261023-104218.json');
    });
});

describe('defaultDownload', () => {
    test('creates a Blob URL, clicks a temporary download link and revokes the URL', async () => {
        const created = [];
        const revoked = [];
        const clicked = [];
        const appended = [];
        const savedDoc = globalThis.document;
        const savedUrl = { c: URL.createObjectURL, r: URL.revokeObjectURL };
        URL.createObjectURL = blob => { created.push(blob); return 'blob:fake-1'; };
        URL.revokeObjectURL = url => { revoked.push(url); };
        globalThis.document = {
            createElement: () => {
                const link = {
                    removed: false, remove() { this.removed = true; }, click() { clicked.push({ href: this.href, download: this.download }); }
                };
                return link;
            },
            body: { append: node => appended.push(node) }
        };
        try {
            defaultDownload('report.json', '{"a":1}', 'application/json');
            expect(created.length).toBe(1);
            expect(created[0].type).toContain('application/json');
            expect(await created[0].text()).toBe('{"a":1}');
            expect(clicked).toEqual([{ href: 'blob:fake-1', download: 'report.json' }]);
            expect(appended[0].removed).toBe(true);
            await new Promise(resolve => setTimeout(resolve, 1100));
            expect(revoked).toEqual(['blob:fake-1']);
        } finally {
            globalThis.document = savedDoc;
            URL.createObjectURL = savedUrl.c;
            URL.revokeObjectURL = savedUrl.r;
        }
    });
});

describe('formatBytes / formatTimestamp', () => {
    test('formats bytes', () => {
        expect(formatBytes(0, 'en-US')).toBe('0 B');
        expect(formatBytes(1023, 'en-US')).toBe('1023 B');
        expect(formatBytes(1024, 'en-US')).toBe('1 KB');
        expect(formatBytes(1536, 'en-US')).toBe('1.5 KB');
        expect(formatBytes(18.4 * 1024 * 1024, 'en-US')).toBe('18.4 MB');
        expect(formatBytes(512 * 1024, 'en-US')).toBe('512 KB');
        expect(formatBytes(3 * 1024 ** 3, 'en-US')).toBe('3 GB');
        expect(formatBytes(1536, 'id-ID')).toBe('1,5 KB');
    });

    test('formats the report time in its zone', () => {
        const base = { generatedAt: new Date(NOW).toISOString() };
        expect(formatTimestamp({ ...base, timeZone: 'UTC' })).toBe('2026-10-23 03:42:18 UTC');
        expect(formatTimestamp({ ...base, timeZone: 'Asia/Jakarta' })).toMatch(/^2026-10-23 10:42:18 /);
        expect(formatTimestamp({ ...base, timeZone: 'Not/AZone' })).toBe('2026-10-23 03:42:18 UTC');
        expect(formatTimestamp({ generatedAt: 'garbage', timeZone: 'UTC' })).toBe('');
    });
});
