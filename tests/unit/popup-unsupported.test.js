/**
 * Unit tests for popup-unsupported.js (minimal fake DOM, no jsdom)
 */

import {
    normalizationPreview, relativeTime, schemeOf, describeTab, renderUnsupported, MAX_RECENT_ORIGINS
} from '../../popup-unsupported.js';
import { normalizeTarget } from '../../origin-utils.js';
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
    unsupportedTitle: "This page can't be cleaned",
    unsupportedBody: '$1 is not a web origin. The extension only works for $2 and $3 origins.',
    unsupportedBodyProtected: '$1 is protected by Chrome. The extension only works for $2 and $3 origins.',
    unsupportedUnknownPage: 'This page',
    unsupportedManualLabel: 'Or type a target URL',
    unsupportedPreviewLabel: 'Normalized to',
    previewNotePathDropped: 'Path, query and hash are removed',
    previewNoteDefaultScheme: 'default scheme $1',
    previewNoteDefaultPort: 'port $1',
    unsupportedContinueBtn: 'Continue with this origin',
    unsupportedRecentLabel: 'Recent origins',
    relTimeJustNow: 'just now',
    relTimeMinutes: '$1 min ago',
    relTimeHours: '$1 h ago',
    relTimeDays: '$1 d ago'
};

const NOW = Date.UTC(2026, 9, 23, 3, 42, 18);

function mount(options = {}) {
    setFallbackMessages(MESSAGES);
    const doc = fakeDocument();
    const container = new FakeElement('section', doc);
    const continued = [];
    const controller = renderUnsupported(container, {
        tabUrl: 'chrome://settings/privacy',
        recentOrigins: [],
        now: NOW,
        getMessage,
        onContinue: origin => continued.push(origin),
        ...options
    });
    return { container, continued, controller, input: container.querySelector('#manualTargetInput') };
}

function type(input, value) {
    input.value = value;
    input.fire('input');
}

/* ---------- normalizationPreview ---------- */

describe('normalizationPreview', () => {
    test('full URL with path, query and hash', () => {
        const p = normalizationPreview('https://staging.app.example.test/login?next=%2F#top');
        expect(p).toMatchObject({ show: true, valid: true, origin: 'https://staging.app.example.test', error: '' });
        expect(p.notes).toEqual(['previewNotePathDropped', 'previewNoteDefaultPort']);
        expect(p.port).toBe('443');
    });

    test('bare hostname gets default scheme, path note and port', () => {
        const p = normalizationPreview('staging.app.example.test/login?next=%2F');
        expect(p.origin).toBe('https://staging.app.example.test');
        expect(p.notes).toEqual(['previewNotePathDropped', 'previewNoteDefaultScheme', 'previewNoteDefaultPort']);
        expect(p.scheme).toBe('https');
        expect(p.port).toBe('443');
    });

    test('bare hostname only: scheme and port notes', () => {
        const p = normalizationPreview('example.test');
        expect(p.show).toBe(true);
        expect(p.notes).toEqual(['previewNoteDefaultScheme', 'previewNoteDefaultPort']);
    });

    test('http default port is 80', () => {
        const p = normalizationPreview('http://example.test/a');
        expect(p.notes).toEqual(['previewNotePathDropped', 'previewNoteDefaultPort']);
        expect(p.port).toBe('80');
    });

    test('IPv6 with explicit port', () => {
        const p = normalizationPreview('[::1]:8080');
        expect(p.valid).toBe(true);
        expect(p.origin).toBe('https://[::1]:8080');
        expect(p.notes).toEqual(['previewNoteDefaultScheme']);
        expect(normalizationPreview('http://[::1]:8080/x').origin).toBe('http://[::1]:8080');
    });

    test('IPv6 without port reports the default port', () => {
        const p = normalizationPreview('http://[::1]/');
        expect(p.origin).toBe('http://[::1]');
        expect(p.notes).toContain('previewNoteDefaultPort');
    });

    test('explicit port is not reported as default', () => {
        const p = normalizationPreview('http://localhost:5173/app');
        expect(p.origin).toBe('http://localhost:5173');
        expect(p.notes).toEqual(['previewNotePathDropped']);
    });

    test('exact origin is not shown (nothing to explain)', () => {
        const p = normalizationPreview('https://example.test');
        expect(p.valid).toBe(true);
        expect(p.show).toBe(false);
        expect(normalizationPreview('http://localhost:3000').show).toBe(false);
    });

    test('trailing slash alone is not a dropped path', () => {
        const p = normalizationPreview('https://example.test/');
        expect(p.show).toBe(true);
        expect(p.notes).not.toContain('previewNotePathDropped');
    });

    test('invalid input is not valid and carries the error', () => {
        for (const input of ['chrome://settings', 'ftp://example.test', 'http://', 'https://*.example.test', 'javascript:alert(1)']) {
            const p = normalizationPreview(input);
            expect(p.valid).toBe(false);
            expect(p.show).toBe(false);
            expect(p.origin).toBe('');
            expect(p.error).toBe(normalizeTarget(input).error);
            expect(p.error).not.toBe('');
        }
    });

    test('empty input has no error and no preview', () => {
        for (const input of ['', '   ', undefined, null]) {
            expect(normalizationPreview(input)).toEqual({ show: false, valid: false, origin: '', error: '', notes: [] });
        }
    });

    test('origin always equals normalizeTarget(input).origin', () => {
        const inputs = [
            'https://a.example.test/x?y#z', 'a.example.test', '[::1]:8080', 'http://127.0.0.1:8080/a', 'EXAMPLE.test:8443/path',
            'user:pw@example.test', 'http://', 'chrome://x', '', 'localhost', 'localhost:3000', 'https://example.test:443/'
        ];
        for (const input of inputs) {
            expect(normalizationPreview(input).origin).toBe(normalizeTarget(input).origin);
        }
    });
});

/* ---------- relativeTime / schemeOf ---------- */

describe('relativeTime', () => {
    const ago = ms => relativeTime(NOW - ms, NOW);

    test('buckets', () => {
        expect(ago(0)).toEqual({ key: 'relTimeJustNow', value: 0 });
        expect(ago(59 * 1000)).toEqual({ key: 'relTimeJustNow', value: 0 });
        expect(ago(60 * 1000)).toEqual({ key: 'relTimeMinutes', value: 1 });
        expect(ago(5 * 60 * 1000)).toEqual({ key: 'relTimeMinutes', value: 5 });
        expect(ago(59 * 60 * 1000 + 59000)).toEqual({ key: 'relTimeMinutes', value: 59 });
        expect(ago(60 * 60 * 1000)).toEqual({ key: 'relTimeHours', value: 1 });
        expect(ago(23 * 3600 * 1000)).toEqual({ key: 'relTimeHours', value: 23 });
        expect(ago(24 * 3600 * 1000)).toEqual({ key: 'relTimeDays', value: 1 });
        expect(ago(72 * 3600 * 1000 + 5)).toEqual({ key: 'relTimeDays', value: 3 });
    });

    test('accepts ISO strings and Dates; future or invalid is "just now"', () => {
        expect(relativeTime(new Date(NOW - 120000).toISOString(), NOW)).toEqual({ key: 'relTimeMinutes', value: 2 });
        expect(relativeTime(new Date(NOW - 7200000), NOW)).toEqual({ key: 'relTimeHours', value: 2 });
        expect(relativeTime(NOW + 5000, NOW).key).toBe('relTimeJustNow');
        expect(relativeTime('garbage', NOW).key).toBe('relTimeJustNow');
        expect(relativeTime(undefined, NOW).key).toBe('relTimeJustNow');
    });
});

describe('schemeOf / describeTab', () => {
    test('browser-internal and file schemes', () => {
        expect(schemeOf('chrome://settings/privacy')).toBe('chrome:');
        expect(schemeOf('file:///home/user/a.html')).toBe('file:');
        expect(schemeOf('chrome-extension://abcdefghijklmnop/popup.html')).toBe('chrome-extension:');
        expect(schemeOf('about:blank')).toBe('about:');
        expect(schemeOf('edge://settings')).toBe('edge:');
    });

    test('web store pages return the host; ordinary web pages return empty', () => {
        expect(schemeOf('https://chromewebstore.google.com/detail/x/abc')).toBe('chromewebstore.google.com');
        expect(schemeOf('https://chrome.google.com/webstore/detail/x')).toBe('chrome.google.com');
        expect(schemeOf('https://example.test/')).toBe('');
        expect(schemeOf('not a url')).toBe('');
        expect(schemeOf('')).toBe('');
    });

    test('describeTab never includes path, query or hash', () => {
        expect(describeTab('chrome://settings/privacy?x=1#y')).toBe('chrome://settings');
        expect(describeTab('file:///home/user/secret.html')).toBe('file://');
        expect(describeTab('https://chromewebstore.google.com/detail/x/abc?q=1')).toBe('chromewebstore.google.com');
        expect(describeTab('')).toBe('');
    });
});

/* ---------- renderUnsupported ---------- */

describe('renderUnsupported', () => {
    test('builds the contract hooks', () => {
        const { container } = mount();
        for (const sel of ['#unsupportedScheme', '#manualTargetInput', '#manualPreview', '#manualError', '#continueBtn']) {
            expect(container.querySelector(sel)).not.toBeNull();
        }
        expect(container.querySelector('#unsupportedScheme').textContent).toBe('chrome://settings');
        expect(container.textContent).toContain("This page can't be cleaned");
        expect(container.textContent).toContain('chrome://settings is not a web origin. The extension only works for http:// and https:// origins.');
    });

    test('never renders the tab path, query or hash', () => {
        const { container } = mount({ tabUrl: 'chrome://settings/privacy?token=abc#frag' });
        expect(container.textContent).not.toContain('privacy');
        expect(container.textContent).not.toContain('token');
    });

    test('protected web page uses the protected wording', () => {
        const { container } = mount({ tabUrl: 'https://chromewebstore.google.com/detail/x/abc' });
        expect(container.querySelector('#unsupportedScheme').textContent).toBe('chromewebstore.google.com');
        expect(container.textContent).toContain('is protected by Chrome');
    });

    test('starts empty: continue disabled, no preview, no error', () => {
        const { container, input } = mount();
        expect(container.querySelector('#continueBtn').disabled).toBe(true);
        expect(container.querySelector('#manualPreview').hidden).toBe(true);
        expect(container.querySelector('#manualError').hidden).toBe(true);
        expect(input.getAttribute('aria-invalid')).toBe('false');
        expect(input.focused).toBe(true);
    });

    test('valid input shows the normalized origin and notes, enables continue', () => {
        const { container, input } = mount();
        type(input, 'staging.app.example.test/login?next=%2F');
        const preview = container.querySelector('#manualPreview');
        expect(preview.hidden).toBe(false);
        expect(preview.textContent).toContain('Normalized to');
        expect(preview.textContent).toContain('https://staging.app.example.test');
        expect(preview.textContent).toContain('Path, query and hash are removed; default scheme https; port 443.');
        expect(container.querySelector('#continueBtn').disabled).toBe(false);
        expect(input.getAttribute('aria-invalid')).toBe('false');
        expect(input.getAttribute('aria-describedby')).toBe('manualPreview');
    });

    test('invalid input shows the error, keeps continue disabled', () => {
        const { container, continued, input } = mount();
        type(input, 'ftp://example.test');
        const error = container.querySelector('#manualError');
        expect(error.hidden).toBe(false);
        expect(error.textContent).toBe(normalizeTarget('ftp://example.test').error);
        expect(container.querySelector('#manualPreview').hidden).toBe(true);
        expect(container.querySelector('#continueBtn').disabled).toBe(true);
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.getAttribute('aria-describedby')).toBe('manualError');
        container.querySelector('#continueBtn').fire('click');
        input.fire('keydown', { key: 'Enter' });
        expect(continued).toEqual([]);
    });

    test('continue click and Enter call onContinue with the exact origin', () => {
        const { container, continued, input } = mount();
        type(input, 'http://localhost:5173/app?x=1');
        container.querySelector('#continueBtn').fire('click');
        input.fire('keydown', { key: 'Enter' });
        input.fire('keydown', { key: 'a' });
        expect(continued).toEqual(['http://localhost:5173', 'http://localhost:5173']);
    });

    test('recent origins: max 3, origins only, relative times, hidden when empty', () => {
        const { container } = mount({
            recentOrigins: [
                { origin: 'http://localhost:5173/some/path?q=1', at: NOW - 5 * 60000 },
                { origin: 'https://staging.app.example.test', at: NOW - 3600000 },
                { origin: 'https://staging.app.example.test', at: NOW - 3700000 },
                { origin: 'not an origin', at: NOW },
                { origin: 'http://127.0.0.1:8080', at: NOW - 26 * 3600000 },
                { origin: 'https://fourth.example.test', at: NOW - 99 * 3600000 }
            ]
        });
        const list = container.querySelector('#recentOrigins');
        const rows = list.querySelectorAll('button');
        expect(rows.length).toBe(MAX_RECENT_ORIGINS);
        expect(rows.map(r => r.getAttribute('data-origin'))).toEqual([
            'http://localhost:5173', 'https://staging.app.example.test', 'http://127.0.0.1:8080'
        ]);
        expect(rows[0].querySelector('.recent-origin').textContent).toBe('http://localhost:5173');
        expect(rows[0].querySelector('.recent-time').textContent).toBe('5 min ago');
        expect(rows[1].textContent).toContain('1 h ago');
        expect(rows[2].textContent).toContain('1 d ago');
        expect(container.textContent).not.toContain('/some/path');
        expect(container.textContent).toContain('Recent origins');

        const empty = mount();
        expect(empty.container.querySelector('#recentOrigins')).toBeNull();
        expect(empty.container.textContent).not.toContain('Recent origins');
    });

    test('clicking a recent row fills the input and enables continue without continuing', () => {
        const { container, continued, input } = mount({ recentOrigins: [{ origin: 'http://localhost:5173', at: NOW }] });
        container.querySelector('#recentOrigins button').fire('click');
        expect(input.value).toBe('http://localhost:5173');
        expect(container.querySelector('#continueBtn').disabled).toBe(false);
        expect(continued).toEqual([]);
        expect(container.querySelector('#recentOrigins button').textContent).toContain('just now');
    });

    test('re-rendering clears the container', () => {
        const { container } = mount();
        renderUnsupported(container, { tabUrl: 'file:///x', recentOrigins: [], now: NOW, getMessage, onContinue() {} });
        expect(container.querySelectorAll('#manualTargetInput').length).toBe(1);
        expect(container.querySelector('#unsupportedScheme').textContent).toBe('file://');
    });
});
