/**
 * AW Browser Cleaner - automation examples, tested
 * ================================================
 *
 * The code blocks between `// docs:begin <name>` and `// docs:end <name>` markers are copied
 * into docs/automation.md. tests/unit/docs-snippets.test.js fails when the document and this
 * file drift apart, so the documented snippets are always the ones that run here.
 *
 * Two examples:
 *
 *  1. cdp-clear        Storage.clearDataForOrigin through a CDP session clears one origin and
 *                      leaves another origin (localhost:<port2>) untouched. No extension needed.
 *  2. test-mode-*      The Test Mode message protocol (ping / clean) from a local page.
 *
 * Environment:
 *  - AW_CHROME_PATH   Chromium / Chrome for Testing binary (branded Chrome >= 137 ignores
 *                     extension loading, which example 2 needs).
 *  - CI=true          A missing binary fails the run. Locally, without AW_CHROME_PATH, the
 *                     tests are skipped with a visible banner.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(HERE, '..', '..');

function isCI() {
    const v = String(process.env.CI || '').toLowerCase();
    return v !== '' && v !== '0' && v !== 'false';
}

function banner(lines) {
    const bar = '='.repeat(78);
    console.warn(`\n${bar}\n${lines.join('\n')}\n${bar}\n`);
}

/** Starts a server on 127.0.0.1 with a free port that answers every path with a tiny page. */
async function startServer() {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('<!doctype html><meta charset="utf-8"><title>aw automation fixture</title><p>fixture</p>');
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    return { server, port: server.address().port };
}

/** Creates localStorage, IndexedDB and Cache Storage data in the page's origin. */
async function seed(page) {
    await page.evaluate(async () => {
        localStorage.setItem('aw_ls', 'seed');
        await new Promise((resolve, reject) => {
            const open = indexedDB.open('aw_idb', 1);
            open.onupgradeneeded = () => open.result.createObjectStore('items');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
                const db = open.result;
                const tx = db.transaction('items', 'readwrite');
                tx.objectStore('items').put('seed', 'key');
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => reject(tx.error);
            };
        });
        const cache = await caches.open('aw_cache');
        await cache.put('/seed.txt', new Response('seed'));
    });
}

/** Counts what is left, from a freshly loaded page of the origin. */
async function readState(page, url) {
    await page.goto(url, { waitUntil: 'load' });
    return page.evaluate(async () => ({
        localStorage: localStorage.length,
        indexedDB: (await indexedDB.databases()).length,
        cacheStorage: (await caches.keys()).length
    }));
}

const chromePath = process.env.AW_CHROME_PATH;
const problem = !chromePath
    ? 'AW_CHROME_PATH is not set. Point it at a Chromium / Chrome for Testing binary.'
    : (!fs.existsSync(chromePath) ? `AW_CHROME_PATH points to a file that does not exist: ${chromePath}` : '');

if (problem && !isCI()) {
    banner(['AW automation examples: SKIPPED - ' + problem, 'These tests are skipped locally. In CI they fail instead.']);
    test.skip(`automation examples skipped: ${problem}`, () => {});
} else if (problem) {
    banner(['AW automation examples: ENVIRONMENT ERROR (CI: run fails)', problem]);
    test('automation examples need a Chrome binary (AW_CHROME_PATH)', () => {
        throw new Error(problem);
    });
} else {
    const puppeteer = (await import('puppeteer')).default;

    describe('automation examples', () => {
        let browser;
        let profileDir;
        let target;   // { server, port } - origin whose data is cleaned: http://127.0.0.1:<port>
        let other;    // { server, port } - bystander origin: http://localhost:<port2>

        beforeAll(async () => {
            target = await startServer();
            other = await startServer();
            profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-automation-profile-'));
            browser = await puppeteer.launch({
                executablePath: chromePath,
                headless: true,
                pipe: true,
                enableExtensions: true,
                userDataDir: profileDir,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--enable-unsafe-extension-debugging',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-background-networking',
                    '--disable-component-update',
                    '--password-store=basic'
                ],
                timeout: 60000
            });
        }, 90000);

        afterAll(async () => {
            try { await browser?.close(); } catch { /* already closed */ }
            await Promise.all([target, other].map((s) => s && new Promise((resolve) => s.server.close(resolve))));
            if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true });
        });

        test('CDP Storage.clearDataForOrigin clears one origin and leaves another untouched', async () => {
            const origin = `http://127.0.0.1:${target.port}`;
            const otherOrigin = `http://localhost:${other.port}`;

            const page = await browser.newPage();
            const otherPage = await browser.newPage();
            await page.goto(`${origin}/`, { waitUntil: 'load' });
            await otherPage.goto(`${otherOrigin}/`, { waitUntil: 'load' });
            await seed(page);
            await seed(otherPage);
            expect(await readState(page, `${origin}/`)).toEqual({ localStorage: 1, indexedDB: 1, cacheStorage: 1 });

            // docs:begin cdp-clear
            const client = await page.createCDPSession();
            await client.send('Storage.clearDataForOrigin', {
                origin,
                storageTypes: 'local_storage,indexeddb,cache_storage'
            });
            // docs:end cdp-clear

            expect(await readState(page, `${origin}/`)).toEqual({ localStorage: 0, indexedDB: 0, cacheStorage: 0 });
            expect(await readState(otherPage, `${otherOrigin}/`)).toEqual({ localStorage: 1, indexedDB: 1, cacheStorage: 1 });
            await page.close();
            await otherPage.close();
        }, 60000);

        test('Test Mode: ping, refusal while disabled, then a scoped clean of the sender origin only', async () => {
            const EXTENSION_ID = await browser.installExtension(EXTENSION_PATH);
            expect(EXTENSION_ID).toMatch(/^[a-p]{32}$/);

            // Extension page used only to configure storage (what the Options page does).
            const options = await browser.newPage();
            await options.goto(`chrome-extension://${EXTENSION_ID}/options.html`, { waitUntil: 'load' });

            const origin = `http://127.0.0.1:${target.port}`;
            const page = await browser.newPage();
            await page.goto(`${origin}/`, { waitUntil: 'load' });
            await seed(page);

            // docs:begin test-mode-ping
            const ping = await page.evaluate(
                (id) => chrome.runtime.sendMessage(id, { action: 'ping' }),
                EXTENSION_ID
            );
            // docs:end test-mode-ping
            expect(ping).toEqual({ ok: true, enabled: false });

            // A custom preset without cookies, session storage or an after-action.
            await options.evaluate(() => chrome.storage.sync.set({
                'aw.preset.client-state': {
                    id: 'client-state',
                    name: 'Client state',
                    dataTypes: ['localStorage', 'indexedDB', 'cacheStorage'],
                    cookieMode: 'exact',
                    after: 'none',
                    startPath: '/'
                }
            }));

            const disabled = await page.evaluate(
                (id) => chrome.runtime.sendMessage(id, { action: 'clean', preset: 'client-state' }),
                EXTENSION_ID
            );
            expect(disabled).toEqual({ ok: false, error: 'TEST_MODE_DISABLED' });
            expect((await readState(page, `${origin}/`)).localStorage).toBe(1);

            // Turn Test Mode on for 127.0.0.1 (Options -> Test Mode does the same).
            await options.evaluate(() => chrome.storage.local.set({
                'aw.testMode': { enabled: true, allowedOrigins: ['http://127.0.0.1'] }
            }));

            // docs:begin test-mode-clean
            const response = await page.evaluate(
                (id) => chrome.runtime.sendMessage(id, { action: 'clean', preset: 'client-state' }),
                EXTENSION_ID
            );
            // docs:end test-mode-clean
            expect(response.ok).toBe(true);
            expect(response.origin).toBe(origin);
            expect(response.presetId).toBe('client-state');
            expect(response.result.perOrigin).toHaveLength(1);
            expect(response.result.perOrigin[0].origin).toBe(origin);
            expect(response.result.perOrigin[0].types).toEqual({
                localStorage: 'ok', indexedDB: 'ok', cacheStorage: 'ok'
            });
            expect(response.dropped).toEqual([]);
            expect(await readState(page, `${origin}/`)).toEqual({ localStorage: 0, indexedDB: 0, cacheStorage: 0 });

            // A domain-wide cookie preset is refused.
            await options.evaluate(() => chrome.storage.sync.set({
                'aw.preset.wide': {
                    id: 'wide', name: 'Wide', dataTypes: ['cookies'], cookieMode: 'domainWide', after: 'none', startPath: '/'
                }
            }));
            const wide = await page.evaluate(
                (id) => chrome.runtime.sendMessage(id, { action: 'clean', preset: 'wide' }),
                EXTENSION_ID
            );
            expect(wide.ok).toBe(false);
            expect(wide.error).toBe('DOMAIN_WIDE_NOT_ALLOWED');

            // An origin named in the payload is ignored: the sender's own origin is cleaned.
            const sneaky = await page.evaluate(
                (id) => chrome.runtime.sendMessage(id, { action: 'clean', preset: 'client-state', origin: 'https://example.com' }),
                EXTENSION_ID
            );
            expect(sneaky.origin).toBe(origin);
            expect(sneaky.ignoredPayloadOrigin).toBe(true);

            // A page that is not on the allow-list is refused.
            const otherPage = await browser.newPage();
            await otherPage.goto(`http://localhost:${other.port}/`, { waitUntil: 'load' });
            const refused = await otherPage.evaluate(
                (id) => chrome.runtime.sendMessage(id, { action: 'clean', preset: 'client-state' }),
                EXTENSION_ID
            );
            expect(refused).toEqual({ ok: false, error: 'ORIGIN_NOT_ALLOWED' });

            await options.close();
            await page.close();
            await otherPage.close();
        }, 90000);
    });
}
