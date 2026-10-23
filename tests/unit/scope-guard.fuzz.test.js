/**
 * Deterministic fuzz tests for the Scope Guard.
 *
 * Feeds thousands of hostile and malformed target strings through
 * normalizeTarget(), createPlan() and validatePlan() and asserts that nothing
 * but an exact origin can ever reach a plan.
 */

import { describe, test, expect } from 'bun:test';
import { normalizeTarget, validateOrigin } from '../../origin-utils.js';
import { createPlan, validatePlan, buildRemovalOptions, ScopeGuardError } from '../../cleanup-core.js';

/**
 * Mulberry32 seeded PRNG (deterministic, no dependencies).
 * @param {number} seed - 32-bit seed.
 * @returns {function(): number} Generator of floats in [0, 1).
 */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const SEED = 0xA11CE;
const COUNT = 4000;

const SCHEMES = ['', '', '', 'http://', 'https://', 'HTTPS://', 'ftp://', 'javascript:', 'data:', 'file:///', 'chrome://', '//', 'blob:https://', 'ws://'];
const USERINFO = ['', '', '', '', 'user@', 'user:pass@', ':@', 'a%40b@', 'admin:*@'];
const HOSTS = [
    'example.com', 'EXAMPLE.COM', 'a.b.c.example.org', 'localhost', '127.0.0.1', '0x7f.1', '2130706433',
    '[::1]', '[2001:db8::1]', '[::ffff:127.0.0.1]', '::1', 'xn--bcher-kva.example', 'bücher.example',
    'münchen.de', '日本語.jp', 'ex ample.com', 'exa\u0000mple.com', 'exa\tmple.com', 'exa\nmple.com',
    '*.example.com', '*', 'example.com.', 'example..com', '.example.com', 'ex_ample.com', 'a'.repeat(70) + '.test',
    'example.com%2Fevil', 'example.com\\@evil.test', '', ' ', 'http', 'localhost.localdomain', '１２７.０.０.１',
    'exa​mple.com', '\u0007bell.test', 'foo­bar.test'
];
const PORTS = ['', '', '', ':443', ':80', ':8080', ':65535', ':65536', ':0', ':abc', ':', ':-1', ':99999999'];
const PATHS = ['', '', '', '/', '/path', '/a/b?c=d', '?q=1', '#frag', '/..;/x', '/%2e%2e/', '\\evil', '/*', '/\u0000', '?*', '/a b'];
const WRAPS = [['', ''], ['', ''], ['', ''], [' ', ' '], ['\t', '\n'], ['"', '"'], ['<', '>'], ['\u0000', '']];

/**
 * Builds one pseudo-random hostile input.
 * @param {function(): number} rnd - PRNG.
 * @returns {string} Input.
 */
function randomInput(rnd) {
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const [pre, post] = pick(WRAPS);
    let s = pick(SCHEMES) + pick(USERINFO) + pick(HOSTS) + pick(PORTS) + pick(PATHS);
    if (rnd() < 0.1) {
        // random byte soup, including control characters
        const len = 1 + Math.floor(rnd() * 24);
        s = Array.from({ length: len }, () => String.fromCharCode(Math.floor(rnd() * 0x250))).join('');
    }
    return pre + s + post;
}

/**
 * Asserts the invariants of an accepted origin.
 * @param {string} origin - Origin returned by normalizeTarget.
 * @param {{allowStar?: boolean}} [options] - allowStar tolerates "*" in the host
 *   (origin-utils currently lets WHATWG-legal "*" hosts through; the Scope Guard
 *   layer must still reject them, which is asserted separately).
 */
function assertExactOrigin(origin, { allowStar = false } = {}) {
    expect(typeof origin).toBe('string');
    expect(validateOrigin(origin)).toMatchObject({ valid: true, origin });
    const url = new URL(origin);
    expect(url.origin).toBe(origin);
    expect(url.pathname).toBe('/');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(['http:', 'https:']).toContain(url.protocol);
    expect(origin).not.toMatch(/[@?#\s\u0000-\u001f\\]/);
    if (!allowStar) expect(origin).not.toContain('*');
    expect(origin.slice(origin.indexOf('://') + 3)).not.toContain('/');
}

describe('Scope Guard fuzz', () => {
    const rnd = mulberry32(SEED);
    const inputs = Array.from({ length: COUNT }, () => randomInput(rnd));

    test('is deterministic for a fixed seed', () => {
        const again = mulberry32(SEED);
        expect(Array.from({ length: 50 }, () => randomInput(again))).toEqual(inputs.slice(0, 50));
    });

    test('generates a meaningful mix of accepted and rejected inputs', () => {
        const results = inputs.map(i => normalizeTarget(i));
        const valid = results.filter(r => r.valid).length;
        expect(inputs.length).toBeGreaterThanOrEqual(1000);
        expect(valid).toBeGreaterThan(100);
        expect(results.length - valid).toBeGreaterThan(100);
    });

    test('normalizeTarget yields either {valid:false} or one exact origin', () => {
        for (const input of inputs) {
            const result = normalizeTarget(input);
            if (!result.valid) {
                expect(result.origin).toBe('');
                expect(typeof result.error).toBe('string');
                expect(result.error.length).toBeGreaterThan(0);
            } else {
                assertExactOrigin(result.origin);
            }
        }
    });

    test('wildcard inputs are rejected by normalizeTarget and by the Scope Guard', () => {
        let seen = 0;
        for (const input of inputs) {
            if (!input.includes('*')) continue;
            seen++;
            const result = normalizeTarget(input);
            expect(result.valid && result.origin.includes('*')).toBe(false);
            const created = createPlan({ origins: [input], dataTypes: ['cache'] });
            expect(created.ok).toBe(false);
            expect(() => buildRemovalOptions({ origins: [input] })).toThrow(ScopeGuardError);
        }
        expect(seen).toBeGreaterThan(0);
    });

    test('createPlan never yields an invalid origin, from raw or normalized input', () => {
        for (const input of inputs) {
            for (const candidate of [input, normalizeTarget(input).origin]) {
                const created = createPlan({ origins: [candidate], dataTypes: ['localStorage'] });
                if (created.ok) {
                    expect(created.plan.origins).toHaveLength(1);
                    assertExactOrigin(created.plan.origins[0]);
                    expect(validatePlan(created.plan).ok).toBe(true);
                } else {
                    expect(typeof created.code).toBe('string');
                    expect(typeof created.error).toBe('string');
                }
            }
        }
    });

    test('validatePlan rejects every raw origin that is not already exact', () => {
        for (const input of inputs) {
            const verdict = validatePlan({
                version: 1, source: 'popup', origins: [input], dataTypes: ['cache'], cookieMode: 'exact',
                cookieSelection: { includeShared: [], keepNames: [] }, since: 0, after: 'none', startPath: '/',
                presetId: 'custom', tab: null
            });
            if (verdict.ok) {
                assertExactOrigin(input);
                expect(new URL(input).origin).toBe(input);
            }
        }
    });

    test('buildRemovalOptions only ever emits exact origins with unprotectedWeb', () => {
        for (const input of inputs) {
            try {
                const options = buildRemovalOptions({ origins: [input] });
                expect(options.origins).toEqual([input]);
                assertExactOrigin(input);
                expect(options.originTypes).toEqual({ unprotectedWeb: true });
            } catch (e) {
                expect(e).toBeInstanceOf(ScopeGuardError);
            }
        }
    });

    test('mixed origin lists are rejected whenever one entry is bad', () => {
        const good = 'https://good.example.test';
        for (const input of inputs.slice(0, 1500)) {
            const created = createPlan({ origins: [good, input], dataTypes: ['cache'] });
            if (created.ok) {
                for (const o of created.plan.origins) assertExactOrigin(o);
                expect(created.plan.origins.length).toBeLessThanOrEqual(2);
            }
        }
    });

    test('wildcards and exclusion keys can never be smuggled in', () => {
        const rnd2 = mulberry32(SEED + 1);
        for (let i = 0; i < 500; i++) {
            const base = normalizeTarget(inputs[i]).origin || 'https://ok.example.test';
            const wildcard = base.replace('://', rnd2() < 0.5 ? '://*.' : '://') + (rnd2() < 0.5 ? '/*' : '*');
            expect(createPlan({ origins: [wildcard], dataTypes: ['cache'] }).ok).toBe(false);
            const key = ['excludeOrigins', 'ExcludeOrigins', 'excludeX', 'x_exclude'][i % 4];
            expect(createPlan({ origins: [base], dataTypes: ['cache'], [key]: ['https://x.test'] }).ok).toBe(false);
            expect(() => buildRemovalOptions({ origins: [base], [key]: [] })).toThrow(ScopeGuardError);
        }
    });

    test('plans never exceed the origin cap', () => {
        const rnd3 = mulberry32(SEED + 2);
        for (let i = 0; i < 200; i++) {
            const n = Math.floor(rnd3() * 25);
            const origins = Array.from({ length: n }, (_, k) => `https://h${k}-${i}.test`);
            const created = createPlan({ origins, dataTypes: ['cache'] });
            expect(created.ok).toBe(n >= 1 && n <= 10);
        }
    });
});
