/**
 * Unit tests for origin-utils.js
 *
 * Tests the pure target normalization and validation module used by
 * AW Browser Cleaner. Covers the acceptance criteria from Issue #6:
 * full URLs, bare hostnames, explicit ports, IPv4, IPv6, IDN,
 * unsupported schemes, malformed inputs.
 */

const { normalizeTarget, validateOrigin } = require('../../origin-utils');

describe('normalizeTarget', () => {
    describe('valid HTTPS URLs', () => {
        test('strips path, query, and hash from HTTPS URL', () => {
            const result = normalizeTarget('https://example.com/page?a=1#section');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('https://example.com');
            expect(result.error).toBe('');
        });

        test('preserves HTTPS origin without path', () => {
            const result = normalizeTarget('https://example.com');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('https://example.com');
        });

        test('handles subdomain URL', () => {
            const result = normalizeTarget('https://sub.example.com/path');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('https://sub.example.com');
        });

        test('preserves explicit HTTPS port', () => {
            const result = normalizeTarget('https://sub.example.com:8443/path');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('https://sub.example.com:8443');
        });

        test('drops default HTTPS port 443', () => {
            const result = normalizeTarget('https://example.com:443/path');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('https://example.com');
        });
    });

    describe('valid HTTP URLs', () => {
        test('preserves HTTP scheme', () => {
            const result = normalizeTarget('http://example.com/page');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('http://example.com');
        });

        test('handles localhost with explicit port', () => {
            const result = normalizeTarget('http://localhost:3000/app');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('http://localhost:3000');
        });

        test('handles localhost without port', () => {
            const result = normalizeTarget('http://localhost');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('http://localhost');
        });

        test('drops default HTTP port 80', () => {
            const result = normalizeTarget('http://example.com:80/path');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('http://example.com');
        });
    });

    describe('bare hostnames (no scheme)', () => {
        test('defaults bare hostname to https', () => {
            const result = normalizeTarget('example.com');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('https://example.com');
        });

        test('defaults bare hostname with port to https', () => {
            const result = normalizeTarget('example.com:8080');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('https://example.com:8080');
        });

        test('defaults localhost to https', () => {
            const result = normalizeTarget('localhost');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('https://localhost');
        });

        test('defaults localhost with port to https', () => {
            const result = normalizeTarget('localhost:3000');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('https://localhost:3000');
        });
    });

    describe('IPv4 addresses', () => {
        test('handles IPv4 with scheme', () => {
            const result = normalizeTarget('http://192.168.1.1');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('http://192.168.1.1');
        });

        test('handles IPv4 with port', () => {
            const result = normalizeTarget('http://192.168.1.1:8080/path');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('http://192.168.1.1:8080');
        });

        test('handles bare IPv4', () => {
            const result = normalizeTarget('192.168.1.1');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('https://192.168.1.1');
        });
    });

    describe('IPv6 addresses', () => {
        test('handles IPv6 with scheme', () => {
            const result = normalizeTarget('http://[::1]');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('http://[::1]');
        });

        test('handles IPv6 with port', () => {
            const result = normalizeTarget('http://[::1]:8080/path');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('http://[::1]:8080');
        });
    });

    describe('unsupported schemes', () => {
        test('rejects chrome: scheme', () => {
            const result = normalizeTarget('chrome://extensions');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Unsupported scheme');
        });

        test('rejects file: scheme', () => {
            const result = normalizeTarget('file:///home/user/page.html');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Unsupported scheme');
        });

        test('rejects about: scheme', () => {
            const result = normalizeTarget('about:blank');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Unsupported scheme');
        });

        test('rejects ftp: scheme', () => {
            const result = normalizeTarget('ftp://example.com');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Unsupported scheme');
        });

        test('rejects chrome-extension: scheme', () => {
            const result = normalizeTarget('chrome-extension://abcdef/popup.html');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Unsupported scheme');
        });

        test('rejects javascript: scheme', () => {
            const result = normalizeTarget('javascript:alert(1)');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Unsupported scheme');
        });

        test('rejects data: scheme', () => {
            const result = normalizeTarget('data:text/html,<h1>test</h1>');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Unsupported scheme');
        });
    });

    describe('malformed inputs', () => {
        test('rejects empty string', () => {
            const result = normalizeTarget('');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('enter a target origin');
        });

        test('rejects null', () => {
            const result = normalizeTarget(null);
            expect(result.valid).toBe(false);
        });

        test('rejects undefined', () => {
            const result = normalizeTarget(undefined);
            expect(result.valid).toBe(false);
        });

        test('rejects whitespace-only string', () => {
            const result = normalizeTarget('   ');
            expect(result.valid).toBe(false);
        });

        test('trims whitespace from valid input', () => {
            const result = normalizeTarget('  https://example.com  ');
            expect(result.valid).toBe(true);
            expect(result.origin).toBe('https://example.com');
        });
    });

    describe('IDN/Unicode handling', () => {
        test('handles IDN domain with scheme', () => {
            const result = normalizeTarget('https://münchen.de');
            expect(result.valid).toBe(true);
            // URL API punycode-encodes IDN domains
            expect(result.origin).toMatch(/^https:\/\//);
        });
    });

    describe('return structure', () => {
        test('returns valid result with correct shape', () => {
            const result = normalizeTarget('https://example.com');
            expect(result).toHaveProperty('valid', true);
            expect(result).toHaveProperty('origin', 'https://example.com');
            expect(result).toHaveProperty('error', '');
        });

        test('returns invalid result with correct shape', () => {
            const result = normalizeTarget('');
            expect(result).toHaveProperty('valid', false);
            expect(result).toHaveProperty('origin', '');
            expect(typeof result.error).toBe('string');
            expect(result.error.length).toBeGreaterThan(0);
        });
    });
});

describe('validateOrigin', () => {
    test('accepts valid HTTPS origin', () => {
        const result = validateOrigin('https://example.com');
        expect(result.valid).toBe(true);
        expect(result.origin).toBe('https://example.com');
    });

    test('accepts valid HTTP origin with port', () => {
        const result = validateOrigin('http://localhost:3000');
        expect(result.valid).toBe(true);
        expect(result.origin).toBe('http://localhost:3000');
    });

    test('rejects origin with path', () => {
        const result = validateOrigin('https://example.com/page');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('path/query/hash');
    });

    test('rejects origin with query', () => {
        const result = validateOrigin('https://example.com?q=1');
        expect(result.valid).toBe(false);
    });

    test('rejects unsupported scheme', () => {
        const result = validateOrigin('ftp://example.com');
        expect(result.valid).toBe(false);
    });

    test('rejects null', () => {
        const result = validateOrigin(null);
        expect(result.valid).toBe(false);
    });

    test('rejects empty string', () => {
        const result = validateOrigin('');
        expect(result.valid).toBe(false);
    });
});
