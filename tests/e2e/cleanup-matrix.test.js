/**
 * AW Browser Cleaner - E2E deletion matrix
 *
 * For every data type the popup offers (read from the DOM at runtime, so new types are covered
 * automatically) the cleanup runs on origin A through the popup with ONLY that type selected,
 * then the state of A, A2 (port variant), B (sibling subdomain) and C (canary) is read back:
 *
 *   - the selected type is gone from A, every other type of A is still there,
 *   - the canary C (127.0.0.1) is completely intact,
 *   - B and A2 keep all non-cookie data.
 *   - Cookies: the popup clears cookies domain-wide (Chrome removes cookies per registrable
 *     domain, and cookies ignore ports). So a Cookies cleanup on A is EXPECTED to remove the
 *     cookies of B and A2 as well, including the shared Domain=localtest.me cookie. That is the
 *     documented registrable-domain behaviour, not a bug; the canary stays untouched.
 *
 * A "Select all" run covers the combination. The matrix (type x origin x result) is printed to
 * stdout and written to test-artifacts/e2e-matrix.md (appended to the CI step summary).
 */

import { describe, test, expect, afterAll } from 'bun:test';
import {
    launchE2E, guarded, openPopupPage, readOfferedTypes, readState, summarizeState, seedAll,
    resetBrowserState, runCleanup, writeArtifact, STATE_KINDS
} from './helpers.js';

const env = await launchE2E();

/**
 * What each popup data type removes from the fixture state. Keys are checkbox values
 * (DATA_TYPES in cleanup-core.js). `null` = cannot be exercised through a popup opened in a tab.
 */
const TYPE_EFFECTS = {
    cookies: ['cookies'],
    localStorage: ['localStorage'],
    indexedDB: ['indexedDB'],
    fileSystems: ['opfs'],
    cacheStorage: ['cacheStorage'],
    serviceWorkers: ['serviceWorkers'],
    cache: ['httpCache'],
    sessionStorage: null
};

const ORIGIN_LABELS = {
    A: 'A (target)',
    A2: 'A2 (same host, other port)',
    B: 'B (sibling subdomain)',
    C: 'C (canary 127.0.0.1)'
};

/** Rows collected for the markdown matrix. */
const matrixRows = [];
const skippedTypes = [];

/**
 * Expected 'present' | 'empty' for `kind` on `originKey` after cleaning `cleared` kinds on A.
 */
function expectedVerdict(originKey, kind, cleared) {
    if (!cleared.includes(kind)) return 'present';
    if (originKey === 'A') return 'empty';
    // Cookies are scoped per registrable domain (and ignore ports): B and A2 lose them too.
    if (kind === 'cookies' && (originKey === 'B' || originKey === 'A2')) return 'empty';
    return 'present';
}

async function runScenario(label, selection, cleared) {
    const { browser, extensionId, origins } = env;
    await resetBrowserState(browser, Object.values(origins));
    await seedAll(browser, origins);

    // Precondition: everything is there before the cleanup.
    for (const [key, origin] of Object.entries(origins)) {
        const before = summarizeState(await readState(browser, origin), origin);
        for (const kind of STATE_KINDS) {
            if (before[kind] !== 'present') throw new Error(`Precondition failed: ${kind} on ${key} is ${before[kind]} before cleanup`);
        }
    }

    const popup = await openPopupPage(browser, extensionId);
    try {
        await runCleanup(popup, origins.A, { types: selection });
    } finally {
        await popup.close();
    }

    const failures = [];
    for (const [key, origin] of Object.entries(origins)) {
        const after = summarizeState(await readState(browser, origin), origin);
        const cells = {};
        for (const kind of STATE_KINDS) {
            const expected = expectedVerdict(key, kind, cleared);
            const actual = after[kind];
            const ok = actual === expected;
            cells[kind] = { actual, expected, ok };
            if (!ok) failures.push(`${label}: ${kind} on ${key} is ${actual}, expected ${expected}`);
        }
        matrixRows.push({ label, originKey: key, cells });
    }
    return failures;
}

// Data types the popup offers right now (read from the DOM so new types are picked up).
const offered = env ? await readOfferedTypes(env.browser, env.extensionId) : [];

const suite = env ? describe : describe.skip;

suite('Deletion matrix (popup -> real Chrome)', () => {
    test('popup offers at least cookies and one storage type', () => {
        expect(offered).toContain('cookies');
        expect(offered.length).toBeGreaterThan(1);
    });

    for (const type of offered) {
        if (!(type in TYPE_EFFECTS)) {
            test(`type "${type}" has a known effect in the matrix`, () => {
                throw new Error(`The popup offers "${type}" but tests/e2e/cleanup-matrix.test.js has no TYPE_EFFECTS entry for it. ` +
                    'Add the state kinds it removes (see helpers.js STATE_KINDS) or null if it cannot be tested from a popup tab.');
            });
            continue;
        }
        const effects = TYPE_EFFECTS[type];
        if (effects === null) {
            skippedTypes.push(type);
            test.skip(`only "${type}" cleans ${type} on A (not testable from a popup opened in a tab)`, () => {});
            continue;
        }
        test(`only "${type}": clears ${effects.join('+')} on A, nothing else, canary intact`, guarded(env, `matrix-${type}`, async () => {
            const failures = await runScenario(`only ${type}`, [type], effects);
            expect(failures).toEqual([]);
        }));
    }

    test('Select all: clears every offered type on A, canary intact', guarded(env, 'matrix-select-all', async () => {
        const cleared = offered.flatMap((t) => TYPE_EFFECTS[t] || []);
        const failures = await runScenario('select all', 'all', cleared);
        expect(failures).toEqual([]);
    }));
});

function cellText(cell) {
    const word = cell.actual === 'present' ? 'kept' : cell.actual === 'empty' ? 'cleared' : 'partial';
    return cell.ok ? word : `**${word} (expected ${cell.expected === 'present' ? 'kept' : 'cleared'})**`;
}

function renderMatrix() {
    const lines = [];
    lines.push('## E2E deletion matrix');
    lines.push('');
    lines.push(`Chrome: \`${env.chromeVersion}\`${process.env.AW_CHROME_CHANNEL ? ` (channel: ${process.env.AW_CHROME_CHANNEL})` : ''}`);
    lines.push('');
    lines.push('Each run cleans origin **A** (`http://a.localtest.me:P1`) through the popup. B = `b.localtest.me:P1`, ' +
        'A2 = `a.localtest.me:P2`, C = canary `127.0.0.1:P2`. Cookies are cleared domain-wide by design: ' +
        'B and A2 lose their cookies when Cookies is selected (expected), the canary never does.');
    lines.push('');
    lines.push(`Data types offered by the popup: ${offered.map((t) => `\`${t}\``).join(', ')}. ` +
        'Columns for types it does not offer (yet) must simply stay "kept".');
    lines.push('');
    lines.push(`| Selected | Origin | ${STATE_KINDS.join(' | ')} | Result |`);
    lines.push(`| --- | --- | ${STATE_KINDS.map(() => '---').join(' | ')} | --- |`);
    for (const row of matrixRows) {
        const ok = STATE_KINDS.every((k) => row.cells[k].ok);
        lines.push(`| ${row.label} | ${ORIGIN_LABELS[row.originKey]} | ${STATE_KINDS.map((k) => cellText(row.cells[k])).join(' | ')} | ${ok ? 'OK' : '**FAIL**'} |`);
    }
    if (skippedTypes.length) {
        lines.push('');
        lines.push(`Skipped (cannot be cleaned from a popup opened in a tab): ${skippedTypes.map((t) => `\`${t}\``).join(', ')}.`);
    }
    lines.push('');
    return lines.join('\n');
}

afterAll(async () => {
    if (env && matrixRows.length) {
        const markdown = renderMatrix();
        console.log('\n' + markdown);
        writeArtifact('e2e-matrix.md', markdown);
    }
    await env?.close();
});
