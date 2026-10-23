/**
 * Unit tests for cookie-engine.js (Exact Cookie Mode, pure logic).
 */

import { describe, test, expect } from 'bun:test';
import {
    cookieId,
    cookieAppliesToOrigin,
    classifyCookies,
    redactCookie,
    cookieRemovalDetails,
    candidateDomains,
    siteMatches,
    originHost
} from '../../cookie-engine.js';

/**
 * Builds a cookie fixture.
 * @param {Object} over - Overrides.
 * @returns {Object} Cookie.
 */
function cookie(over = {}) {
    return {
        name: 'sid',
        value: 'SECRET-VALUE-123',
        domain: 'a.localtest.me',
        hostOnly: true,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        session: true,
        storeId: '0',
        ...over
    };
}

describe('originHost', () => {
    test('returns lowercase unbracketed hosts', () => {
        expect(originHost('https://Example.COM:8443')).toBe('example.com');
        expect(originHost('http://[::1]:8080')).toBe('::1');
        expect(originHost('nonsense')).toBe('');
    });
});

describe('cookieId', () => {
    test('is stable and ignores the value', () => {
        const a = cookieId(cookie());
        const b = cookieId(cookie({ value: 'other' }));
        expect(a).toBe(b);
        expect(a).not.toContain('SECRET');
    });

    test('differs by name, domain, path, store and partition', () => {
        const base = cookieId(cookie());
        expect(cookieId(cookie({ name: 'x' }))).not.toBe(base);
        expect(cookieId(cookie({ domain: 'b.localtest.me' }))).not.toBe(base);
        expect(cookieId(cookie({ path: '/x' }))).not.toBe(base);
        expect(cookieId(cookie({ storeId: '1' }))).not.toBe(base);
        const p1 = cookieId(cookie({ partitionKey: { topLevelSite: 'https://x.test' } }));
        const p2 = cookieId(cookie({ partitionKey: { topLevelSite: 'https://x.test', hasCrossSiteAncestor: true } }));
        expect(p1).not.toBe(base);
        expect(p1).not.toBe(p2);
    });

    test('treats a leading dot on the domain as the same cookie domain', () => {
        expect(cookieId(cookie({ domain: '.a.test' }))).toBe(cookieId(cookie({ domain: 'a.test' })));
    });
});

describe('cookieAppliesToOrigin', () => {
    test('host-only cookies need an exact host match', () => {
        const c = cookie({ domain: 'a.localtest.me' });
        expect(cookieAppliesToOrigin(c, 'https://a.localtest.me')).toBe(true);
        expect(cookieAppliesToOrigin(c, 'https://b.localtest.me')).toBe(false);
        expect(cookieAppliesToOrigin(c, 'https://x.a.localtest.me')).toBe(false);
    });

    test('domain cookies match the host and its subdomains', () => {
        const c = cookie({ domain: '.localtest.me', hostOnly: false });
        expect(cookieAppliesToOrigin(c, 'https://a.localtest.me')).toBe(true);
        expect(cookieAppliesToOrigin(c, 'https://b.localtest.me')).toBe(true);
        expect(cookieAppliesToOrigin(c, 'https://localtest.me')).toBe(true);
        expect(cookieAppliesToOrigin(c, 'https://evil-localtest.me')).toBe(false);
        expect(cookieAppliesToOrigin(c, 'https://localtest.me.evil.test')).toBe(false);
    });

    test('infers host-only from a missing leading dot when hostOnly is absent', () => {
        const c = cookie({ domain: 'localtest.me' });
        delete c.hostOnly;
        expect(cookieAppliesToOrigin(c, 'https://a.localtest.me')).toBe(false);
        expect(cookieAppliesToOrigin(c, 'https://localtest.me')).toBe(true);
        const d = cookie({ domain: '.localtest.me' });
        delete d.hostOnly;
        expect(cookieAppliesToOrigin(d, 'https://a.localtest.me')).toBe(true);
    });

    test('secure cookies do not apply to http except on loopback hosts', () => {
        const c = cookie({ domain: 'a.test', secure: true });
        expect(cookieAppliesToOrigin(c, 'http://a.test')).toBe(false);
        expect(cookieAppliesToOrigin(c, 'https://a.test')).toBe(true);
        const l = cookie({ domain: 'localhost', secure: true });
        expect(cookieAppliesToOrigin(l, 'http://localhost:3000')).toBe(true);
        const ip = cookie({ domain: '127.0.0.1', secure: true });
        expect(cookieAppliesToOrigin(ip, 'http://127.0.0.1:8080')).toBe(true);
    });

    test('non-secure cookies apply to http and https', () => {
        const c = cookie({ domain: 'a.test', secure: false });
        expect(cookieAppliesToOrigin(c, 'http://a.test')).toBe(true);
        expect(cookieAppliesToOrigin(c, 'https://a.test')).toBe(true);
    });

    test('ignores port and path (cookies are not port-isolated)', () => {
        const c = cookie({ domain: 'a.test', path: '/admin/deep' });
        expect(cookieAppliesToOrigin(c, 'https://a.test:8443')).toBe(true);
        expect(cookieAppliesToOrigin(c, 'https://a.test')).toBe(true);
    });

    test('IPv6 origins match unbracketed cookie domains', () => {
        const c = cookie({ domain: '::1', secure: false });
        expect(cookieAppliesToOrigin(c, 'http://[::1]:8080')).toBe(true);
        expect(cookieAppliesToOrigin(c, 'http://[::2]:8080')).toBe(false);
        const secure = cookie({ domain: '::1', secure: true });
        expect(cookieAppliesToOrigin(secure, 'http://[::1]:8080')).toBe(true);
    });

    test('IP hosts never match as domain cookies', () => {
        const c = cookie({ domain: '.0.0.1', hostOnly: false, secure: false });
        expect(cookieAppliesToOrigin(c, 'http://127.0.0.1')).toBe(false);
    });

    test('rejects invalid input', () => {
        expect(cookieAppliesToOrigin(cookie(), 'not a url')).toBe(false);
        expect(cookieAppliesToOrigin(null, 'https://a.test')).toBe(false);
        expect(cookieAppliesToOrigin(cookie({ domain: '' }), 'https://a.test')).toBe(false);
    });
});

describe('siteMatches', () => {
    test('matches the same site and subdomains with the same scheme', () => {
        expect(siteMatches('https://localtest.me', 'https://a.localtest.me')).toBe(true);
        expect(siteMatches('https://a.localtest.me', 'https://a.localtest.me:8443')).toBe(true);
    });

    test('rejects other sites, schemes and garbage', () => {
        expect(siteMatches('https://other.test', 'https://a.localtest.me')).toBe(false);
        expect(siteMatches('http://localtest.me', 'https://a.localtest.me')).toBe(false);
        expect(siteMatches('https://evil-localtest.me', 'https://a.localtest.me')).toBe(false);
        expect(siteMatches('', 'https://a.test')).toBe(false);
        expect(siteMatches(null, 'https://a.test')).toBe(false);
        expect(siteMatches('nope', 'https://a.test')).toBe(false);
        expect(siteMatches('https://a.test', 'nope')).toBe(false);
    });

    test('IP hosts match only exactly', () => {
        expect(siteMatches('http://127.0.0.1', 'http://127.0.0.1:81')).toBe(true);
        expect(siteMatches('http://0.0.1', 'http://127.0.0.1')).toBe(false);
    });
});

describe('classifyCookies', () => {
    const origin = 'https://a.localtest.me';

    test('separates host-only, shared, partitioned and ignored cookies', () => {
        const cookies = [
            cookie({ name: 'own', domain: 'a.localtest.me' }),
            cookie({ name: 'other', domain: 'b.localtest.me' }),
            cookie({ name: 'shared', domain: '.localtest.me', hostOnly: false }),
            cookie({ name: 'chips', domain: 'a.localtest.me', partitionKey: { topLevelSite: 'https://localtest.me' } }),
            cookie({ name: 'foreign', domain: 'a.localtest.me', partitionKey: { topLevelSite: 'https://other.test' } })
        ];
        const result = classifyCookies(cookies, origin);
        expect(result.hostOnly.map(c => c.name)).toEqual(['own']);
        expect(result.shared.map(c => c.name)).toEqual(['shared']);
        expect(result.partitioned.map(c => c.name)).toEqual(['chips']);
        expect(result.ignored.map(c => [c.name, c.reason])).toEqual([
            ['other', 'notApplicable'],
            ['foreign', 'otherPartition']
        ]);
    });

    test('a.localtest.me vs b.localtest.me vs .localtest.me', () => {
        const cookies = [
            cookie({ name: 'a', domain: 'a.localtest.me' }),
            cookie({ name: 'b', domain: 'b.localtest.me' }),
            cookie({ name: 'wide', domain: '.localtest.me', hostOnly: false })
        ];
        const forA = classifyCookies(cookies, 'https://a.localtest.me');
        const forB = classifyCookies(cookies, 'https://b.localtest.me');
        expect(forA.hostOnly.map(c => c.name)).toEqual(['a']);
        expect(forB.hostOnly.map(c => c.name)).toEqual(['b']);
        expect(forA.shared.map(c => c.name)).toEqual(['wide']);
        expect(forB.shared.map(c => c.name)).toEqual(['wide']);
    });

    test('secure cookies on http origins are ignored, localhost is kept', () => {
        const secureCookie = cookie({ name: 's', domain: 'a.test', secure: true });
        expect(classifyCookies([secureCookie], 'http://a.test').ignored).toHaveLength(1);
        const local = cookie({ name: 'l', domain: 'localhost', secure: true });
        expect(classifyCookies([local], 'http://localhost:3000').hostOnly).toHaveLength(1);
    });

    test('deeper cookie paths still belong to the origin', () => {
        const deep = cookie({ name: 'deep', domain: 'a.localtest.me', path: '/admin/panel' });
        expect(classifyCookies([deep], origin).hostOnly).toHaveLength(1);
    });

    test('IPv6 origins classify unbracketed cookie domains', () => {
        const c = cookie({ name: 'v6', domain: '::1', secure: false });
        const result = classifyCookies([c], 'http://[::1]:8080');
        expect(result.hostOnly.map(x => x.name)).toEqual(['v6']);
    });

    test('de-duplicates identical cookies and skips junk', () => {
        const c = cookie();
        const result = classifyCookies([c, { ...c }, null, 'x'], origin);
        expect(result.hostOnly).toHaveLength(1);
        expect(classifyCookies(undefined, origin).hostOnly).toEqual([]);
    });

    test('output never contains cookie values', () => {
        const cookies = [
            cookie({ name: 'own' }),
            cookie({ name: 'shared', domain: '.localtest.me', hostOnly: false }),
            cookie({ name: 'chips', partitionKey: { topLevelSite: 'https://localtest.me' } }),
            cookie({ name: 'ignored', domain: 'zzz.test' })
        ];
        const json = JSON.stringify(classifyCookies(cookies, origin));
        expect(json).not.toContain('SECRET-VALUE-123');
        expect(json).not.toContain('"value"');
    });
});

describe('redactCookie', () => {
    test('drops the value and unknown fields, keeps metadata', () => {
        const meta = redactCookie(cookie({ expirationDate: 1234, extra: 'x', session: false }));
        expect(JSON.stringify(meta)).not.toContain('SECRET');
        expect('value' in meta).toBe(false);
        expect('extra' in meta).toBe(false);
        expect(meta).toMatchObject({
            name: 'sid', domain: 'a.localtest.me', path: '/', hostOnly: true, secure: true,
            httpOnly: true, sameSite: 'lax', session: false, expirationDate: 1234, storeId: '0', partitionKey: null
        });
        expect(typeof meta.id).toBe('string');
    });

    test('applies defaults for sparse cookies and normalizes partition keys', () => {
        const meta = redactCookie({ name: 'n', domain: '.x.test', partitionKey: { topLevelSite: 'https://x.test' } });
        expect(meta.path).toBe('/');
        expect(meta.sameSite).toBe('unspecified');
        expect(meta.hostOnly).toBe(false);
        expect(meta.expirationDate).toBeNull();
        expect(meta.partitionKey).toEqual({ topLevelSite: 'https://x.test', hasCrossSiteAncestor: false });
    });
});

describe('cookieRemovalDetails', () => {
    test('builds a URL from the cookie when no origin is given', () => {
        expect(cookieRemovalDetails(cookie({ domain: '.localtest.me', path: '/p' }))).toEqual({
            url: 'https://localtest.me/p', name: 'sid', storeId: '0'
        });
        expect(cookieRemovalDetails(cookie({ secure: false, domain: 'a.test', storeId: '' }))).toEqual({
            url: 'http://a.test/', name: 'sid'
        });
    });

    test('brackets IPv6 hosts', () => {
        const d = cookieRemovalDetails(cookie({ domain: '::1', secure: false }));
        expect(d.url).toBe('http://[::1]/');
    });

    test('uses the target origin when provided', () => {
        const d = cookieRemovalDetails(cookie({ domain: '.localtest.me', path: '/x' }), 'https://a.localtest.me:8443');
        expect(d.url).toBe('https://a.localtest.me:8443/x');
    });

    test('keeps the partition key', () => {
        const d = cookieRemovalDetails(cookie({
            partitionKey: { topLevelSite: 'https://localtest.me', hasCrossSiteAncestor: false }
        }));
        expect(d.partitionKey).toEqual({ topLevelSite: 'https://localtest.me', hasCrossSiteAncestor: false });
        const d2 = cookieRemovalDetails(cookie({ partitionKey: { topLevelSite: 'https://localtest.me' } }));
        expect(d2.partitionKey).toEqual({ topLevelSite: 'https://localtest.me' });
    });

    test('never includes the value', () => {
        expect(JSON.stringify(cookieRemovalDetails(cookie()))).not.toContain('SECRET');
    });
});

describe('candidateDomains', () => {
    test('returns the host and parent domains that contain a dot', () => {
        expect(candidateDomains('a.b.example.com')).toEqual(['a.b.example.com', 'b.example.com', 'example.com']);
        expect(candidateDomains('example.com')).toEqual(['example.com']);
    });

    test('returns only the host for localhost and single labels', () => {
        expect(candidateDomains('localhost')).toEqual(['localhost']);
    });

    test('returns only the host for IPv4 and IPv6 (unbracketed)', () => {
        expect(candidateDomains('127.0.0.1')).toEqual(['127.0.0.1']);
        expect(candidateDomains('[::1]')).toEqual(['::1']);
        expect(candidateDomains('::1')).toEqual(['::1']);
    });

    test('normalizes case and trailing dots; empty input yields nothing', () => {
        expect(candidateDomains('A.Example.COM.')).toEqual(['a.example.com', 'example.com']);
        expect(candidateDomains('')).toEqual([]);
        expect(candidateDomains(undefined)).toEqual([]);
    });
});
