/**
 * AW Browser Cleaner - Evidence Report
 *
 * Snapshot diffing and report generation (JSON / Markdown / clipboard text).
 * Pure module: no Chrome API or DOM dependency.
 *
 * Reports contain only counts and metadata. Cookie values and storage
 * contents are never read, stored or exported.
 */

import { DATA_TYPE_KEYS } from './cleanup-core.js';

/** Format identifier of exported reports. */
export const REPORT_FORMAT = 'aw-browser-cleaner-report';

/** Version of the report format. */
export const REPORT_VERSION = 1;

/** Keys that must never appear anywhere in a report. */
export const FORBIDDEN_REPORT_KEYS = Object.freeze(['value', 'cookieValue', 'storageValue', 'items', 'entries']);

const MAX_MESSAGE_LENGTH = 300;

/**
 * Per-origin snapshot. Every field is a number, or null when not measurable
 * (`cache` is always null; `persisted` is a boolean or null).
 * @typedef {Object} Snapshot
 * @property {number|null} cookies
 * @property {number|null} sessionStorage
 * @property {number|null} localStorage
 * @property {number|null} indexedDB
 * @property {number|null} fileSystems
 * @property {number|null} cache
 * @property {number|null} cacheStorage
 * @property {number|null} serviceWorkers
 * @property {number|null} usage - Bytes.
 * @property {number|null} quota - Bytes.
 * @property {boolean|number|null} persisted
 */

/**
 * @typedef {Object} DiffRow
 * @property {string} type - A data type key or 'usage'.
 * @property {number|null} before
 * @property {number|null} after
 * @property {'cleared'|'kept'|'unchanged'|'unknown'} status
 * @property {string} [note] - 'notMeasurable' | 'partial' | 'increased' | 'keptCookies'
 */

/**
 * @param {unknown} v
 * @returns {number|null}
 */
function count(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Compares two snapshots of one origin.
 *
 * @param {Partial<Snapshot>|null} before
 * @param {Partial<Snapshot>|null} after
 * @param {{keptCookies?: number}} [opts]
 * @returns {DiffRow[]} One row per data type plus a trailing 'usage' row.
 */
export function diffSnapshots(before, after, { keptCookies = 0 } = {}) {
    const rows = [];
    for (const type of [...DATA_TYPE_KEYS, 'usage']) {
        const b = count(before?.[type]);
        const a = count(after?.[type]);
        /** @type {DiffRow} */
        const row = { type, before: b, after: a, status: 'unknown' };
        if (b === null || a === null) {
            row.note = 'notMeasurable';
        } else if (a === b) {
            row.status = 'unchanged';
        } else if (a > b) {
            row.status = 'unchanged';
            row.note = 'increased';
        } else if (a === 0) {
            row.status = 'cleared';
        } else if (type === 'cookies' && keptCookies > 0) {
            row.status = 'kept';
            row.note = 'keptCookies';
        } else {
            row.status = 'cleared';
            row.note = 'partial';
        }
        rows.push(row);
    }
    return rows;
}

/**
 * @param {unknown} msg
 * @returns {string}
 */
function shortText(msg) {
    return String(msg ?? '').slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * @param {unknown} err
 * @param {string} [origin]
 * @returns {{origin?: string, type?: string, code: string, message: string}}
 */
function cleanError(err, origin) {
    const out = {};
    if (origin) out.origin = origin;
    if (err && typeof err === 'object' && err.type) out.type = shortText(err.type);
    out.code = shortText(err && typeof err === 'object' && err.code ? err.code : 'ERROR');
    out.message = shortText(err && typeof err === 'object' ? err.message : err);
    return out;
}

/**
 * Builds the evidence report object.
 *
 * `before` and `after` are maps of origin to {@link Snapshot} (a missing origin
 * means "not measured"). `result` is the object returned by `executePlan`.
 *
 * @param {Object} input
 * @param {Object} input.plan
 * @param {Object} [input.description] - Output of `describePlan`.
 * @param {Record<string, Partial<Snapshot>|null>} [input.before]
 * @param {Record<string, Partial<Snapshot>|null>} [input.after]
 * @param {Object} input.result
 * @param {{extensionVersion: string, chromeVersion: string, userAgent?: string, timeZone?: string, now?: number|Date}} input.env
 * @returns {Object} Report.
 */
export function buildReport({ plan, description, before = {}, after = {}, result, env = {} }) {
    const generatedAt = new Date(env.now ?? Date.now()).toISOString();
    const perOriginResults = Array.isArray(result?.perOrigin) ? result.perOrigin : [];
    const errors = [];

    const perOrigin = (plan.origins || []).map(origin => {
        const res = perOriginResults.find(r => r.origin === origin) || {};
        const cookies = res.cookies
            ? { removed: count(res.cookies.removed) ?? 0, kept: count(res.cookies.kept) ?? 0, failed: count(res.cookies.failed) ?? 0 }
            : null;
        const originErrors = (res.errors || []).map(e => cleanError(e));
        for (const e of originErrors) errors.push({ origin, ...e });
        return {
            origin,
            rows: diffSnapshots(before?.[origin], after?.[origin], { keptCookies: cookies ? cookies.kept : 0 }),
            cookies,
            errors: originErrors
        };
    });

    const afterResult = result?.after;
    const afterInfo = { action: afterResult?.action ?? plan.after ?? 'none', ok: afterResult ? afterResult.ok !== false : null };
    if (afterResult && afterResult.ok === false && afterResult.error) {
        afterInfo.error = shortText(afterResult.error.message ?? afterResult.error);
        errors.push({ type: 'after', code: 'AFTER_ACTION_FAILED', message: afterInfo.error });
    }

    const browser = { chromeVersion: env.chromeVersion ?? null };
    if (env.userAgent) browser.userAgent = shortText(env.userAgent);

    const report = {
        format: REPORT_FORMAT,
        version: REPORT_VERSION,
        generatedAt,
        timeZone: env.timeZone ?? 'UTC',
        extension: { version: env.extensionVersion ?? null },
        browser,
        ok: result ? result.ok !== false && errors.length === 0 : false,
        origins: [...(plan.origins || [])],
        preset: description?.preset ?? plan.presetId ?? 'custom',
        scope: description?.scope ?? (plan.cookieMode === 'domainWide' ? 'wide' : 'exact'),
        dataTypes: [...(plan.dataTypes || [])],
        cookieMode: plan.cookieMode ?? 'exact',
        since: plan.since ?? 0,
        after: afterInfo,
        durationMs: count(result?.durationMs) ?? 0,
        perOrigin,
        errors
    };
    assertNoSensitiveValues(report);
    return report;
}

/**
 * Throws when an object contains a forbidden key (cookie value, storage
 * contents...) at any depth.
 *
 * @param {unknown} obj
 * @returns {void}
 * @throws {Error}
 */
export function assertNoSensitiveValues(obj) {
    const walk = (node, path, depth) => {
        if (node === null || typeof node !== 'object') return;
        if (depth > 20) throw new Error(`Report nesting too deep at ${path}`);
        if (Array.isArray(node)) {
            node.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
            return;
        }
        for (const [key, child] of Object.entries(node)) {
            if (FORBIDDEN_REPORT_KEYS.includes(key)) {
                throw new Error(`Sensitive key "${key}" is not allowed in reports (at ${path || '$'}).`);
            }
            walk(child, path ? `${path}.${key}` : key, depth + 1);
        }
    };
    walk(obj, '', 0);
}

/**
 * Pretty JSON (2 spaces).
 *
 * @param {Object} report
 * @returns {string}
 */
export function reportToJson(report) {
    assertNoSensitiveValues(report);
    return JSON.stringify(report, null, 2);
}

const TYPE_LABELS = Object.freeze({
    cookies: 'Cookies',
    sessionStorage: 'Session Storage',
    localStorage: 'Local Storage',
    indexedDB: 'IndexedDB',
    fileSystems: 'File System (OPFS)',
    cache: 'HTTP cache',
    cacheStorage: 'Cache Storage',
    serviceWorkers: 'Service Workers',
    usage: 'Storage usage'
});

const STATUS_LABELS = Object.freeze({
    cleared: 'cleared',
    kept: 'kept',
    unchanged: 'unchanged',
    unknown: 'not measurable'
});

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

/**
 * @param {string} type
 * @param {number|null} v
 * @returns {string}
 */
function formatCell(type, v) {
    if (v === null || v === undefined) return '\u2013';
    return type === 'usage' ? formatBytes(v) : String(v);
}

/**
 * @param {string} text
 * @returns {string}
 */
function mdEscape(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

/**
 * Local date parts of an instant in a time zone (UTC when Intl or the zone
 * is unavailable).
 *
 * @param {Date} date
 * @param {string} [timeZone]
 * @returns {{year: string, month: string, day: string, hour: string, minute: string, second: string, timeZone: string}}
 */
function localParts(date, timeZone) {
    const utc = () => {
        const iso = date.toISOString();
        return {
            year: iso.slice(0, 4), month: iso.slice(5, 7), day: iso.slice(8, 10),
            hour: iso.slice(11, 13), minute: iso.slice(14, 16), second: iso.slice(17, 19),
            timeZone: 'UTC'
        };
    };
    try {
        if (typeof Intl === 'undefined' || !timeZone) return utc();
        const fmt = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const parts = {};
        for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
        if (!parts.year || !parts.hour) return utc();
        return {
            year: parts.year, month: parts.month, day: parts.day,
            hour: parts.hour === '24' ? '00' : parts.hour, minute: parts.minute, second: parts.second,
            timeZone
        };
    } catch (e) {
        return utc();
    }
}

/**
 * @param {Object} report
 * @returns {string} e.g. "2026-01-31 14:05:09"
 */
function localTimestamp(report) {
    const p = localParts(new Date(report.generatedAt), report.timeZone);
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Human-readable Markdown evidence report (English).
 *
 * @param {Object} report
 * @returns {string}
 */
export function reportToMarkdown(report) {
    assertNoSensitiveValues(report);
    const lines = [];
    lines.push('# AW Browser Cleaner report', '');
    lines.push(`**Result:** ${report.ok ? 'completed' : 'completed with errors'}`, '');
    lines.push('| Field | Value |', '| --- | --- |');
    lines.push(`| Origins | ${mdEscape(report.origins.join(', '))} |`);
    lines.push(`| Preset | ${mdEscape(report.preset)} |`);
    lines.push(`| Data types | ${mdEscape(report.dataTypes.join(', '))} |`);
    lines.push(`| Cookie mode | ${mdEscape(report.cookieMode)} |`);
    lines.push(`| Since | ${report.since ? mdEscape(new Date(report.since).toISOString()) : 'all time'} |`);
    lines.push(`| After action | ${mdEscape(report.after?.action ?? 'none')} |`);
    lines.push(`| Duration | ${report.durationMs} ms |`, '');

    for (const entry of report.perOrigin) {
        lines.push(`## ${mdEscape(entry.origin)}`, '');
        lines.push('| Type | Before | After | Status |', '| --- | ---: | ---: | --- |');
        for (const row of entry.rows) {
            lines.push(`| ${TYPE_LABELS[row.type] || mdEscape(row.type)} | ${formatCell(row.type, row.before)} | ${formatCell(row.type, row.after)} | ${STATUS_LABELS[row.status] || row.status} |`);
        }
        lines.push('');
        if (entry.cookies) {
            lines.push(`Cookies: ${entry.cookies.removed} removed, ${entry.cookies.kept} kept, ${entry.cookies.failed} failed.`, '');
        }
    }

    lines.push('## Errors', '');
    if (report.errors.length === 0) {
        lines.push('None.', '');
    } else {
        for (const e of report.errors) {
            const where = [e.origin, e.type].filter(Boolean).join(' / ');
            lines.push(`- ${where ? `${mdEscape(where)}: ` : ''}${mdEscape(e.code)} - ${mdEscape(e.message)}`);
        }
        lines.push('');
    }

    lines.push('---', '');
    lines.push(`Generated ${localTimestamp(report)} (${mdEscape(report.timeZone)}) | Chrome ${mdEscape(report.browser?.chromeVersion ?? 'unknown')} | AW Browser Cleaner ${mdEscape(report.extension?.version ?? 'unknown')}`);
    lines.push('', 'This report contains counts and metadata only. No cookie values or storage contents are included.', '');
    return lines.join('\n');
}

/**
 * Short multi-line text for the clipboard.
 *
 * @param {Object} report
 * @returns {string}
 */
export function summaryText(report) {
    const lines = [`AW Browser Cleaner - ${report.ok ? 'done' : 'done with errors'}`];
    lines.push(`Origins: ${report.origins.join(', ')}`);
    lines.push(`Preset: ${report.preset} | After: ${report.after?.action ?? 'none'}`);
    for (const entry of report.perOrigin) {
        const parts = entry.rows
            .filter(r => r.type !== 'usage' && r.status !== 'unknown')
            .map(r => `${r.type} ${r.before}\u2192${r.after}`);
        lines.push(`${entry.origin}: ${parts.length ? parts.join(', ') : 'no measurable data'}`);
    }
    if (report.errors.length) lines.push(`Errors: ${report.errors.length}`);
    lines.push(`${localTimestamp(report)} (${report.timeZone}) | ${report.durationMs} ms`);
    return lines.join('\n');
}

/**
 * Safe file name for an exported report.
 *
 * @param {Object} report
 * @param {string} ext - File extension without dot (e.g. "json").
 * @returns {string} `aw-cleaner-<host>-<YYYYMMDD-HHmmss>.<ext>`
 */
export function reportFileName(report, ext) {
    let host = 'unknown';
    try {
        const url = new URL(report.origins[0]);
        host = url.hostname.replace(/^\[|\]$/g, '').replace(/:/g, '-');
        if (url.port) host += `-${url.port}`;
    } catch (e) {
        // keep fallback
    }
    host = host.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase() || 'unknown';
    const p = localParts(new Date(report.generatedAt), report.timeZone);
    const stamp = `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
    const safeExt = String(ext || 'json').replace(/[^a-zA-Z0-9]/g, '') || 'json';
    return `aw-cleaner-${host}-${stamp}.${safeExt}`;
}

/**
 * Compact, value-free history record for a report.
 *
 * @param {Object} report
 * @returns {{id: string, at: string, origins: string[], presetId: string, durationMs: number, ok: boolean}}
 */
export function historyEntry(report) {
    const seed = `${report.origins.join(',')}|${report.preset}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) >>> 0;
    }
    return {
        id: `${Date.parse(report.generatedAt).toString(36)}-${hash.toString(36)}`,
        at: report.generatedAt,
        origins: [...report.origins],
        presetId: report.preset,
        durationMs: report.durationMs,
        ok: report.ok
    };
}
