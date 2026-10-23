/**
 * AW Browser Cleaner - shared E2E helpers
 * =======================================
 *
 * README: fixture topology
 * ------------------------
 * Two local HTTP servers (random free ports P1 and P2, bound to 127.0.0.1) are started per
 * test file. Chrome is launched with `--host-resolver-rules="MAP *.localtest.me 127.0.0.1"`
 * so no DNS is needed, and with `--unsafely-treat-insecure-origin-as-secure` for the
 * localtest.me origins so Service Workers, Cache Storage and OPFS work over plain http.
 *
 *   origin   URL                          role
 *   -------  ---------------------------  -------------------------------------------------
 *   A        http://a.localtest.me:P1     the cleanup TARGET
 *   B        http://b.localtest.me:P1     sibling subdomain (same registrable domain
 *                                         localtest.me, same port)
 *   A2       http://a.localtest.me:P2     port variant of A (same host, other port)
 *   C        http://127.0.0.1:P2          CANARY, different host, must never be touched
 *
 * Every origin serves:
 *   /seed                     blank page; sets the HttpOnly cookie `aw_httponly` via Set-Cookie
 *   /blank                    blank page (no side effects), used for reading state
 *   /asset.js                 Cache-Control: max-age=3600, counted per origin
 *   /__count?path=/asset.js   JSON {count} - requests the server saw for that path on that origin
 *   /sw.js                    trivial Service Worker
 *   /with-canary-iframe       embeds the canary in a cross-origin iframe (/frame-seed sets
 *                             sessionStorage inside that frame)
 *   /with-same-origin-iframe  embeds the SAME origin's /frame-seed in an iframe
 *   /with-asset               page that loads /asset.js as a subresource (cache / reload tests)
 *
 * `seedOrigin(page, origin)` creates, on that origin: host-only cookie `aw_host`, HttpOnly
 * cookie `aw_httponly`, Domain=localtest.me cookie `aw_shared` (localtest.me hosts only),
 * localStorage `aw_ls`, sessionStorage `aw_ss` (that tab only), IndexedDB `aw_idb`, Cache
 * Storage `aw_cache`, OPFS file `aw_opfs.txt`, a Service Worker registration and one fetch
 * of /asset.js (so it sits in the HTTP cache).
 *
 * `readState(browser, origin, { page })` reports what is left, from a fresh tab (or from
 * `page` when sessionStorage of an existing tab matters).
 *
 * Cookies are not isolated by port or by subdomain (RFC 6265), so A, A2 and B share the
 * `aw_shared` cookie and A/A2 share every cookie. In domain-wide cookie mode a cookie cleanup of A
 * is EXPECTED to remove the cookies of B and A2 too (registrable-domain behaviour); Exact Cookie
 * Mode removes only the host-only cookies of A. Either way the canary C must stay untouched.
 *
 * Popup note: opened as a tab, the popup is its own active tab, so it shows the "unsupported page"
 * screen; helpers continue from there with a typed target (openPopupPage) or stub the active tab
 * (openPopupForTab). Host access (needed by Exact Cookie Mode and for scripting the active tab)
 * is an optional permission whose prompt cannot be answered in automation, so those tests use
 * `launchE2E({ hostAccess: true })`, which installs a copy of the extension whose manifest lists
 * http(s) host_permissions. Nothing else differs from the shipped extension.
 *
 * Typical test file:
 *
 *   import { describe, test, expect, afterAll } from 'bun:test';
 *   import { launchE2E, seedOrigin, readState, openPopupPage, setTarget, ... } from './helpers.js';
 *   const env = await launchE2E();           // null => skipped locally (or failing test in CI)
 *   afterAll(() => env?.close());
 *   (env ? describe : describe.skip)('suite', () => { ... });
 *
 * Failure policy: when `CI` is set, a missing Chrome, a failed launch or an extension that
 * did not load makes the run FAIL. Locally without Chrome the suites are skipped with a loud
 * banner on stderr. Point AW_CHROME_PATH at an unbranded Chrome / Chromium / Chrome for
 * Testing binary. Branded Chrome >= 137 ignores --load-extension, so the extension is
 * installed through puppeteer's `browser.installExtension()` (pipe transport).
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'bun:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION_PATH = path.resolve(HERE, '..', '..');
export const ARTIFACTS_DIR = path.join(EXTENSION_PATH, 'test-artifacts');

/** Cookie / storage names created by seedOrigin. */
export const SEED = {
    cookieHost: 'aw_host',
    cookieHttpOnly: 'aw_httponly',
    cookieShared: 'aw_shared',
    localStorage: 'aw_ls',
    sessionStorage: 'aw_ss',
    indexedDB: 'aw_idb',
    cacheStorage: 'aw_cache',
    opfs: 'aw_opfs.txt'
};

/** State kinds reported by readState and compared by the matrix. */
export const STATE_KINDS = ['cookies', 'localStorage', 'indexedDB', 'cacheStorage', 'serviceWorkers', 'opfs', 'httpCache'];

export function isCI() {
    const v = String(process.env.CI || '').toLowerCase();
    return v !== '' && v !== '0' && v !== 'false';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Fixture servers
// ---------------------------------------------------------------------------

const SW_SOURCE = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
`;

function htmlPage(title, body = '') {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
}

/**
 * Starts the fixture servers and returns the origins and helpers.
 * @returns {Promise<{origins: {A:string,B:string,A2:string,C:string}, ports: {p1:number,p2:number},
 *   requestCount: (origin:string, urlPath?:string) => number, iframePageUrl: (origin:string) => string,
 *   insecureAsSecure: string[], close: () => Promise<void>}>}
 */
export async function startFixtures() {
    /** `${host:port}${path}` -> number of requests served. */
    const counts = new Map();
    let canaryOrigin = '';

    const handler = (req, res) => {
        const host = req.headers.host || '';
        const url = new URL(req.url, `http://${host}`);
        const p = url.pathname;
        const send = (status, type, body, extra = {}) => {
            res.writeHead(status, { 'Content-Type': type, ...extra });
            res.end(body);
        };

        if (p === '/__count') {
            const target = url.searchParams.get('path') || '/';
            const count = counts.get(`${host}${target}`) || 0;
            return send(200, 'application/json', JSON.stringify({ origin: `http://${host}`, path: target, count }), { 'Cache-Control': 'no-store' });
        }
        if (p === '/favicon.ico') return send(204, 'image/x-icon', '');

        counts.set(`${host}${p}`, (counts.get(`${host}${p}`) || 0) + 1);

        switch (p) {
            case '/seed':
                return send(200, 'text/html; charset=utf-8', htmlPage('seed', '<h1>seeded</h1>'), {
                    'Cache-Control': 'no-store',
                    'Set-Cookie': `${SEED.cookieHttpOnly}=1; Path=/; HttpOnly; SameSite=Lax`
                });
            case '/blank':
                return send(200, 'text/html; charset=utf-8', htmlPage('blank'), { 'Cache-Control': 'no-store' });
            case '/asset.js':
                return send(200, 'application/javascript', '/* aw asset */', { 'Cache-Control': 'public, max-age=3600' });
            case '/sw.js':
                return send(200, 'application/javascript', SW_SOURCE, { 'Cache-Control': 'no-cache' });
            case '/with-canary-iframe':
                return send(200, 'text/html; charset=utf-8',
                    htmlPage('iframe host', `<iframe id="canary" src="${canaryOrigin}/frame-seed" width="300" height="100"></iframe>`),
                    { 'Cache-Control': 'no-store' });
            case '/with-same-origin-iframe':
                return send(200, 'text/html; charset=utf-8',
                    htmlPage('same-origin iframe host', '<iframe id="same" src="/frame-seed" width="300" height="100"></iframe>'),
                    { 'Cache-Control': 'no-store' });
            case '/with-asset':
                return send(200, 'text/html; charset=utf-8',
                    htmlPage('asset host', '<script src="/asset.js"></script>'),
                    { 'Cache-Control': 'no-store' });
            case '/frame-seed':
                return send(200, 'text/html; charset=utf-8',
                    htmlPage('frame', `<script>sessionStorage.setItem('${SEED.sessionStorage}', 'frame');</script>`),
                    { 'Cache-Control': 'no-store' });
            default:
                return send(404, 'text/plain', 'not found');
        }
    };

    const server1 = http.createServer(handler);
    const server2 = http.createServer(handler);
    const [p1, p2] = await Promise.all([listen(server1), listen(server2)]);

    const origins = {
        A: `http://a.localtest.me:${p1}`,
        B: `http://b.localtest.me:${p1}`,
        A2: `http://a.localtest.me:${p2}`,
        C: `http://127.0.0.1:${p2}`
    };
    canaryOrigin = origins.C;

    return {
        origins,
        ports: { p1, p2 },
        insecureAsSecure: [origins.A, origins.B, origins.A2],
        requestCount(origin, urlPath = '/asset.js') {
            return counts.get(`${new URL(origin).host}${urlPath}`) || 0;
        },
        iframePageUrl(origin) {
            return `${origin}/with-canary-iframe`;
        },
        sameOriginIframePageUrl(origin) {
            return `${origin}/with-same-origin-iframe`;
        },
        assetPageUrl(origin) {
            return `${origin}/with-asset`;
        },
        async close() {
            await Promise.all([server1, server2].map((s) => new Promise((resolve) => {
                s.closeAllConnections?.();
                s.close(() => resolve());
            })));
        }
    };
}

// ---------------------------------------------------------------------------
// Chrome resolution, launch, extension loading
// ---------------------------------------------------------------------------

/** Per-browser bookkeeping: console logs and open popup pages. */
const stateByBrowser = new WeakMap();

function browserState(browser) {
    let s = stateByBrowser.get(browser);
    if (!s) {
        s = { logs: [], popups: new Set() };
        stateByBrowser.set(browser, s);
    }
    return s;
}

function attachLogging(browser, page) {
    const { logs } = browserState(browser);
    const tag = () => { try { return page.url(); } catch { return '?'; } };
    page.on('console', (msg) => logs.push(`[${new Date().toISOString()}] console.${msg.type()} ${tag()} ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`[${new Date().toISOString()}] pageerror ${tag()} ${err && err.stack ? err.stack : err}`));
    page.on('requestfailed', (req) => logs.push(`[${new Date().toISOString()}] requestfailed ${req.url()} ${req.failure()?.errorText ?? ''}`));
}

/** Console output collected from every page of this browser so far. */
export function getLogs(browser) {
    return browserState(browser).logs.slice();
}

/**
 * Finds the Chrome binary. In CI AW_CHROME_PATH is mandatory (Chrome for Testing is installed
 * by the workflow). Locally AW_CHROME_PATH wins, then puppeteer's own browser cache.
 * @returns {{path?: string, source?: string, error?: string, skippable?: boolean}}
 */
export function resolveChrome(puppeteer) {
    const fromEnv = process.env.AW_CHROME_PATH;
    if (fromEnv) {
        if (!fs.existsSync(fromEnv)) return { error: `AW_CHROME_PATH points to a file that does not exist: ${fromEnv}` };
        return { path: fromEnv, source: 'AW_CHROME_PATH' };
    }
    if (isCI()) {
        return { error: 'AW_CHROME_PATH is not set. CI must install Chrome for Testing (see .github/workflows/ci.yml) and export its path.' };
    }
    try {
        const p = puppeteer.executablePath();
        if (p && fs.existsSync(p)) return { path: p, source: 'puppeteer browser cache' };
    } catch { /* no cached browser */ }
    return {
        skippable: true,
        error: 'No Chrome found. Set AW_CHROME_PATH to an unbranded Chrome / Chromium / Chrome for Testing binary, ' +
            'or run `bunx @puppeteer/browsers install chrome@stable`.'
    };
}

/**
 * Launches Chrome with the extension and the fixture servers.
 * Throws on any problem; callers normally use launchE2E() instead.
 */
export async function launchBrowser({ puppeteer, chromePath, fixtures }) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-e2e-profile-'));
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-unsafe-extension-debugging',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-search-engine-choice-screen',
        '--disable-background-networking',
        '--disable-component-update',
        '--password-store=basic',
        '--host-resolver-rules=MAP *.localtest.me 127.0.0.1',
        `--unsafely-treat-insecure-origin-as-secure=${fixtures.insecureAsSecure.join(',')}`
    ];
    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        pipe: true,
        enableExtensions: true,
        userDataDir,
        args,
        timeout: 60000
    });
    browser.__awUserDataDir = userDataDir;
    browserState(browser);

    // Capture logs of every page, including popups opened by the tests and extension workers.
    browser.on('targetcreated', async (target) => {
        try {
            if (target.type() === 'page') {
                const page = await target.page();
                if (page) attachLogging(browser, page);
            } else if (target.type() === 'service_worker') {
                const worker = await target.worker();
                worker?.on?.('console', (msg) => browserState(browser).logs.push(`[sw] console.${msg.type()} ${target.url()} ${msg.text()}`));
            }
        } catch { /* target vanished */ }
    });
    for (const page of await browser.pages()) attachLogging(browser, page);

    return browser;
}

/**
 * Copies the unpacked extension to a temp dir with `host_permissions` for http(s). Optional host
 * permissions cannot be granted in automation (the permission prompt never resolves), so tests of
 * Exact Cookie Mode and of the active-tab features run against this copy. Only the manifest differs.
 */
export function prepareHostAccessCopy(patchManifest) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-e2e-ext-'));
    for (const entry of fs.readdirSync(EXTENSION_PATH, { withFileTypes: true })) {
        const from = path.join(EXTENSION_PATH, entry.name);
        if (entry.isFile() && /\.(js|html|css|json)$/.test(entry.name) && entry.name !== 'package.json' && entry.name !== 'bun.lock') {
            fs.copyFileSync(from, path.join(dir, entry.name));
        } else if (entry.isDirectory() && ['_locales', 'icons', 'fonts'].includes(entry.name)) {
            fs.cpSync(from, path.join(dir, entry.name), { recursive: true });
        }
    }
    const manifestPath = path.join(dir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.host_permissions = ['http://*/*', 'https://*/*'];
    delete manifest.optional_host_permissions;
    if (typeof patchManifest === 'function') patchManifest(manifest);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return dir;
}

/**
 * Installs the unpacked extension and proves it is really loaded. Returns its id.
 * `incognito: true` loads it with "Allow in Incognito" already on (CDP Extensions.loadUnpacked
 * enableInIncognito); toggling the setting afterwards has no effect in recent Chrome for Testing.
 */
export async function loadExtension(browser, extensionPath = EXTENSION_PATH, { incognito = false } = {}) {
    const install = incognito
        ? browser.installExtension(extensionPath, { enabledInIncognito: true })
        : browser.installExtension(extensionPath);
    const id = await withTimeout(install, 30000, 'browser.installExtension');
    if (!/^[a-p]{32}$/.test(id)) throw new Error(`Extension id looks wrong: ${id}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
    const page = await browser.newPage();
    try {
        const response = await page.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'load', timeout: 20000 });
        await page.waitForSelector('body[data-screen]', { timeout: 10000 });
        if (!response || !response.ok()) throw new Error(`popup.html did not load from the installed extension (${id}).`);
        const runtimeId = await page.evaluate(() => (typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : null));
        if (runtimeId !== id) throw new Error(`chrome.runtime.id is ${runtimeId} on the popup page, expected ${id}; the extension did not load.`);
        const version = await page.evaluate(() => chrome.runtime.getManifest().version);
        if (version !== manifest.version) throw new Error(`Loaded extension version ${version} differs from manifest.json ${manifest.version}.`);
    } finally {
        await page.close();
    }
    return id;
}

function banner(lines) {
    const bar = '='.repeat(78);
    console.warn(`\n${bar}\n${lines.join('\n')}\n${bar}\n`);
}

/**
 * Prepares the whole E2E environment (fixture servers, Chrome, extension).
 *
 * Returns a context object, or `null` when the suites must not run:
 *  - CI set:     any problem registers a FAILING test and returns null (the run fails loudly).
 *  - local:      no Chrome available => a loud banner and a skipped placeholder test; any other
 *                problem (Chrome present but launch/extension broken) still fails.
 *
 * Call it with top-level await at the start of a test file.
 */
export async function launchE2E({ hostAccess = false, patchManifest, incognito = false } = {}) {
    let fixtures;
    let browser;
    let extensionCopy;
    const fail = (error) => {
        const message = error instanceof Error ? error.message : String(error);
        banner(['AW E2E: ENVIRONMENT ERROR' + (isCI() ? ' (CI: run fails)' : ''), message]);
        test('E2E environment must be available (Chrome launches and the extension loads)', () => {
            throw error instanceof Error ? error : new Error(message);
        });
        return Promise.allSettled([browser?.close(), fixtures?.close()]).then(() => null);
    };

    let puppeteer;
    try {
        puppeteer = (await import('puppeteer')).default;
    } catch (e) {
        if (isCI()) return fail(new Error(`puppeteer could not be imported: ${e.message}`));
        banner(['AW E2E: SKIPPED - puppeteer is not installed (run `bun install`).']);
        test.skip('E2E skipped: puppeteer is not installed', () => {});
        return null;
    }

    const chrome = resolveChrome(puppeteer);
    if (chrome.error) {
        if (chrome.skippable) {
            banner(['AW E2E: SKIPPED - ' + chrome.error, 'These tests are skipped locally. In CI they fail instead.']);
            test.skip(`E2E skipped: ${chrome.error}`, () => {});
            return null;
        }
        return fail(new Error(chrome.error));
    }

    try {
        fixtures = await startFixtures();
        browser = await withTimeout(launchBrowser({ puppeteer, chromePath: chrome.path, fixtures }), 90000, 'Chrome launch');
        extensionCopy = hostAccess ? prepareHostAccessCopy(patchManifest) : undefined;
        const extensionId = await loadExtension(browser, extensionCopy, { incognito });
        const chromeVersion = await browser.version();
        console.log(`AW E2E: ${chromeVersion} (${chrome.source}: ${chrome.path}), extension ${extensionId}, ` +
            `origins ${Object.values(fixtures.origins).join(' ')}`);
        return {
            browser,
            extensionId,
            fixtures,
            origins: fixtures.origins,
            chromeVersion,
            chromePath: chrome.path,
            hostAccess,
            async close() {
                try { await browser.close(); } catch { /* already closed */ }
                await fixtures.close();
                try { fs.rmSync(browser.__awUserDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
                if (extensionCopy) {
                    try { fs.rmSync(extensionCopy, { recursive: true, force: true }); } catch { /* best effort */ }
                }
            }
        };
    } catch (e) {
        return fail(new Error(`E2E environment failed to start with ${chrome.path}: ${e && e.message ? e.message : e}`));
    }
}

// ---------------------------------------------------------------------------
// Seeding and reading state
// ---------------------------------------------------------------------------

/** Runs inside the page. Must be self-contained. */
async function seedInPage(names) {
    const failed = [];
    const attempt = async (label, fn) => {
        try { await fn(); } catch (e) { failed.push(`${label}: ${e && e.message ? e.message : e}`); }
    };
    await attempt('cookies', async () => {
        document.cookie = `${names.cookieHost}=1; path=/`;
        if (location.hostname.endsWith('localtest.me')) {
            document.cookie = `${names.cookieShared}=1; domain=localtest.me; path=/`;
        }
    });
    await attempt('localStorage', async () => localStorage.setItem(names.localStorage, '1'));
    await attempt('sessionStorage', async () => sessionStorage.setItem(names.sessionStorage, '1'));
    await attempt('indexedDB', () => new Promise((resolve, reject) => {
        const req = indexedDB.open(names.indexedDB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('s');
        req.onsuccess = () => { req.result.close(); resolve(); };
        req.onerror = () => reject(req.error);
    }));
    await attempt('cacheStorage', async () => {
        const cache = await caches.open(names.cacheStorage);
        await cache.put('/aw-cached', new Response('x'));
    });
    await attempt('opfs', async () => {
        const dir = await navigator.storage.getDirectory();
        const handle = await dir.getFileHandle(names.opfs, { create: true });
        const writable = await handle.createWritable();
        await writable.write('x');
        await writable.close();
    });
    await attempt('serviceWorker', async () => {
        await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
    });
    await attempt('httpCache', async () => {
        const res = await fetch('/asset.js');
        await res.text();
    });
    return { failed };
}

/** Runs inside the page. Must be self-contained. */
async function readInPage() {
    const out = {};
    const safe = async (key, fn, fallback) => {
        try { out[key] = await fn(); } catch (e) { out[key] = fallback; out.errors = (out.errors || []).concat(`${key}: ${e && e.message ? e.message : e}`); }
    };
    await safe('localStorage', async () => Object.fromEntries(Object.entries(localStorage)), {});
    await safe('sessionStorage', async () => Object.fromEntries(Object.entries(sessionStorage)), {});
    await safe('indexedDB', async () => (await indexedDB.databases()).map((d) => d.name).sort(), []);
    await safe('cacheStorage', async () => (await caches.keys()).sort(), []);
    await safe('serviceWorkers', async () => (await navigator.serviceWorker.getRegistrations()).length, 0);
    await safe('opfs', async () => {
        const dir = await navigator.storage.getDirectory();
        const names = [];
        for await (const [name] of dir.entries()) names.push(name);
        return names.sort();
    }, []);
    await safe('httpCache', async () => {
        try {
            const res = await fetch('/asset.js', { cache: 'only-if-cached', mode: 'same-origin' });
            return res.ok;
        } catch {
            return false;
        }
    }, false);
    return out;
}

/**
 * Seeds every storage type on `origin` using `page` (navigates the page to origin/seed).
 * sessionStorage lives in that tab only. Throws when a storage type could not be seeded.
 */
export async function seedOrigin(page, origin) {
    await page.goto(`${origin}/seed`, { waitUntil: 'load', timeout: 20000 });
    const { failed } = await page.evaluate(seedInPage, SEED);
    if (failed.length) throw new Error(`Seeding ${origin} failed: ${failed.join('; ')}`);
}

/**
 * Reads what is stored for `origin`.
 * Cookies come from CDP Network.getCookies (HttpOnly visible), as [{name, httpOnly, domain}] in
 * `cookieInfo` and sorted names in `cookies`. Pass `{ page }` to read from an existing tab (needed
 * for sessionStorage); otherwise a fresh tab is opened on origin/blank and closed again.
 * @returns {Promise<{cookies:string[], cookieInfo:object[], localStorage:object, sessionStorage:object,
 *   indexedDB:string[], cacheStorage:string[], serviceWorkers:number, opfs:string[], httpCache:boolean}>}
 */
export async function readState(browser, origin, { page: existing } = {}) {
    const page = existing || await browser.newPage();
    let cdp;
    try {
        if (!existing) await page.goto(`${origin}/blank`, { waitUntil: 'load', timeout: 20000 });
        else if (new URL(page.url()).origin !== origin) throw new Error(`readState: page is on ${page.url()}, not ${origin}`);
        const inPage = await page.evaluate(readInPage);
        cdp = await page.createCDPSession();
        const { cookies } = await cdp.send('Network.getCookies', { urls: [`${origin}/`] });
        // Chrome returns cookies in no fixed order: sort so states compare deterministically.
        const cookieInfo = cookies
            .map((c) => ({ name: c.name, httpOnly: c.httpOnly, domain: c.domain }))
            .sort((a, b) => `${a.name}|${a.domain}`.localeCompare(`${b.name}|${b.domain}`));
        return { ...inPage, cookies: cookies.map((c) => c.name).sort(), cookieInfo };
    } finally {
        try { await cdp?.detach(); } catch { /* page gone */ }
        if (!existing) await page.close();
    }
}

/** Wipes cookies, site data and HTTP cache of the given origins directly through CDP (test reset). */
export async function resetBrowserState(browser, origins) {
    const page = await browser.newPage();
    try {
        await page.goto('about:blank');
        const cdp = await page.createCDPSession();
        await cdp.send('Network.clearBrowserCookies');
        await cdp.send('Network.clearBrowserCache');
        for (const origin of origins) {
            await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
        }
        await cdp.detach();
    } finally {
        await page.close();
    }
}

/** Cookie names expected on a fully seeded origin. */
export function seededCookieNames(origin) {
    const names = [SEED.cookieHost, SEED.cookieHttpOnly];
    if (new URL(origin).hostname.endsWith('localtest.me')) names.push(SEED.cookieShared);
    return names.sort();
}

/**
 * Condenses a state into 'present' | 'empty' | 'partial' per state kind (sessionStorage excluded:
 * it is only meaningful for the tab that seeded it).
 */
export function summarizeState(state, origin) {
    const verdict = (have, want) => (have === want ? 'present' : have === 0 ? 'empty' : 'partial');
    const hasAll = (list, names) => names.filter((n) => list.includes(n)).length;
    const cookieWant = seededCookieNames(origin);
    return {
        cookies: verdict(hasAll(state.cookies, cookieWant), cookieWant.length),
        localStorage: verdict(hasAll(Object.keys(state.localStorage), [SEED.localStorage]), 1),
        indexedDB: verdict(hasAll(state.indexedDB, [SEED.indexedDB]), 1),
        cacheStorage: verdict(hasAll(state.cacheStorage, [SEED.cacheStorage]), 1),
        serviceWorkers: verdict(Math.min(state.serviceWorkers, 1), 1),
        opfs: verdict(hasAll(state.opfs, [SEED.opfs]), 1),
        httpCache: verdict(state.httpCache ? 1 : 0, 1)
    };
}

/** Seeds A, B, A2 and C (each in its own short-lived tab, closed afterwards). */
export async function seedAll(browser, origins) {
    for (const origin of [origins.A, origins.B, origins.A2, origins.C]) {
        const page = await browser.newPage();
        try {
            await seedOrigin(page, origin);
        } finally {
            await page.close();
        }
    }
}

// ---------------------------------------------------------------------------
// Popup helpers
// ---------------------------------------------------------------------------
//
// A popup opened as a tab (chrome-extension://<id>/popup.html) has itself as the active tab, so
// the extension shows screen 5 ("unsupported page"). openPopupPage() continues from there with a
// typed target, which is the same path a user takes on chrome:// pages. The tab-driven features
// (counts, sessionStorage, reload) are covered by openPopupForTab(), which stubs chrome.tabs.query
// in the popup page to report a real fixture tab as the active one (needs a hostAccess env).

/** Target used when a test does not care about the origin. Never contacted. */
export const DEFAULT_TARGET = 'http://localhost:9';

const MAIN_SELECTOR = '#screenMain:not([hidden])';

/** Waits until screen 1 is showing and its selection summary is rendered. */
export async function waitForMain(popup, timeout = 10000) {
    await popup.waitForSelector(MAIN_SELECTOR, { timeout });
    await popup.waitForFunction(() => {
        const el = document.getElementById('selectedCount');
        return Boolean(el && el.textContent.trim());
    }, { timeout });
}

/** Opens the popup in a tab and registers it for failure artifacts. */
async function newPopupTab(browser, extensionId, beforeLoad) {
    const page = await browser.newPage();
    browserState(browser).popups.add(page);
    page.on('close', () => browserState(browser).popups.delete(page));
    if (beforeLoad) await beforeLoad(page);
    await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForSelector('body[data-screen]', { timeout: 10000 });
    return page;
}

/**
 * Opens the popup as a tab and continues from screen 5 with `target` (screen 1 is showing on return).
 * @param {object} [options] `{ target }`; pass `target: null` to stay on the unsupported screen.
 */
export async function openPopupPage(browser, extensionId, { target = DEFAULT_TARGET } = {}) {
    const page = await newPopupTab(browser, extensionId);
    await page.waitForSelector('#screenUnsupported:not([hidden])', { timeout: 10000 });
    if (target === null) return page;
    await continueFromUnsupported(page, target);
    return page;
}

/** Types `target` on screen 5 and presses Continue. */
export async function continueFromUnsupported(popup, target) {
    await popup.waitForSelector('#manualTargetInput', { visible: true });
    await popup.click('#manualTargetInput', { clickCount: 3 });
    await popup.type('#manualTargetInput', target);
    await popup.click('#continueBtn');
    await waitForMain(popup);
}

/**
 * Opens the popup with `tabPage` reported as the active tab (chrome.tabs.query is stubbed in the
 * popup page; everything else is the real extension). Requires `launchE2E({ hostAccess: true })`
 * so that the extension may read the tab URL and script it. `{ screen: 'any' }` does not wait for
 * screen 1.
 */
export async function openPopupForTab(browser, extensionId, tabPage, { screen = 'main' } = {}) {
    const url = tabPage.url();
    const lookup = await browser.newPage();
    let tabId;
    try {
        await lookup.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load' });
        tabId = await lookup.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url);
    } finally {
        await lookup.close();
    }
    if (!Number.isInteger(tabId)) throw new Error(`openPopupForTab: no tab with url ${url} (is this a hostAccess env?)`);
    const page = await newPopupTab(browser, extensionId, (p) => p.evaluateOnNewDocument((id, u) => {
        chrome.tabs.query = async () => [{ id, url: u, active: true }];
    }, tabId, url));
    if (screen === 'main') {
        await waitForMain(page);
    } else {
        // the popup may open straight on another screen (e.g. the pending confirmation of a shortcut)
        await page.waitForFunction(() => {
            const el = document.getElementById('selectedCount');
            return Boolean(el && el.textContent.trim());
        }, { timeout: 10000 });
    }
    return page;
}

const CHECKBOXES = '.checkbox-grid input[type="checkbox"]';

/** Values of all data-type checkboxes the popup currently offers, in DOM order. */
export async function getOfferedTypes(popup) {
    return popup.$$eval(CHECKBOXES, (els) => els.map((e) => e.value));
}

/** Types whose checkbox is currently checked. */
export async function getSelectedTypes(popup) {
    return popup.$$eval(CHECKBOXES, (els) => els.filter((e) => e.checked).map((e) => e.value));
}

/** Types whose checkbox is disabled right now. */
export async function getDisabledTypes(popup) {
    return popup.$$eval(CHECKBOXES, (els) => els.filter((e) => e.disabled).map((e) => e.value));
}

/** Types the popup offers, read from a throwaway popup tab. */
export async function readOfferedTypes(browser, extensionId) {
    const popup = await openPopupPage(browser, extensionId);
    try {
        return await getOfferedTypes(popup);
    } finally {
        await popup.close();
    }
}

/** Types `origin` into the popup's target field (fires input/change events). */
export async function setTarget(popup, origin) {
    await popup.$eval('#originInput', (input, value) => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, origin);
}

/** Checks exactly the given data types (by checkbox value) with real clicks. Disabled rows stay unchecked. */
export async function selectTypes(popup, keys) {
    const wanted = new Set(keys);
    const offered = await getOfferedTypes(popup);
    const unknown = [...wanted].filter((k) => !offered.includes(k));
    if (unknown.length) throw new Error(`Popup does not offer data type(s): ${unknown.join(', ')} (offered: ${offered.join(', ')})`);
    for (const value of offered) {
        const handle = await popup.$(`${CHECKBOXES}[value="${value}"]`);
        const { checked, disabled } = await handle.evaluate((el) => ({ checked: el.checked, disabled: el.disabled }));
        if (disabled) {
            if (wanted.has(value)) throw new Error(`selectTypes: "${value}" is disabled in the popup`);
        } else if (checked !== wanted.has(value)) {
            await handle.evaluate((el) => el.click());
        }
        await handle.dispose();
    }
    const now = await getSelectedTypes(popup);
    if (now.length !== wanted.size || !now.every((k) => wanted.has(k))) {
        throw new Error(`selectTypes failed: wanted [${[...wanted]}], checked [${now}]`);
    }
}

/** Clicks "Select all" until every enabled checkbox is checked. */
export async function selectAllTypes(popup) {
    const allChecked = () => popup.$$eval(CHECKBOXES, (els) => els.filter((e) => !e.disabled).every((e) => e.checked));
    if (!(await allChecked())) await popup.click('#selectAll');
    if (!(await allChecked())) throw new Error('"Select all" did not check every enabled data type');
}

/** Clicks #cookieManageBtn, picks the cookie scope on screen 2 and saves. mode: 'exact' | 'wide'. */
export async function setCookieMode(popup, mode) {
    await popup.click('#cookieManageBtn');
    await popup.waitForSelector('#screenCookies:not([hidden])');
    await popup.click(mode === 'wide' ? '#cookieModeWide' : '#cookieModeExact');
    await popup.click('#cookieSaveBtn');
    await waitForMain(popup);
}

/** Current cookie scope as the popup shows it: 'wide' | 'exact' (scope note of screen 1). */
export async function getScope(popup) {
    return popup.$eval('#scopeNote', (el) => el.dataset.scope);
}

export async function clickClear(popup) {
    await popup.click('#clearBtn');
}

export async function clickConfirm(popup) {
    await popup.click('#confirmBtn');
}

export async function clickCancel(popup) {
    await popup.click('#cancelBtn');
}

export async function pressEscape(popup) {
    await popup.keyboard.press('Escape');
}

/** True while the confirmation screen is showing. */
export async function isConfirming(popup) {
    return popup.evaluate(() => {
        const screen = document.getElementById('screenConfirm');
        return Boolean(screen) && !screen.hidden && document.body.classList.contains('is-confirming') &&
            document.body.dataset.screen === 'confirm';
    });
}

/** Waits until the confirmation screen is showing. */
export async function waitForConfirm(popup, timeout = 5000) {
    await popup.waitForFunction(() => {
        const screen = document.getElementById('screenConfirm');
        return Boolean(screen) && !screen.hidden && document.body.classList.contains('is-confirming');
    }, { timeout });
}

/** Waits until the confirmation screen is gone. */
export async function waitForNoConfirm(popup, timeout = 5000) {
    await popup.waitForFunction(() => {
        const screen = document.getElementById('screenConfirm');
        return !screen || screen.hidden;
    }, { timeout });
    await popup.waitForFunction(() => !document.body.classList.contains('is-confirming'), { timeout });
}

/**
 * Waits for #statusMessage to show a message of the given kind ('success' | 'error' | 'info').
 * @returns {Promise<string>} the message text
 */
export async function waitForStatus(popup, kind = 'success', timeout = 20000) {
    await popup.waitForFunction((k) => {
        const el = document.getElementById('statusMessage');
        return Boolean(el) && el.classList.contains(k) && !el.classList.contains('hidden') && el.textContent.trim() !== '';
    }, { timeout }, kind);
    return popup.$eval('#statusMessage', (el) => el.textContent.trim());
}

/**
 * Waits for the result screen (screen 4).
 * @returns {Promise<{tone: string, text: string}>} banner tone ('success' | 'warning' | 'danger') and text
 */
export async function waitForResult(popup, timeout = 20000) {
    await popup.waitForFunction(() => {
        const screen = document.getElementById('screenResult');
        return Boolean(screen) && !screen.hidden && Boolean(document.getElementById('resultBanner'));
    }, { timeout });
    return popup.$eval('#resultBanner', (el) => ({ tone: el.dataset.tone, text: el.textContent.trim() }));
}

/**
 * Full cleanup through the popup UI: set target, select types, pick the cookie scope, click clear,
 * confirm when the confirmation screen appears, wait for the result screen.
 *
 * Cookies default to the domain-wide scope here because Exact Cookie Mode needs host access that
 * cannot be granted in automation (hostAccess envs pass `cookieMode: 'exact'`).
 *
 * @param {object} [opts] { types?: string[] | 'all', confirm?: boolean, cookieMode?: 'wide' | 'exact' }
 * @returns {Promise<{confirmed: boolean, status: string, tone: string}>}
 */
export async function runCleanup(popup, origin, { types = 'all', confirm = true, cookieMode = 'wide' } = {}) {
    if (origin) await setTarget(popup, origin);
    if (types === 'all') await selectAllTypes(popup);
    else await selectTypes(popup, types);
    if ((await getSelectedTypes(popup)).includes('cookies')) {
        const isWide = (await getScope(popup)) === 'wide';
        if ((cookieMode === 'wide') !== isWide) await setCookieMode(popup, cookieMode);
    }
    await clickClear(popup);

    const outcome = await popup.waitForFunction(() => {
        const confirmScreen = document.getElementById('screenConfirm');
        if (confirmScreen && !confirmScreen.hidden) return 'confirm';
        const result = document.getElementById('screenResult');
        if (result && !result.hidden && document.getElementById('resultBanner')) return 'result';
        const status = document.getElementById('statusMessage');
        if (status && !status.classList.contains('hidden') && status.classList.contains('error') && status.textContent.trim()) {
            return 'error:' + status.textContent.trim();
        }
        const cookies = document.getElementById('screenCookies');
        if (cookies && !cookies.hidden) return 'error:sent to the cookie screen (host access missing)';
        return false;
    }, { timeout: 20000 }).then((h) => h.jsonValue());

    if (String(outcome).startsWith('error:')) throw new Error(`Popup reported an error: ${outcome.slice(6)}`);
    let confirmed = false;
    if (outcome === 'confirm') {
        if (!confirm) return { confirmed: false, status: '', tone: '' };
        await clickConfirm(popup);
        confirmed = true;
    }
    const { tone, text } = await waitForResult(popup);
    return { confirmed, status: text, tone };
}

// ---------------------------------------------------------------------------
// Failure artifacts
// ---------------------------------------------------------------------------

export function slugify(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'test';
}

export function writeArtifact(fileName, content) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const file = path.join(ARTIFACTS_DIR, fileName);
    fs.writeFileSync(file, content);
    return file;
}

/** Saves a screenshot of every open popup tab and the collected console logs. */
export async function saveFailureArtifacts(browser, name, error) {
    const slug = slugify(name);
    const { logs, popups } = browserState(browser);
    let index = 0;
    for (const page of popups) {
        try {
            if (page.isClosed()) continue;
            fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
            await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${slug}-popup${index ? `-${index}` : ''}.png`), fullPage: true });
            index += 1;
        } catch { /* page died */ }
    }
    const header = `Test: ${name}\nError: ${error && error.stack ? error.stack : error}\n\n--- console / page errors (${logs.length}) ---\n`;
    writeArtifact(`${slug}.console.log`, header + logs.join('\n') + '\n');
}

/**
 * Wraps a test body: when it throws, popup screenshots and console logs are saved to
 * test-artifacts/ before the error is re-thrown.
 *   test('name', guarded(env, 'name', async () => { ... }));
 */
export function guarded(env, name, fn) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (error) {
            await saveFailureArtifacts(env.browser, name, error).catch(() => {});
            throw error;
        }
    };
}

export { sleep };

// ---------------------------------------------------------------------------
// Extension service worker access
// ---------------------------------------------------------------------------
//
// The MV3 worker is suspended when idle and puppeteer's WebWorker handle dies with it, so
// evaluating in it directly is flaky. workerEvaluate() wakes the worker (an extension page sends
// it a message, which always starts it), re-acquires the target on every attempt and retries a
// few times with a short backoff when the worker went away mid-call.

/** Starts the extension service worker by messaging it from a short-lived extension page. */
export async function wakeExtensionWorker(browser, extensionId) {
    const page = await browser.newPage();
    try {
        await page.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'load', timeout: 20000 });
        await page.evaluate(() => new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ awWake: true }, () => { void chrome.runtime.lastError; resolve(); });
            } catch { resolve(); }
        }));
    } finally {
        await page.close();
    }
}

const isWorkerTarget = (extensionId) => (t) =>
    t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extensionId}/`);

/** Finds an extension service worker target (waits for one), or throws. */
export async function getExtensionWorkerTarget(browser, extensionId, timeout = 10000) {
    return browser.waitForTarget(isWorkerTarget(extensionId), { timeout });
}

/**
 * Opens a CDP session on the live extension service worker. Puppeteer keeps listing workers that
 * have been terminated (after an extension reload, or when an incognito window closes), and probing
 * a dead one hangs until the probe times out. So every candidate is probed in parallel and the first
 * live worker that matches (profile, ready) wins.
 */
async function openWorkerSession(browser, extensionId, incognito) {
    await getExtensionWorkerTarget(browser, extensionId);
    const candidates = browser.targets().filter(isWorkerTarget(extensionId));
    const sessions = [];
    const probe = async (target) => {
        const cdp = await target.createCDPSession();
        sessions.push(cdp);
        // the module (and globalThis.awCleaner) is registered once the worker script has run
        const ready = await withTimeout(cdp.send('Runtime.evaluate', {
            expression: 'typeof globalThis.awCleaner === "object" && typeof chrome === "object"', returnByValue: true
        }), 3000, 'worker readiness probe');
        if (ready.result.value !== true) throw new Error('service worker not yet ready');
        if (typeof incognito === 'boolean') {
            // split-mode extensions have one worker per profile; pick the one of the wanted profile
            const ctx = await cdp.send('Runtime.evaluate', { expression: 'chrome.extension.inIncognitoContext', returnByValue: true });
            if (ctx.result.value !== incognito) throw new Error(`worker is ${incognito ? 'not ' : ''}the incognito instance`);
        }
        return cdp;
    };
    let winner;
    try {
        winner = await Promise.any(candidates.map(probe));
    } catch (e) {
        throw e instanceof AggregateError ? (e.errors[e.errors.length - 1] || e) : e;
    } finally {
        // sessions of the losers (dead or other-profile workers) are not needed
        for (const cdp of sessions) {
            if (cdp !== winner) cdp.detach().catch(() => {});
        }
    }
    return winner;
}

/**
 * Evaluates `fn(...args)` in the extension service worker (fn must be self-contained; args and the
 * result must be JSON-serializable; async functions are awaited). Uses a raw CDP session on the
 * worker target: puppeteer's WebWorker.evaluate() was observed to hang forever on MV3 workers.
 * Wakes the worker first and retries (re-acquiring the target) when the worker was terminated.
 */
export function workerEvaluate(browser, extensionId, fn, ...args) {
    return workerEvaluateIn(browser, extensionId, {}, fn, ...args);
}

/**
 * Like workerEvaluate, for a split-mode extension: `incognito: true` targets the worker of the
 * incognito profile, `false` the regular one (default: any live worker, newest first).
 */
export async function workerEvaluateIn(browser, extensionId, { incognito, wake = true } = {}, fn, ...args) {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
        let cdp;
        try {
            if (wake) await wakeExtensionWorker(browser, extensionId);
            cdp = await openWorkerSession(browser, extensionId, incognito);
            const res = await withTimeout(cdp.send('Runtime.evaluate', {
                expression, awaitPromise: true, returnByValue: true
            }), 45000, 'worker evaluate');
            if (res.exceptionDetails) {
                const d = res.exceptionDetails;
                const err = new Error(`worker evaluate threw: ${d.exception?.description || d.exception?.value || d.text}`);
                err.fromFn = true;
                throw err;
            }
            return res.result.value;
        } catch (e) {
            lastError = e;
            if (e && e.fromFn) throw e;
            await sleep(300 * (attempt + 1));
        } finally {
            try { await cdp?.detach(); } catch { /* worker gone */ }
        }
    }
    throw lastError;
}

// ---------------------------------------------------------------------------
// Incognito
// ---------------------------------------------------------------------------

/**
 * Turns on "Allow in Incognito" for the extension in automation. Tried in order:
 *   (b) chrome.developerPrivate.updateExtensionConfiguration from the chrome://extensions page,
 *   (a) clicking the toggle inside the extensions-manager shadow DOM of chrome://extensions/?id=<id>.
 * Chrome reloads the extension when the setting changes, so the call waits until the (new) worker
 * reports chrome.extension.isAllowedIncognitoAccess() === true.
 * @returns {Promise<{ok: boolean, method?: string, reason?: string}>}
 */
export async function enableIncognitoAccess(browser, extensionId) {
    const isAllowed = async () => {
        try {
            return (await workerEvaluate(browser, extensionId, () => chrome.extension.isAllowedIncognitoAccess())) === true;
        } catch { return false; }
    };
    if (await isAllowed()) return { ok: true, method: 'already enabled' };

    const attempts = [
        ['developerPrivate.updateExtensionConfiguration', async (page) => {
            await page.goto('chrome://extensions/', { waitUntil: 'load', timeout: 20000 });
            await page.evaluate(async (id) => {
                await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, incognitoAccess: true });
            }, extensionId);
        }],
        ['extensions-manager shadow DOM toggle', async (page) => {
            await page.goto(`chrome://extensions/?id=${extensionId}`, { waitUntil: 'load', timeout: 20000 });
            await sleep(1000);
            await page.evaluate(() => {
                const view = document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-detail-view');
                view.shadowRoot.querySelector('#allow-incognito').shadowRoot.querySelector('cr-toggle').click();
            });
        }]
    ];
    const reasons = [];
    for (const [method, run] of attempts) {
        const page = await browser.newPage();
        try {
            await run(page);
            for (let i = 0; i < 20; i++) {
                await sleep(500);
                if (await isAllowed()) return { ok: true, method };
            }
            reasons.push(`${method}: ran but "Allow in Incognito" stayed off`);
        } catch (e) {
            reasons.push(`${method}: ${e && e.message ? e.message : e}`);
        } finally {
            await page.close().catch(() => {});
        }
    }
    return { ok: false, reason: reasons.join(' | ') };
}

/**
 * Opens a real (off-the-record) incognito window on `url` through the extension (puppeteer's
 * createBrowserContext() is not a real incognito window for extensions) and returns its page.
 * Requires "Allow in Incognito" to be on.
 */
export async function openIncognitoPage(browser, extensionId, url) {
    const known = new Set(browser.targets());
    await workerEvaluateIn(browser, extensionId, { incognito: false }, async (url) => {
        await chrome.windows.create({ incognito: true, url });
    }, url);
    const target = await browser.waitForTarget(
        (t) => t.type() === 'page' && !known.has(t) && t.url() === url, { timeout: 15000 });
    const page = await target.page();
    if (!page) throw new Error('could not attach to the incognito page');
    return page;
}
