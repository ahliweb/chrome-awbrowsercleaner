/**
 * AW Browser Cleaner - Origin Utilities
 * Pure, testable module for target normalization and validation.
 *
 * This module has no Chrome API dependencies so it can be unit-tested
 * without an extension runtime environment.
 */

/**
 * Set of URL schemes supported for cleanup operations.
 * @type {Set<string>}
 */
const VALID_SCHEMES = new Set(['http:', 'https:']);

/**
 * Result of a target normalization/validation operation.
 * @typedef {Object} NormalizeResult
 * @property {boolean} valid - Whether the input was successfully normalized.
 * @property {string} origin - The normalized origin string (empty on failure).
 * @property {string} error - Human-readable error message (empty on success).
 */

/**
 * Normalizes and validates a user-supplied target input into an exact origin.
 *
 * Rules:
 * - A valid HTTP(S) origin is accepted directly.
 * - A full URL has path/query/hash stripped; the origin is returned.
 * - A bare hostname (no scheme) is normalized to https:// by default.
 * - Explicit ports are preserved.
 * - Unsupported protocols are rejected.
 * - Malformed inputs are rejected.
 * - Opaque origins (e.g., blob:, data:) are rejected.
 *
 * @param {string} input - The raw user input to normalize.
 * @returns {NormalizeResult} The normalization result.
 */
function normalizeTarget(input) {
    if (!input || typeof input !== 'string') {
        return { valid: false, origin: '', error: 'Please enter a target origin.' };
    }

    const trimmed = input.trim();
    if (!trimmed) {
        return { valid: false, origin: '', error: 'Please enter a target origin.' };
    }

    // Detect and reject malformed protocol-like inputs
    // e.g., "ftp://example.com", "javascript:alert(1)", "data:text/html,..."
    const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
    if (schemeMatch) {
        const schemeWithColon = schemeMatch[1].toLowerCase() + ':';
        if (!VALID_SCHEMES.has(schemeWithColon)) {
            return {
                valid: false,
                origin: '',
                error: `Unsupported scheme "${schemeWithColon}". Only HTTP and HTTPS are supported.`
            };
        }
    }

    // Also reject scheme-only patterns without // (e.g., "javascript:", "chrome:")
    const bareSchemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(?!\/\/)/);
    if (bareSchemeMatch) {
        const schemeWithColon = bareSchemeMatch[1].toLowerCase() + ':';
        if (!VALID_SCHEMES.has(schemeWithColon)) {
            return {
                valid: false,
                origin: '',
                error: `Unsupported scheme "${schemeWithColon}". Only HTTP and HTTPS are supported.`
            };
        }
    }

    let urlString = trimmed;

    // If no scheme is present, prepend https:// for bare hostnames
    if (!trimmed.includes('://')) {
        // Guard against things like "example.com:alert(1)" being misinterpreted
        // A valid bare hostname can contain dots, hyphens, brackets (IPv6), colons (port)
        urlString = `https://${trimmed}`;
    }

    let url;
    try {
        url = new URL(urlString);
    } catch (e) {
        return {
            valid: false,
            origin: '',
            error: 'Invalid URL or origin. Example: https://example.com'
        };
    }

    // Validate the parsed scheme
    if (!VALID_SCHEMES.has(url.protocol)) {
        return {
            valid: false,
            origin: '',
            error: `Unsupported scheme "${url.protocol}". Only HTTP and HTTPS are supported.`
        };
    }

    // Ensure we have a valid hostname
    if (!url.hostname) {
        return {
            valid: false,
            origin: '',
            error: 'Could not determine a valid hostname from the input.'
        };
    }

    // Get the exact origin (scheme + hostname + port)
    const origin = url.origin;

    // Guard against opaque/null origins
    if (origin === 'null' || !origin) {
        return {
            valid: false,
            origin: '',
            error: 'Could not determine a valid origin from the input.'
        };
    }

    return { valid: true, origin: origin, error: '' };
}

/**
 * Validates that a string is a well-formed HTTP(S) origin.
 *
 * @param {string} origin - The origin string to validate.
 * @returns {NormalizeResult} The validation result.
 */
function validateOrigin(origin) {
    if (!origin || typeof origin !== 'string') {
        return { valid: false, origin: '', error: 'Origin is required.' };
    }

    try {
        const url = new URL(origin);

        if (!VALID_SCHEMES.has(url.protocol)) {
            return {
                valid: false,
                origin: '',
                error: `Unsupported scheme "${url.protocol}". Only HTTP and HTTPS are supported.`
            };
        }

        if (!url.hostname) {
            return {
                valid: false,
                origin: '',
                error: 'Origin must include a hostname.'
            };
        }

        // An origin should not have path, query, or hash beyond the root
        if (url.pathname !== '/' || url.search || url.hash) {
            return {
                valid: false,
                origin: url.origin,
                error: 'Value contains path/query/hash. Use normalizeTarget() to strip these.'
            };
        }

        if (url.origin === 'null') {
            return {
                valid: false,
                origin: '',
                error: 'Could not determine a valid origin.'
            };
        }

        return { valid: true, origin: url.origin, error: '' };
    } catch (e) {
        return {
            valid: false,
            origin: '',
            error: 'Invalid origin format. Example: https://example.com'
        };
    }
}

// Export for testing (Node.js) or make available globally (browser)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeTarget, validateOrigin, VALID_SCHEMES };
}
