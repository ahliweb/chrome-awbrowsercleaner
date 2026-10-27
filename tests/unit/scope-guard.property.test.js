/**
 * Property-based (fast-check) tests for the Scope Guard.
 *
 * Complements the seeded corpus in scope-guard.fuzz.test.js: fast-check
 * generates and shrinks arbitrary inputs, so any counterexample is reported
 * as a minimal failing string.
 */

import { describe, test, expect } from 'bun:test';
import fc from 'fast-check';
import { normalizeTarget, validateOrigin } from '../../origin-utils.js';
import { createPlan, validatePlan, buildRemovalOptions } from '../../cleanup-core.js';

const RUNS = { numRuns: 1000, seed: 0xA11CE };

describe('normalizeTarget properties', () => {
    test('never throws and a valid result is a bare http(s) origin', () => {
        fc.assert(fc.property(fc.string({ maxLength: 200 }), (input) => {
            const r = normalizeTarget(input);
            if (!r.valid) return true;
            const url = new URL(r.origin);
            return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === r.origin;
        }), RUNS);
    });

    test('is idempotent: normalizing a normalized origin changes nothing', () => {
        fc.assert(fc.property(fc.webUrl(), (input) => {
            const first = normalizeTarget(input);
            if (!first.valid) return true;
            const second = normalizeTarget(first.origin);
            return second.valid && second.origin === first.origin;
        }), RUNS);
    });

    test('drops paths, queries and fragments of any web URL', () => {
        fc.assert(fc.property(fc.webUrl({ withQueryParameters: true, withFragments: true }), (input) => {
            const r = normalizeTarget(input);
            return !r.valid || r.origin === new URL(input).origin;
        }), RUNS);
    });
});

describe('Scope Guard properties', () => {
    test('createPlan only ever yields plans that validatePlan accepts', () => {
        fc.assert(fc.property(fc.array(fc.string({ maxLength: 80 }), { maxLength: 12 }), (origins) => {
            const r = createPlan({ origins, dataTypes: ['cache'] });
            return !r.ok || validatePlan(r.plan).ok;
        }), RUNS);
    });

    test('accepted plans contain only validated exact origins', () => {
        fc.assert(fc.property(fc.array(fc.oneof(fc.webUrl(), fc.string({ maxLength: 60 })), { maxLength: 12 }), (origins) => {
            const r = createPlan({ origins, dataTypes: ['cache'] });
            return !r.ok || r.plan.origins.every((o) => validateOrigin(o).valid);
        }), RUNS);
    });

    test('removal options never contain an exclusion or an empty origin list', () => {
        fc.assert(fc.property(fc.array(fc.webUrl(), { minLength: 1, maxLength: 10 }), (origins) => {
            const r = createPlan({ origins, dataTypes: ['cache'] });
            if (!r.ok) return true;
            const opts = buildRemovalOptions(r.plan);
            return opts.origins.length > 0 && !JSON.stringify(opts).toLowerCase().includes('exclude');
        }), RUNS);
    });

    test('any extra property containing "exclude" is rejected', () => {
        fc.assert(fc.property(fc.string({ maxLength: 10 }), fc.string({ maxLength: 10 }), (a, b) => {
            const r = createPlan({ origins: ['https://example.com'], dataTypes: ['cache'], [`${a}Exclude${b}`]: true });
            return r.ok === false;
        }), RUNS);
    });
});
