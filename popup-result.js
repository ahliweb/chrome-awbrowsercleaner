/**
 * AW Browser Cleaner - Popup screen 4: result and evidence
 *
 * Renders the outcome of a cleanup from a report built by report.js
 * (`buildReport`): banner, before/after table, copy/export actions and the
 * environment footer.
 *
 * Only counts, origins, error codes/messages and metadata are rendered. Cookie
 * values never appear in the DOM (the report never contains them and this
 * module reads a fixed set of fields). DOM is built with createElement and
 * textContent only (never innerHTML). No `downloads` permission is needed:
 * exports use a Blob object URL and a temporary `<a download>`.
 */

import { DATA_TYPES } from './cleanup-core.js';
import { summaryText, reportToJson, reportToMarkdown, reportFileName } from './report.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FEEDBACK_MS = 1600;
const MAX_ERRORS_SHOWN = 1;

/** i18n keys of the after-action sentences. */
const AFTER_KEYS = Object.freeze({
    none: 'resultAfterNone',
    reload: 'resultAfterReload',
    hard: 'resultAfterHard',
    start: 'resultAfterStart'
});

/**
 * Downloads text as a file without the `downloads` permission.
 *
 * @param {string} filename
 * @param {string} text
 * @param {string} [mime]
 * @returns {void}
 */
export function defaultDownload(filename, text, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Human-readable byte size ("512 B", "1.5 KB", "18.4 MB").
 *
 * @param {number} bytes
 * @param {string} [locale] - BCP 47 tag for the decimal separator.
 * @returns {string}
 */
export function formatBytes(bytes, locale) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
    }
    let text;
    try {
        text = new Intl.NumberFormat(locale, { maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value);
    } catch (e) {
        text = value.toFixed(value >= 100 ? 0 : 1);
    }
    return `${text} ${units[i]}`;
}

/**
 * Local time of the report in its time zone: "2026-10-23 10:42:18 GMT+7".
 *
 * @param {{generatedAt: string, timeZone?: string}} report
 * @returns {string}
 */
export function formatTimestamp(report) {
    const date = new Date(report.generatedAt);
    if (Number.isNaN(date.getTime())) return '';
    const parts = timeParts(date, report.timeZone) || timeParts(date, 'UTC');
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.zone}`;
}

/**
 * @param {Date} date
 * @param {string} [timeZone]
 * @returns {{year: string, month: string, day: string, hour: string, minute: string, second: string, zone: string}|null}
 */
function timeParts(date, timeZone) {
    try {
        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone, hourCycle: 'h23', timeZoneName: 'short',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const p = {};
        for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
        if (!p.year || !p.hour) return null;
        return {
            year: p.year, month: p.month, day: p.day,
            hour: p.hour === '24' ? '00' : p.hour, minute: p.minute, second: p.second,
            zone: p.timeZoneName || timeZone || 'UTC'
        };
    } catch (e) {
        return null;
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
 * Banner icon (check / warning / error) built with createElementNS.
 *
 * @param {Document} doc
 * @param {'success'|'warning'|'danger'} tone
 * @returns {SVGElement}
 */
function toneIcon(doc, tone) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    const attrs = {
        width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        'stroke-width': '2.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'
    };
    for (const [name, value] of Object.entries(attrs)) svg.setAttribute(name, value);
    const add = (tag, a) => {
        const node = doc.createElementNS(SVG_NS, tag);
        for (const [name, value] of Object.entries(a)) node.setAttribute(name, value);
        svg.append(node);
    };
    if (tone === 'success') {
        add('circle', { cx: '12', cy: '12', r: '10' });
        add('polyline', { points: '16 9 10.5 15 8 12.5' });
    } else if (tone === 'warning') {
        add('path', { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' });
        add('line', { x1: '12', y1: '9', x2: '12', y2: '13' });
        add('line', { x1: '12', y1: '17', x2: '12.01', y2: '17' });
    } else {
        add('circle', { cx: '12', cy: '12', r: '10' });
        add('line', { x1: '15', y1: '9', x2: '9', y2: '15' });
        add('line', { x1: '9', y1: '9', x2: '15', y2: '15' });
    }
    return svg;
}

/**
 * Banner tone: success, or warning when something failed, or danger when
 * every origin failed and nothing was measurably cleared.
 *
 * @param {Object} report
 * @returns {'success'|'warning'|'danger'}
 */
function bannerTone(report) {
    if (report.ok) return 'success';
    const perOrigin = Array.isArray(report.perOrigin) ? report.perOrigin : [];
    const anyProgress = perOrigin.some(entry => (entry.rows || []).some(r => r.status === 'cleared' || r.status === 'kept'));
    const allFailed = perOrigin.length > 0 && perOrigin.every(entry => (entry.errors || []).length > 0);
    return allFailed && !anyProgress ? 'danger' : 'warning';
}

/**
 * Cell class for the "after" value.
 *
 * @param {Object} row
 * @returns {'ok'|'warn'|'bad'|''}
 */
function afterTone(row) {
    if (row.after === null || row.after === undefined) return '';
    if (row.type === 'usage') return row.before !== null && row.after > row.before ? 'warn' : 'ok';
    if (row.status === 'kept') return 'warn';
    if (row.after === 0) return 'ok';
    if (row.status === 'cleared') return 'warn';
    return 'bad';
}

/**
 * @param {Object} row
 * @param {number|null|undefined} value
 * @param {string} [locale]
 * @returns {string}
 */
function cellText(row, value, locale) {
    if (value === null || value === undefined) return '–';
    return row.type === 'usage' ? formatBytes(value, locale) : String(value);
}

/**
 * @param {Object} report
 * @returns {Set<string>|null} Selected data types, or null when unknown.
 */
function selectedTypes(report) {
    return Array.isArray(report.dataTypes) ? new Set(report.dataTypes) : null;
}

/**
 * @param {Document} doc
 * @param {Object} entry - report.perOrigin[i]
 * @param {Object} ctx
 * @returns {{wrap: HTMLElement, footnote: HTMLElement|null}}
 */
function buildTable(doc, entry, ctx) {
    const { t, labels, selected, locale, isFirst } = ctx;
    const table = h(doc, 'table', {
        class: 'result-table',
        attrs: { 'data-origin': String(entry.origin || '') }
    });
    if (isFirst) table.setAttribute('id', 'resultTable');

    const head = h(doc, 'tr', {}, [
        h(doc, 'th', { class: 'col-type', text: t('resultColType'), attrs: { scope: 'col' } }),
        h(doc, 'th', { class: 'col-num', text: t('resultColBefore'), attrs: { scope: 'col' } }),
        h(doc, 'th', { class: 'col-num', text: t('resultColAfter'), attrs: { scope: 'col' } })
    ]);
    table.append(h(doc, 'thead', {}, [head]));

    const body = h(doc, 'tbody');
    const keptCookies = entry.cookies && Number.isFinite(entry.cookies.kept) ? entry.cookies.kept : 0;
    let footnote = null;

    for (const row of Array.isArray(entry.rows) ? entry.rows : []) {
        if (row.type !== 'usage' && selected && !selected.has(row.type)) continue;
        const isUsage = row.type === 'usage';
        const tone = afterTone(row);
        const showStar = row.type === 'cookies' && row.status === 'kept' && keptCookies > 0;

        const label = isUsage ? t('resultStorageUsage') : (labels[row.type] ? t(labels[row.type]) : String(row.type));
        const afterCell = h(doc, 'td', {
            class: `after num${tone ? ` tone-${tone}` : ''}`,
            text: cellText(row, row.after, locale) + (showStar ? '*' : '')
        });
        const tr = h(doc, 'tr', { class: isUsage ? 'row-usage' : '', attrs: { 'data-type': String(row.type), 'data-status': String(row.status || '') } }, [
            h(doc, 'th', { class: 'type', text: label, attrs: { scope: 'row' } }),
            h(doc, 'td', { class: 'before num', text: cellText(row, row.before, locale) }),
            afterCell
        ]);
        body.append(tr);

        if (showStar) {
            const domain = typeof entry.cookies.domain === 'string' && entry.cookies.domain ? entry.cookies.domain : '';
            footnote = h(doc, 'p', { class: 'result-footnote' });
            const one = keptCookies === 1;
            if (domain) {
                const msg = ctx.getMessage(one ? 'resultKeptCookiesOne' : 'resultKeptCookiesMany', [String(keptCookies), '']);
                const [before, after = ''] = msg.split('');
                footnote.append('* ' + before, h(doc, 'span', { class: 'mono', text: domain }), after);
            } else {
                footnote.textContent = '* ' + ctx.getMessage(one ? 'resultKeptCookiesNoDomainOne' : 'resultKeptCookiesNoDomainMany', [String(keptCookies)]);
            }
        }
    }
    table.append(body);
    return { wrap: h(doc, 'div', { class: 'result-table-wrap' }, [table]), footnote };
}

/**
 * Builds screen 4 into `container` (cleared first).
 *
 * @param {HTMLElement} container - The `#screenResult` section.
 * @param {Object} options
 * @param {Object} options.report - From `buildReport`. `perOrigin[i].cookies.domain` (optional)
 *   names the shared domain of kept cookies for the footnote.
 * @param {'none'|'reload'|'hard'|'start'} [options.afterAction] - Overrides `report.after.action` for the banner sentence.
 * @param {(key: string, subs?: string[]) => string} options.getMessage
 * @param {() => void} [options.onDone] - Called by `#resultDoneBtn`.
 * @param {{writeText: (text: string) => Promise<void>}} [options.clipboard]
 * @param {(filename: string, text: string, mime?: string) => void} [options.download]
 * @returns {{announce: (message: string) => void}}
 */
export function renderResult(container, {
    report, afterAction, getMessage, onDone, clipboard = globalThis.navigator?.clipboard, download = defaultDownload
}) {
    const doc = container.ownerDocument || globalThis.document;
    const t = (key, subs) => getMessage(key, subs);
    let locale;
    try {
        locale = globalThis.chrome?.i18n?.getUILanguage?.();
    } catch (e) {
        locale = undefined;
    }

    container.replaceChildren();
    container.classList.add('screen', 'screen-result');

    const perOrigin = Array.isArray(report.perOrigin) ? report.perOrigin : [];
    const origins = Array.isArray(report.origins) && report.origins.length ? report.origins : perOrigin.map(p => p.origin);
    const tone = bannerTone(report);

    // Head with Done
    const doneBtn = h(doc, 'button', { class: 'text-btn', text: t('resultDone'), attrs: { id: 'resultDoneBtn', type: 'button' } });
    doneBtn.addEventListener('click', () => {
        if (typeof onDone === 'function') onDone();
    });
    const head = h(doc, 'div', { class: 'screen-head' }, [
        h(doc, 'h2', { class: 'screen-title', text: t('resultTitle') }),
        doneBtn
    ]);

    // Banner
    const duration = Number.isFinite(report.durationMs) ? report.durationMs : 0;
    const title = tone === 'success' ? t('resultCleanedIn', [String(duration)]) : t('resultCleanedWithErrors');
    const requested = afterAction ?? (report.after && report.after.action);
    const afterKey = AFTER_KEYS[requested] || AFTER_KEYS.none;
    const afterFailed = Boolean(report.after) && report.after.ok === false;
    const sentences = [];
    if (tone !== 'danger' && !afterFailed) sentences.push(t(afterKey));
    const count = origins.length;
    if (count > 0) sentences.push(count === 1 ? t('resultOriginsOne') : t('resultOriginsMany', [String(count)]));
    const bannerText = h(doc, 'div', { class: 'banner-text' }, [
        h(doc, 'div', { class: 'banner-title', text: title }),
        h(doc, 'div', { class: 'banner-detail', text: sentences.join(' ') })
    ]);
    if (tone !== 'success') {
        const errors = Array.isArray(report.errors) ? report.errors : [];
        for (const err of errors.slice(0, MAX_ERRORS_SHOWN)) {
            bannerText.append(h(doc, 'div', { class: 'banner-error' }, [
                h(doc, 'span', { class: 'mono banner-error-code', text: String(err.code || 'ERROR') }),
                ` ${String(err.message || '')}`
            ]));
        }
        if (errors.length > MAX_ERRORS_SHOWN) {
            bannerText.append(h(doc, 'div', { class: 'banner-more', text: t('resultMoreErrors', [String(errors.length - MAX_ERRORS_SHOWN)]) }));
        }
    }
    const banner = h(doc, 'div', {
        class: 'result-banner',
        attrs: { id: 'resultBanner', 'data-tone': tone, role: tone === 'success' ? 'status' : 'alert' }
    }, [toneIcon(doc, tone), bannerText]);

    const body = h(doc, 'div', { class: 'screen-body result-body' }, [banner]);

    // Tables
    const labels = Object.fromEntries(DATA_TYPES.map(def => [def.key, def.labelKey]));
    const selected = selectedTypes(report);
    const multi = perOrigin.length > 1;
    if (!multi) {
        body.append(h(doc, 'div', { class: 'result-origin mono', text: origins.join(', ') }));
    }
    perOrigin.forEach((entry, index) => {
        const { wrap, footnote } = buildTable(doc, entry, { t, getMessage, labels, selected, locale, isFirst: index === 0 });
        if (multi) {
            const section = h(doc, 'section', { class: 'result-origin-block' }, [
                h(doc, 'h3', { class: 'result-origin mono', text: String(entry.origin || '') }),
                wrap
            ]);
            if (footnote) section.append(footnote);
            body.append(section);
        } else {
            body.append(wrap);
            if (footnote) body.append(footnote);
        }
    });

    // Actions
    const live = h(doc, 'div', { class: 'sr-only', attrs: { id: 'resultLive', 'aria-live': 'polite', role: 'status' } });
    const copyBtn = h(doc, 'button', { class: 'btn btn-secondary', text: t('resultCopySummary'), attrs: { id: 'copySummaryBtn', type: 'button' } });
    const jsonBtn = h(doc, 'button', { class: 'btn btn-secondary', text: t('resultExportJson'), attrs: { id: 'exportJsonBtn', type: 'button' } });
    const mdBtn = h(doc, 'button', { class: 'btn btn-secondary', text: t('resultExportMd'), attrs: { id: 'exportMdBtn', type: 'button' } });

    const announce = message => {
        live.textContent = message;
    };
    let copyTimer = null;
    const flashCopy = message => {
        copyBtn.textContent = message;
        announce(message);
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
            copyBtn.textContent = t('resultCopySummary');
            copyTimer = null;
        }, FEEDBACK_MS);
        if (copyTimer && typeof copyTimer.unref === 'function') copyTimer.unref();
    };

    copyBtn.addEventListener('click', async () => {
        try {
            await clipboard.writeText(summaryText(report));
            flashCopy(t('resultCopied'));
        } catch (e) {
            flashCopy(t('resultCopyFailed'));
        }
    });

    const exportAs = (ext, mime, serialize) => () => {
        try {
            const filename = reportFileName(report, ext);
            download(filename, serialize(report), mime);
            announce(t('resultExported', [filename]));
        } catch (e) {
            announce(t('resultExportFailed'));
        }
    };
    jsonBtn.addEventListener('click', exportAs('json', 'application/json;charset=utf-8', reportToJson));
    mdBtn.addEventListener('click', exportAs('md', 'text/markdown;charset=utf-8', reportToMarkdown));

    const chromeVersion = report.browser && report.browser.chromeVersion ? String(report.browser.chromeVersion) : '';
    const extVersion = report.extension && report.extension.version ? String(report.extension.version) : '';
    const meta = [formatTimestamp(report)];
    if (chromeVersion) meta.push(`Chrome ${chromeVersion.split('.')[0]}`);
    if (extVersion) meta.push(`v${extVersion}`);
    const metaEl = h(doc, 'div', { class: 'result-meta mono', text: meta.filter(Boolean).join(' · ') });
    if (chromeVersion) metaEl.setAttribute('title', `Chrome ${chromeVersion}`);

    const footer = h(doc, 'div', { class: 'screen-footer' }, [
        h(doc, 'div', { class: 'result-actions' }, [copyBtn, jsonBtn, mdBtn]),
        metaEl,
        live
    ]);

    container.append(head, body, footer);
    return { announce };
}
