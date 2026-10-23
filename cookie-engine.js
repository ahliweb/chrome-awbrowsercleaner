/**
 * AW Browser Cleaner - Cookie Engine
 *
 * Pure helpers for Exact Cookie Mode. No Chrome API or DOM dependency.
 * See docs/architecture.md ("Exact Cookie Mode").
 *
 * Notes:
 * - Cookies do not isolate by port (RFC 6265 section 8.5), so a cookie that
 *   applies to https://app.test:8443 also applies to https://app.test.
 * - The cookie path is ignored: a cookie scoped to /admin still belongs to the
 *   origin and is a removal candidate.
 * - Cookie values are never copied into the results of this module.
 */

/**
 * Redacted cookie metadata. Never includes the cookie value.
 * @typedef {Object} CookieMeta
 * @property {string} id - Stable identifier from cookieId().
 * @property {string} name
 * @property {string} domain
 * @property {string} path
 * @property {boolean} hostOnly
 * @property {boolean} secure
 * @property {boolean} httpOnly
 * @property {string} sameSite
 * @property {boolean} session
 * @property {number|null} expirationDate
 * @property {string} storeId
 * @property {{topLevelSite: string, hasCrossSiteAncestor: boolean}|null} partitionKey
 */

/**
 * Result of classifying cookies for an origin.
 * @typedef {Object} CookieClassification
 * @property {Array<CookieMeta>} hostOnly - Host-only cookies of the exact host (removed by default).
 * @property {Array<CookieMeta>} partitioned - CHIPS cookies partitioned under the target's site (removed by default).
 * @property {Array<CookieMeta>} shared - Domain cookies shared with other subdomains (kept unless selected).
 * @property {Array<CookieMeta & {reason: string}>} ignored - Not applicable or in another partition.
 */

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Lowercases a host, strips IPv6 brackets, a leading cookie dot and a trailing dot.
 * @param {string} host - Hostname or cookie domain.
 * @returns {string} Bare lowercase host.
 */
function bareHost(host) {
    let h = String(host || '').trim().toLowerCase();
    if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
    if (h.startsWith('.')) h = h.slice(1);
    if (h.endsWith('.')) h = h.slice(0, -1);
    return h;
}

/**
 * Whether a bare host is an IPv4 or IPv6 literal.
 * @param {string} host - Bare host.
 * @returns {boolean} True for IP literals.
 */
function isIpHost(host) {
    return IPV4_PATTERN.test(host) || host.includes(':');
}

/**
 * Whether a bare host is a loopback host where Secure cookies work over http.
 * @param {string} host - Bare host.
 * @returns {boolean} True for localhost, *.localhost, 127.0.0.0/8 and ::1.
 */
function isLoopbackHost(host) {
    return host === 'localhost' || host.endsWith('.localhost') ||
        /^127(\.\d{1,3}){3}$/.test(host) || host === '::1';
}

/**
 * Parses an origin, returning null when it is not a valid URL.
 * @param {string} origin - Origin string.
 * @returns {URL|null} Parsed URL.
 */
function parseOrigin(origin) {
    try {
        return new URL(origin);
    } catch (e) {
        return null;
    }
}

/**
 * Returns the unbracketed lowercase host of an origin (the form cookie domains use).
 * @param {string} origin - Origin such as "https://[::1]:8080".
 * @returns {string} Bare host, or '' when the origin cannot be parsed.
 */
export function originHost(origin) {
    const url = parseOrigin(origin);
    return url ? bareHost(url.hostname) : '';
}

/**
 * Builds a stable identifier for a cookie (name, domain, path, store, partition).
 * The value is deliberately not part of the id.
 * @param {Object} cookie - A chrome.cookies.Cookie-like object.
 * @returns {string} Identifier.
 */
export function cookieId(cookie) {
    const pk = cookie.partitionKey;
    const partition = pk && typeof pk === 'object'
        ? `${pk.topLevelSite || ''}${pk.hasCrossSiteAncestor ? '#x' : ''}`
        : '';
    return [
        cookie.name || '',
        bareHost(cookie.domain),
        cookie.path || '/',
        cookie.storeId || '',
        partition
    ].join('|');
}

/**
 * Whether a cookie is host-only (sent only to the exact host that set it).
 * @param {Object} cookie - Cookie.
 * @returns {boolean} True when host-only.
 */
function isHostOnly(cookie) {
    if (typeof cookie.hostOnly === 'boolean') return cookie.hostOnly;
    return !String(cookie.domain || '').startsWith('.');
}

/**
 * Whether a cookie applies to (would be sent to) the given origin's host.
 *
 * Host-only cookies need an exact host match; domain cookies match the host or
 * any subdomain of it. Secure cookies do not apply to http origins other than
 * loopback hosts. Path and port are ignored (see module notes).
 *
 * @param {Object} cookie - Cookie.
 * @param {string} origin - Exact origin.
 * @returns {boolean} True when the cookie applies to the origin.
 */
export function cookieAppliesToOrigin(cookie, origin) {
    const url = parseOrigin(origin);
    if (!url || !cookie) return false;
    const host = bareHost(url.hostname);
    const domain = bareHost(cookie.domain);
    if (!host || !domain) return false;

    if (cookie.secure && url.protocol === 'http:' && !isLoopbackHost(host)) return false;

    if (isHostOnly(cookie) || isIpHost(host)) return host === domain;
    return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Whether a partition's top-level site covers the given origin.
 *
 * Without a public-suffix list the site is approximated: same scheme, and the
 * origin host equals the site host or is a subdomain of it.
 *
 * @param {string} topLevelSite - Partition key site, e.g. "https://example.com".
 * @param {string} origin - Exact origin.
 * @returns {boolean} True when the site matches.
 */
export function siteMatches(topLevelSite, origin) {
    if (!topLevelSite || typeof topLevelSite !== 'string') return false;
    const site = parseOrigin(topLevelSite);
    const target = parseOrigin(origin);
    if (!site || !target) return false;
    if (site.protocol !== target.protocol) return false;
    const siteHost = bareHost(site.hostname);
    const host = bareHost(target.hostname);
    if (!siteHost || !host) return false;
    if (host === siteHost) return true;
    return !isIpHost(host) && host.endsWith(`.${siteHost}`);
}

/**
 * Returns cookie metadata without the cookie value or any other field.
 * @param {Object} cookie - Cookie.
 * @returns {CookieMeta} Redacted metadata.
 */
export function redactCookie(cookie) {
    const pk = cookie.partitionKey;
    return {
        id: cookieId(cookie),
        name: cookie.name || '',
        domain: cookie.domain || '',
        path: cookie.path || '/',
        hostOnly: isHostOnly(cookie),
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: cookie.sameSite || 'unspecified',
        session: Boolean(cookie.session),
        expirationDate: typeof cookie.expirationDate === 'number' ? cookie.expirationDate : null,
        storeId: cookie.storeId || '',
        partitionKey: pk && typeof pk === 'object'
            ? { topLevelSite: pk.topLevelSite || '', hasCrossSiteAncestor: Boolean(pk.hasCrossSiteAncestor) }
            : null
    };
}

/**
 * Classifies cookies relative to a target origin.
 * @param {Array<Object>} cookies - Cookies from chrome.cookies.getAll.
 * @param {string} origin - Exact target origin.
 * @returns {CookieClassification} Redacted, classified cookies (values never included).
 */
export function classifyCookies(cookies, origin) {
    const result = { hostOnly: [], partitioned: [], shared: [], ignored: [] };
    const seen = new Set();
    for (const cookie of cookies || []) {
        if (!cookie || typeof cookie !== 'object') continue;
        const meta = redactCookie(cookie);
        if (seen.has(meta.id)) continue;
        seen.add(meta.id);

        if (!cookieAppliesToOrigin(cookie, origin)) {
            result.ignored.push({ ...meta, reason: 'notApplicable' });
        } else if (meta.partitionKey) {
            if (siteMatches(meta.partitionKey.topLevelSite, origin)) {
                result.partitioned.push(meta);
            } else {
                result.ignored.push({ ...meta, reason: 'otherPartition' });
            }
        } else if (meta.hostOnly) {
            result.hostOnly.push(meta);
        } else {
            result.shared.push(meta);
        }
    }
    return result;
}

/**
 * Builds the arguments for chrome.cookies.remove for one cookie.
 *
 * With `origin`, the URL is built on the target origin so the host permission
 * granted for that origin covers it (domain cookies are removable through any
 * URL they apply to). Without it, the URL is derived from the cookie itself.
 *
 * @param {Object} cookie - Cookie (full or redacted metadata).
 * @param {string} [origin] - Exact target origin.
 * @returns {{url: string, name: string, storeId?: string, partitionKey?: Object}} Removal details.
 */
export function cookieRemovalDetails(cookie, origin) {
    const path = cookie.path || '/';
    let base;
    const url = origin ? parseOrigin(origin) : null;
    if (url) {
        base = url.origin;
    } else {
        const domain = bareHost(cookie.domain);
        const host = domain.includes(':') ? `[${domain}]` : domain;
        base = `${cookie.secure ? 'https' : 'http'}://${host}`;
    }
    const details = { url: `${base}${path}`, name: cookie.name };
    if (cookie.storeId) details.storeId = cookie.storeId;
    const pk = cookie.partitionKey;
    if (pk && typeof pk === 'object') {
        details.partitionKey = { topLevelSite: pk.topLevelSite || '' };
        if (typeof pk.hasCrossSiteAncestor === 'boolean') {
            details.partitionKey.hasCrossSiteAncestor = pk.hasCrossSiteAncestor;
        }
    }
    return details;
}

/**
 * Lists the cookie domains to query for a host: the host and each parent
 * domain that still contains a dot. IP literals and single-label hosts such as
 * localhost return only the host (IPv6 unbracketed, as cookie domains are).
 *
 * @param {string} host - Hostname (IPv6 may be bracketed).
 * @returns {Array<string>} Candidate domains, most specific first.
 */
export function candidateDomains(host) {
    const h = bareHost(host);
    if (!h) return [];
    if (isIpHost(h) || !h.includes('.')) return [h];
    const labels = h.split('.');
    const out = [];
    for (let i = 0; i < labels.length - 1; i++) {
        out.push(labels.slice(i).join('.'));
    }
    return out;
}
