/**
 * AW Browser Cleaner - Popup markup & i18n consistency tests
 *
 * Guards the v1.3 visual style:
 * - every i18n key referenced by popup.html / popup.js exists in all locales,
 * - popup.js never renders dynamic text through innerHTML,
 * - bundled fonts referenced by styles.css exist and ship with their licenses.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT_DIR, p), 'utf8');

const html = read('popup.html');
const js = read('popup.js');
const core = read('cleanup-core.js');
const css = read('styles.css');
const locales = ['en', 'id'].map(lang => ({
    lang,
    messages: JSON.parse(read(`_locales/${lang}/messages.json`))
}));

function collectKeys() {
    const keys = new Set();
    for (const m of html.matchAll(/data-i18n(?:-[a-z]+)?="([A-Za-z]+)"/g)) keys.add(m[1]);
    for (const m of js.matchAll(/getMessage\('([A-Za-z]+)'/g)) keys.add(m[1]);
    for (const m of js.matchAll(/label: '([A-Za-z]+)'/g)) keys.add(m[1]);
    for (const m of core.matchAll(/labelKey: '([A-Za-z]+)'/g)) keys.add(m[1]);
    for (const m of js.matchAll(/'(scopeWide|scopeExact)'/g)) keys.add(m[1]);
    return [...keys].sort();
}

describe('Popup i18n coverage', () => {
    const keys = collectKeys();

    test('collects a meaningful set of keys', () => {
        expect(keys.length).toBeGreaterThan(20);
    });

    for (const { lang, messages } of locales) {
        test(`every referenced key exists in ${lang}`, () => {
            const missing = keys.filter(k => !messages[k]);
            expect(missing).toEqual([]);
        });
    }
});

describe('Popup rendering safety', () => {
    test('popup.js does not assign innerHTML', () => {
        expect(js).not.toMatch(/\.innerHTML\s*=/);
        expect(js).not.toMatch(/insertAdjacentHTML/);
    });

    test('cookie confirmation uses the destructive button style', () => {
        expect(html).toMatch(/id="confirmBtn" class="btn btn-danger"/);
    });

    test('scope note starts in a declared scope state', () => {
        expect(html).toMatch(/id="scopeNote"[^>]*data-scope="(exact|wide)"/);
    });
});

describe('Bundled fonts', () => {
    const fontUrls = [...css.matchAll(/url\('(fonts\/[^']+)'\)/g)].map(m => m[1]);

    test('styles.css references local fonts only', () => {
        expect(fontUrls.length).toBe(2);
        expect(css).not.toMatch(/fonts\.googleapis|@import\s+url\(\s*['"]?https?:/);
    });

    test('referenced font files and OFL licenses exist', () => {
        for (const url of fontUrls) {
            expect(fs.existsSync(path.join(ROOT_DIR, url))).toBe(true);
        }
        expect(fs.existsSync(path.join(ROOT_DIR, 'fonts/OFL-Inter.txt'))).toBe(true);
        expect(fs.existsSync(path.join(ROOT_DIR, 'fonts/OFL-JetBrainsMono.txt'))).toBe(true);
    });
});
