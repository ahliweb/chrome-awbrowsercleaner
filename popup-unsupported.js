/**
 * AW Browser Cleaner - Popup screen 5: unsupported page
 *
 * Shown when the active tab is not an http(s) page. Offers a manual target
 * input with a live normalization preview and the most recent origins.
 *
 * The pure helpers (`normalizationPreview`, `relativeTime`, `schemeOf`,
 * `describeTab`) have no DOM dependency. `renderUnsupported` builds the screen
 * with createElement/textContent only (never innerHTML).
 */

import { normalizeTarget, VALID_SCHEMES } from './origin-utils.js';

/** Maximum number of recent origins listed. */
export const MAX_RECENT_ORIGINS = 3;

const DEFAULT_PORTS = Object.freeze({ 'http:': '80', 'https:': '443' });
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Hosts of Chrome Web Store pages, where extensions cannot run. */
const WEB_STORE_HOSTS = Object.freeze(['chromewebstore.google.com', 'chrome.google.com']);

/**
 * @typedef {Object} NormalizationPreview
 * @property {boolean} show - True when the input differs from the normalized origin.
 * @property {boolean} valid - Whether the input normalizes to a valid origin.
 * @property {string} origin - Equals `normalizeTarget(input).origin`.
 * @property {string} error - Error from `normalizeTarget` (empty for empty input or success).
 * @property {string[]} notes - i18n keys: previewNotePathDropped, previewNoteDefaultScheme, previewNoteDefaultPort.
 * @property {string} [scheme] - Substitution for previewNoteDefaultScheme (e.g. "https").
 * @property {string} [port] - Substitution for previewNoteDefaultPort (e.g. "443").
 */

/**
 * Describes how a user-typed target becomes an exact origin.
 *
 * @param {string} input - Raw input.
 * @returns {NormalizationPreview}
 */
export function normalizationPreview(input) {
    const raw = typeof input === 'string' ? input : '';
    const trimmed = raw.trim();
    const result = normalizeTarget(raw);
    if (!trimmed) {
        return { show: false, valid: false, origin: '', error: '', notes: [] };
    }
    if (!result.valid) {
        return { show: false, valid: false, origin: '', error: result.error, notes: [] };
    }

    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
    const urlString = hasScheme ? trimmed : `https://${trimmed}`;
    const notes = [];
    const out = { show: trimmed !== result.origin, valid: true, origin: result.origin, error: '', notes };

    try {
        const url = new URL(urlString);
        if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
            notes.push('previewNotePathDropped');
        }
        if (!hasScheme) {
            notes.push('previewNoteDefaultScheme');
            out.scheme = 'https';
        }
        const authority = urlString.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/^.*@/, '');
        if (!/:\d+$/.test(authority)) {
            notes.push('previewNoteDefaultPort');
            out.port = DEFAULT_PORTS[url.protocol] || '';
        }
    } catch (e) {
        // normalizeTarget accepted it, so this is unreachable; keep the origin only
    }
    return out;
}

/**
 * Buckets a past timestamp into a coarse relative-time message.
 *
 * @param {number|string|Date} at - Epoch ms, ISO string or Date.
 * @param {number} [now] - Epoch ms.
 * @returns {{key: string, value: number}} i18n key (relTimeJustNow / relTimeMinutes / relTimeHours / relTimeDays) and the `$1` value.
 */
export function relativeTime(at, now = Date.now()) {
    const time = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : Number(at);
    const diff = Number.isFinite(time) ? now - time : 0;
    const minutes = Math.floor(diff / 60000);
    if (!(minutes >= 1)) return { key: 'relTimeJustNow', value: 0 };
    if (minutes < 60) return { key: 'relTimeMinutes', value: minutes };
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return { key: 'relTimeHours', value: hours };
    return { key: 'relTimeDays', value: Math.floor(hours / 24) };
}

/**
 * Scheme of a page the extension cannot clean.
 *
 * @param {string} url
 * @returns {string} e.g. "chrome:", "file:", "chrome-extension:"; the host for
 *   Chrome Web Store pages; empty when the URL cannot be parsed.
 */
export function schemeOf(url) {
    try {
        const parsed = new URL(String(url));
        if (VALID_SCHEMES.has(parsed.protocol)) {
            return WEB_STORE_HOSTS.includes(parsed.hostname) ? parsed.hostname : '';
        }
        return parsed.protocol;
    } catch (e) {
        return '';
    }
}

/**
 * Short, path-free label of an unsupported tab, e.g. "chrome://settings",
 * "file://", "chromewebstore.google.com". Never includes path, query or hash.
 *
 * @param {string} url
 * @returns {string} Empty when the URL cannot be parsed.
 */
export function describeTab(url) {
    const scheme = schemeOf(url);
    if (!scheme) return '';
    if (!scheme.endsWith(':')) return scheme;
    try {
        const parsed = new URL(String(url));
        return `${scheme}//${parsed.host}`;
    } catch (e) {
        return scheme;
    }
}

/**
 * @param {Document} doc
 * @param {string} tag
 * @param {{class?: string, text?: string, attrs?: Record<string, string>}} [opts]
 * @param {Array<Node|string>} [children]
 * @returns {HTMLElement}
 */
function h(doc, tag, opts = {}, children = []) {
    const node = doc.createElement(tag);
    if (opts.class) node.className = opts.class;
    if (opts.text !== undefined) node.textContent = opts.text;
    for (const [name, value] of Object.entries(opts.attrs || {})) node.setAttribute(name, value);
    for (const child of children) node.append(child);
    return node;
}

/**
 * "No entry" icon built with createElementNS.
 *
 * @param {Document} doc
 * @returns {SVGElement}
 */
function blockedIcon(doc) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    const attrs = {
        width: '20', height: '20', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'
    };
    for (const [name, value] of Object.entries(attrs)) svg.setAttribute(name, value);
    const circle = doc.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '10');
    const line = doc.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', '4.93');
    line.setAttribute('y1', '4.93');
    line.setAttribute('x2', '19.07');
    line.setAttribute('y2', '19.07');
    svg.append(circle, line);
    return svg;
}

/**
 * Fills `parent` with a localized sentence whose placeholders ($1..$n) are
 * replaced by DOM nodes (used for inline monospace fragments).
 *
 * @param {Document} doc
 * @param {HTMLElement} parent
 * @param {(key: string, subs?: string[]) => string} getMessage
 * @param {string} key
 * @param {Array<Node|string>} slots
 * @returns {void}
 */
function fillTemplate(doc, parent, getMessage, key, slots) {
    const markers = slots.map((_, i) => String.fromCharCode(0xE000 + i));
    const message = getMessage(key, markers);
    const pattern = new RegExp(`([${markers.join('')}])`);
    for (const part of String(message).split(pattern)) {
        if (!part) continue;
        const index = markers.indexOf(part);
        parent.append(index >= 0 ? slots[index] : part);
    }
}

/**
 * @param {string} text
 * @returns {string}
 */
function capitalize(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * Joins the preview notes into one sentence, e.g.
 * "Path, query and hash are removed; default scheme https; port 443."
 *
 * @param {NormalizationPreview} preview
 * @param {(key: string, subs?: string[]) => string} getMessage
 * @returns {string} Empty when there is nothing to say.
 */
function notesText(preview, getMessage) {
    const parts = preview.notes.map(key => {
        if (key === 'previewNoteDefaultScheme') return getMessage(key, [preview.scheme || 'https']);
        if (key === 'previewNoteDefaultPort') return getMessage(key, [preview.port || '']);
        return getMessage(key);
    });
    return parts.length ? `${capitalize(parts.join('; '))}.` : '';
}

/**
 * Builds screen 5 into `container` (cleared first).
 *
 * @param {HTMLElement} container - The `#screenUnsupported` section.
 * @param {Object} options
 * @param {string} [options.tabUrl] - URL of the unsupported tab (only its scheme/host is shown).
 * @param {Array<{origin: string, at: number|string}>} [options.recentOrigins] - Most recent first; only origins are shown (max 3).
 * @param {number} [options.now] - Epoch ms used for relative times.
 * @param {(key: string, subs?: string[]) => string} options.getMessage
 * @param {(origin: string) => void} options.onContinue - Called with the exact normalized origin.
 * @returns {{input: HTMLInputElement, getOrigin: () => string, setValue: (value: string) => void}}
 */
export function renderUnsupported(container, { tabUrl = '', recentOrigins = [], now = Date.now(), getMessage, onContinue }) {
    const doc = container.ownerDocument || globalThis.document;
    const t = (key, subs) => getMessage(key, subs);
    const mono = text => h(doc, 'span', { class: 'mono', text });

    container.replaceChildren();
    container.classList.add('screen', 'screen-unsupported');

    // Explanation
    const tabLabel = describeTab(tabUrl);
    const scheme = schemeOf(tabUrl);
    const protectedPage = Boolean(scheme) && !scheme.endsWith(':');
    const schemeSpan = h(doc, 'span', { class: 'mono', text: tabLabel || t('unsupportedUnknownPage'), attrs: { id: 'unsupportedScheme' } });
    const text = h(doc, 'p', { class: 'unsupported-text' });
    fillTemplate(doc, text, getMessage, protectedPage ? 'unsupportedBodyProtected' : 'unsupportedBody', [
        schemeSpan, mono('http://'), mono('https://')
    ]);
    const hero = h(doc, 'div', { class: 'unsupported-hero' }, [
        h(doc, 'div', { class: 'unsupported-icon' }, [blockedIcon(doc)]),
        h(doc, 'h2', { class: 'unsupported-title', text: t('unsupportedTitle') }),
        text
    ]);

    // Manual target
    const input = h(doc, 'input', {
        class: 'text-input',
        attrs: {
            id: 'manualTargetInput', type: 'text', spellcheck: 'false', autocomplete: 'off',
            placeholder: 'https://example.com', 'aria-invalid': 'false'
        }
    });
    const errorEl = h(doc, 'div', { class: 'manual-error', attrs: { id: 'manualError' } });
    errorEl.hidden = true;
    const previewOrigin = h(doc, 'div', { class: 'preview-origin mono' });
    const previewNotes = h(doc, 'div', { class: 'preview-notes' });
    const preview = h(doc, 'div', { class: 'manual-preview', attrs: { id: 'manualPreview', 'aria-live': 'polite' } }, [
        h(doc, 'div', { class: 'preview-label', text: t('unsupportedPreviewLabel') }),
        previewOrigin,
        previewNotes
    ]);
    preview.hidden = true;
    const field = h(doc, 'div', { class: 'field' }, [
        h(doc, 'label', { class: 'field-label', text: t('unsupportedManualLabel'), attrs: { for: 'manualTargetInput' } }),
        input, errorEl, preview
    ]);

    // Continue
    const continueBtn = h(doc, 'button', {
        class: 'btn btn-primary', text: t('unsupportedContinueBtn'), attrs: { id: 'continueBtn', type: 'button' }
    });
    continueBtn.disabled = true;

    let currentOrigin = '';

    const update = () => {
        const state = normalizationPreview(input.value);
        currentOrigin = state.valid ? state.origin : '';
        continueBtn.disabled = !state.valid;

        preview.hidden = !state.valid;
        if (state.valid) {
            previewOrigin.textContent = state.origin;
            const notes = notesText(state, getMessage);
            previewNotes.textContent = notes;
            previewNotes.hidden = !notes;
        }

        const hasError = Boolean(state.error);
        errorEl.hidden = !hasError;
        errorEl.textContent = hasError ? state.error : '';
        input.setAttribute('aria-invalid', hasError ? 'true' : 'false');
        if (hasError) input.setAttribute('aria-describedby', 'manualError');
        else if (state.valid) input.setAttribute('aria-describedby', 'manualPreview');
        else input.removeAttribute('aria-describedby');
    };

    const submit = () => {
        update();
        if (currentOrigin && typeof onContinue === 'function') onContinue(currentOrigin);
    };

    input.addEventListener('input', update);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            submit();
        }
    });
    continueBtn.addEventListener('click', submit);

    const setValue = value => {
        input.value = value;
        update();
    };

    const body = h(doc, 'div', { class: 'screen-body unsupported-body' }, [hero, field]);

    // Recent origins (origins only, never paths)
    const seen = new Set();
    const rows = [];
    for (const entry of Array.isArray(recentOrigins) ? recentOrigins : []) {
        const normalized = normalizeTarget(entry && entry.origin);
        if (!normalized.valid || seen.has(normalized.origin)) continue;
        seen.add(normalized.origin);
        rows.push({ origin: normalized.origin, at: entry.at });
        if (rows.length === MAX_RECENT_ORIGINS) break;
    }
    if (rows.length) {
        const list = h(doc, 'ul', { class: 'recent-list', attrs: { id: 'recentOrigins' } });
        for (const row of rows) {
            const rel = relativeTime(row.at, now);
            const label = rel.key === 'relTimeJustNow' ? t(rel.key) : t(rel.key, [String(rel.value)]);
            const button = h(doc, 'button', { class: 'recent-row', attrs: { type: 'button', 'data-origin': row.origin } }, [
                h(doc, 'span', { class: 'recent-origin mono', text: row.origin }),
                h(doc, 'span', { class: 'recent-time', text: label })
            ]);
            button.addEventListener('click', () => {
                setValue(row.origin);
                if (typeof input.focus === 'function') input.focus();
            });
            list.append(h(doc, 'li', {}, [button]));
        }
        body.append(h(doc, 'div', { class: 'field recent' }, [
            h(doc, 'div', { class: 'field-label', text: t('unsupportedRecentLabel') }),
            list
        ]));
    }

    container.append(body, h(doc, 'div', { class: 'screen-footer' }, [continueBtn]));
    update();
    if (typeof input.focus === 'function') input.focus();

    return { input, getOrigin: () => currentOrigin, setValue };
}
