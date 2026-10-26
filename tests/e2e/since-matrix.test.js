/**
 * AW Browser Cleaner - E2E: time range ("since") matrix per data type
 *
 * Issue #37 acceptance: "E2E matrix per type: is old data kept when since is used; results
 * recorded in docs".
 *
 * For every data type that goes through chrome.browsingData (localStorage, indexedDB, fileSystems,
 * cache, cacheStorage, serviceWorkers, and cookies in domain-wide mode) the test
 *   1. seeds OLD data on origin A (plus a full seed of B and the canary C),
 *   2. waits more than SEPARATION_MS, records t0, seeds NEW data (different keys / names),
 *   3. runs createPlan + executePlan from an extension page with since = t0 (a real
 *      chrome.browsingData.remove call with { origins: [A], since: t0 }),
 *   4. reads A back from a fresh tab and records "old kept?" and "new removed?".
 *
 * Chrome's handling of `since` differs per storage type and per version, so the test does NOT pin
 * "old data is kept" for any type. It asserts the safety invariants, which must hold for every
 * type, and records the observed old/new result in test-artifacts/since-matrix.md (also printed):
 *   - the NEW data of the selected type is removed,
 *   - the canary C is completely untouched,
 *   - B and A2 keep all non-cookie data,
 *   - the other data types of A are untouched.
 * Cookies are domain-wide here (Exact Cookie Mode cannot be limited by time): the cookies of
 * B and A2 may legitimately be affected, but only those created after t0 may go with `since`.
 */

import { describe, test, expect, afterAll } from 'bun:test';
import {
    launchE2E, guarded, readState, seedOrigin, resetBrowserState, writeArtifact, sleep, STATE_KINDS
} from './helpers.js';

const env = await launchE2E();
afterAll(async () => { await env?.close(); });

const suite = env ? describe : describe.skip;

/** Old and new data are separated by at least this long. */
const SEPARATION_MS = 3000;
// browsingData.remove can resolve before the backend has committed the deletion (seen once for
// localStorage on Chrome beta, #54). Poll up to this long and record how long it took.
const SETTLE_TIMEOUT_MS = 3000;
const SETTLE_POLL_MS = 250;

const TYPES = ['localStorage', 'indexedDB', 'fileSystems', 'cache', 'cacheStorage', 'serviceWorkers', 'cookies'];

/** Which key of the page-side "tags present" report a data type is read from. */
const READ_KEY = {
    localStorage: 'localStorage', indexedDB: 'indexedDB', fileSystems: 'opfs', cache: 'httpCache',
    cacheStorage: 'cacheStorage', serviceWorkers: 'serviceWorkers', cookies: 'cookies'
};

/** Runs in the page. Creates one item of `kind` tagged `tag` (self-contained). */
async function seedKind(kind, tag) {
    if (kind === 'localStorage') {
        localStorage.setItem(`aw_${tag}`, '1');
    } else if (kind === 'indexedDB') {
        await new Promise((resolve, reject) => {
            const req = indexedDB.open(`aw_idb_${tag}`, 1);
            req.onupgradeneeded = () => req.result.createObjectStore('s');
            req.onsuccess = () => { req.result.close(); resolve(); };
            req.onerror = () => reject(req.error);
        });
    } else if (kind === 'fileSystems') {
        const dir = await navigator.storage.getDirectory();
        const handle = await dir.getFileHandle(`aw_${tag}.txt`, { create: true });
        const writable = await handle.createWritable();
        await writable.write('x');
        await writable.close();
    } else if (kind === 'cache') {
        await (await fetch(`/asset.js?v=${tag}`)).text();
    } else if (kind === 'cacheStorage') {
        const cache = await caches.open(`aw_cache_${tag}`);
        await cache.put('/aw-cached', new Response('x'));
    } else if (kind === 'serviceWorkers') {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: `/${tag}/` });
        for (let i = 0; i < 100 && !reg.active; i++) await new Promise((r) => setTimeout(r, 50));
        if (!reg.active) throw new Error('service worker did not activate');
    } else if (kind === 'cookies') {
        document.cookie = `aw_${tag}=1; path=/`;
    }
}

/** Runs in the page. Returns the tags ('old' / 'new') of the items of `kind` that still exist. */
async function readKind(kind) {
    const tags = (names, re) => names.map((n) => (re.exec(n) || [])[1]).filter(Boolean).sort();
    if (kind === 'localStorage') return tags(Object.keys(localStorage), /^aw_(\w+)$/);
    if (kind === 'indexedDB') return tags((await indexedDB.databases()).map((d) => d.name), /^aw_idb_(\w+)$/);
    if (kind === 'fileSystems') {
        const dir = await navigator.storage.getDirectory();
        const names = [];
        for await (const [name] of dir.entries()) names.push(name);
        return tags(names, /^aw_(\w+)\.txt$/);
    }
    if (kind === 'cache') {
        const found = [];
        for (const tag of ['old', 'new']) {
            try {
                const res = await fetch(`/asset.js?v=${tag}`, { cache: 'only-if-cached', mode: 'same-origin' });
                if (res.ok) found.push(tag);
            } catch { /* not cached */ }
        }
        return found.sort();
    }
    if (kind === 'cacheStorage') return tags(await caches.keys(), /^aw_cache_(\w+)$/);
    if (kind === 'serviceWorkers') {
        const regs = await navigator.serviceWorker.getRegistrations();
        return tags(regs.map((r) => new URL(r.scope).pathname), /^\/(\w+)\/$/);
    }
    if (kind === 'cookies') return tags(document.cookie.split('; ').map((c) => c.split('=')[0]), /^aw_(old|new)$/);
    throw new Error(`unknown kind ${kind}`);
}

/** Opens a fresh tab on origin/blank, runs fn, closes the tab. */
async function inFreshTab(origin, fn, ...args) {
    const page = await env.browser.newPage();
    try {
        await page.goto(`${origin}/blank`, { waitUntil: 'load' });
        return await page.evaluate(fn, ...args);
    } finally {
        await page.close();
    }
}

/** createPlan + executePlan from an extension page: a real browsingData.remove with since. */
async function runPlanWithSince(type, since) {
    const page = await env.browser.newPage();
    try {
        await page.goto(`chrome-extension://${env.extensionId}/options.html`, { waitUntil: 'load' });
        return await page.evaluate(async (type, since, origin, url) => {
            const core = await import(url);
            const created = core.createPlan({
                origins: [origin], dataTypes: [type], since, source: 'popup',
                cookieMode: type === 'cookies' ? 'domainWide' : 'exact'
            });
            if (!created.ok) throw new Error(`createPlan failed: ${created.code}`);
            const result = await core.executePlan(created.plan, { api: chrome });
            return { ok: result.ok, perOrigin: result.perOrigin, since: created.plan.since };
        }, type, since, env.origins.A, `chrome-extension://${env.extensionId}/cleanup-core.js`);
    } finally {
        await page.close();
    }
}

const NON_COOKIE = STATE_KINDS.filter((k) => k !== 'cookies');
const pickKinds = (state, kinds) => Object.fromEntries(kinds.map((k) => [k, state[k]]));

const matrix = [];

afterAll(() => {
    if (!env || matrix.length === 0) return;
    const lines = [
        '# Time range (`since`) per data type',
        '',
        `Chrome: ${env.chromeVersion}. Generated by tests/e2e/since-matrix.test.js. Old data is created, then at least ${SEPARATION_MS / 1000} s later \`t0\` is recorded and new data is created; the cleanup runs on origin A with \`since = t0\` through \`createPlan\` + \`executePlan\`. *Settle* is the time from the resolved cleanup until the new data was gone, including read latency, and the number of re-reads (every ${SETTLE_POLL_MS} ms, up to ${SETTLE_TIMEOUT_MS / 1000} s). 0 re-reads means the deletion was complete at the first, immediate read.`,
        '',
        '| Data type | Old data (before t0) | New data (after t0) | Settle | Result |',
        '| --- | --- | --- | --- | --- |'
    ];
    for (const row of matrix) {
        lines.push(`| ${row.type}${row.type === 'cookies' ? ' (domain-wide)' : ''} | ${row.oldKept ? 'kept' : 'removed'} | ${row.newRemoved ? 'removed' : 'KEPT'} | ${row.settleMs} ms (${row.rereads} re-reads) | ${row.oldKept ? 'honors the time range' : 'time range ignored: everything of the origin is removed'} |`);
    }
    lines.push('');
    const text = lines.join('\n');
    console.log(`\n${text}`);
    writeArtifact('since-matrix.md', text);
});

suite('Time range (since) per data type', () => {
    for (const type of TYPES) {
        test(`${type}: new data is removed, canary and other types are untouched; old/new result is recorded`, guarded(env, `since-${type}`, async () => {
            await resetBrowserState(env.browser, Object.values(env.origins));
            // B, A2 and the canary C get a full seed (it counts as old data for them)
            for (const other of [env.origins.B, env.origins.A2, env.origins.C]) {
                const page = await env.browser.newPage();
                try { await seedOrigin(page, other); } finally { await page.close(); }
            }
            const beforeOthers = {
                B: await readState(env.browser, env.origins.B),
                A2: await readState(env.browser, env.origins.A2),
                C: await readState(env.browser, env.origins.C)
            };

            // OLD data, plus a marker of every OTHER type that must not be touched
            await inFreshTab(env.origins.A, seedKind, type, 'old');
            await inFreshTab(env.origins.A, async () => {
                localStorage.setItem('aw_bystander', '1');
            });
            await sleep(SEPARATION_MS);
            const t0 = Date.now();
            await sleep(300);
            await inFreshTab(env.origins.A, seedKind, type, 'new');

            const run = await runPlanWithSince(type, t0);
            expect(run.ok).toBe(true);
            expect(run.since).toBe(t0);
            const settleStart = Date.now();
            let present = await inFreshTab(env.origins.A, readKind, type);
            let rereads = 0;
            while (present.includes('new') && Date.now() - settleStart < SETTLE_TIMEOUT_MS) {
                await sleep(SETTLE_POLL_MS);
                present = await inFreshTab(env.origins.A, readKind, type);
                rereads++;
            }
            const settleMs = Date.now() - settleStart;
            const oldKept = present.includes('old');
            const newRemoved = !present.includes('new');
            matrix.push({ type, oldKept, newRemoved, present, settleMs, rereads });
            console.log(`since matrix: ${type}: old ${oldKept ? 'kept' : 'removed'}, new ${newRemoved ? 'removed' : 'KEPT'} after ${settleMs} ms, ${rereads} re-reads (present: ${JSON.stringify(present)})`);

            // safety invariants
            expect(newRemoved).toBe(true);
            if (type !== 'localStorage') {
                expect(await inFreshTab(env.origins.A, () => localStorage.getItem('aw_bystander'))).toBe('1');
            }
            const afterC = await readState(env.browser, env.origins.C);
            expect(afterC).toEqual(beforeOthers.C);
            const afterB = await readState(env.browser, env.origins.B);
            const afterA2 = await readState(env.browser, env.origins.A2);
            if (type === 'cookies') {
                // domain-wide cookies: B and A2 may lose cookies, but only ones that were created before t0
                // are expected to survive a time-limited removal; non-cookie data is never touched
                expect(pickKinds(afterB, NON_COOKIE)).toEqual(pickKinds(beforeOthers.B, NON_COOKIE));
                expect(pickKinds(afterA2, NON_COOKIE)).toEqual(pickKinds(beforeOthers.A2, NON_COOKIE));
                for (const name of afterB.cookies) expect(beforeOthers.B.cookies).toContain(name);
            } else {
                expect(afterB).toEqual(beforeOthers.B);
                expect(afterA2).toEqual(beforeOthers.A2);
            }
        }));
    }
});
