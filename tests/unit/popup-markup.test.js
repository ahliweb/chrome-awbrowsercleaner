/**
 * AW Browser Cleaner - Popup markup & i18n consistency tests
 *
 * Guards the v1.3 popup:
 * - every i18n key referenced by popup.html, popup.js and the popup-* screen modules exists in all locales,
 * - no popup script renders dynamic text through innerHTML (or similar),
 * - the DOM contract of docs/architecture.md is present (in popup.html or created by a screen module),
 * - the data-type rows match DATA_TYPES, the screens are declared, popup-only CSS stays scoped,
 * - cookie values are never read by the popup,
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
const screensCss = read('screens.css');
const architecture = read('docs/architecture.md');

/** Popup controller plus the screen modules it imports (popup-*.js). */
const popupFiles = ['popup.js', ...fs.readdirSync(ROOT_DIR).filter((f) => /^popup-.+\.js$/.test(f))].sort();
const popupSources = Object.fromEntries(popupFiles.map((f) => [f, read(f)]));

const locales = ['en', 'id'].map(lang => ({
    lang,
    messages: JSON.parse(read(`_locales/${lang}/messages.json`))
}));

/**
 * Extracts the values of a `const NAME = Object.freeze({ key: 'value', ... })` table.
 * @param {string} source - File content.
 * @param {string} name - Constant name.
 * @returns {string[]} The string values.
 */
function tableValues(source, name) {
    const match = new RegExp(`const ${name} = (?:Object\\.freeze\\()?\\{([^}]*)\\}`).exec(source);
    if (!match) return [];
    return [...match[1].matchAll(/:\s*'([A-Za-z0-9]+)'/g)].map(m => m[1]);
}

function collectKeys() {
    const keys = new Set();
    for (const m of html.matchAll(/data-i18n(?:-[a-z]+)?="([A-Za-z0-9]+)"/g)) keys.add(m[1]);
    for (const m of core.matchAll(/labelKey: '([A-Za-z]+)'/g)) keys.add(m[1]);
    for (const [file, source] of Object.entries(popupSources)) {
        // t('key'), getMessage('key'), ctx.getMessage('key')
        for (const m of source.matchAll(/\b(?:t|getMessage)\(\s*'([A-Za-z0-9]+)'/g)) keys.add(m[1]);
        // fillTemplate(parent, 'key', slots)
        for (const m of source.matchAll(/fillTemplate\([^,]+,\s*'([A-Za-z0-9]+)'/g)) keys.add(m[1]);
        // t(cond ? 'a' : 'b')
        for (const m of source.matchAll(/\b(?:t|getMessage)\([^'()]*\?\s*'([A-Za-z0-9]+)'\s*:\s*'([A-Za-z0-9]+)'/g)) {
            keys.add(m[1]);
            keys.add(m[2]);
        }
        // key tables (type tooltips, units, after-action sentences)
        for (const name of ['TYPE_TIP_KEYS', 'UNIT_KEYS', 'AFTER_KEYS']) for (const k of tableValues(source, name)) keys.add(k);
        if (file === 'popup.js') {
            const phrase = /const keys = \{([^}]*)\}/.exec(source);
            for (const m of (phrase ? phrase[1] : '').matchAll(/:\s*'([A-Za-z0-9]+)'/g)) keys.add(m[1]);
        } else {
            // screen modules pick keys from small tables and variables; their key families are prefixed
            for (const m of source.matchAll(/'((?:unsupported|result|preview|relTime)[A-Za-z0-9]*)'/g)) keys.add(m[1]);
        }
    }
    // element ids that merely share a key family prefix (e.g. resultBanner) are not message keys
    const ids = new Set(Object.values(popupSources).flatMap(src =>
        [...src.matchAll(/(?:\bid:\s*|setAttribute\('id',\s*)'([A-Za-z0-9]+)'/g)].map(m => m[1])));
    return [...keys].filter(k => !ids.has(k)).sort();
}

describe('Popup i18n coverage', () => {
    const keys = collectKeys();

    test('collects a meaningful set of keys', () => {
        expect(keys.length).toBeGreaterThan(80);
        for (const key of ['presetStatusCustom', 'cookieSummaryExact', 'confirmNowBtn', 'resultTitle', 'unsupportedTitle', 'typeTipCookies', 'unitDb']) {
            expect(keys).toContain(key);
        }
    });

    for (const { lang, messages } of locales) {
        test(`every referenced key exists in ${lang}`, () => {
            const missing = keys.filter(k => !messages[k]);
            expect(missing).toEqual([]);
        });
    }

    test('English and Indonesian define the same placeholders for every popup key', () => {
        const [en, id] = locales.map(l => l.messages);
        for (const key of collectKeys()) {
            expect([key, Object.keys(id[key].placeholders || {}).sort()]).toEqual([key, Object.keys(en[key].placeholders || {}).sort()]);
        }
    });
});

describe('Popup rendering safety', () => {
    test('popup scripts never render through innerHTML and friends', () => {
        for (const [file, source] of Object.entries(popupSources)) {
            expect([file, /\.innerHTML\s*[+]?=/.test(source)]).toEqual([file, false]);
            expect([file, /\.outerHTML\s*=/.test(source)]).toEqual([file, false]);
            expect([file, /insertAdjacentHTML/.test(source)]).toEqual([file, false]);
            expect([file, /document\.write/.test(source)]).toEqual([file, false]);
            expect([file, /\beval\(|new Function\(/.test(source)]).toEqual([file, false]);
        }
    });

    test('popup.html has no inline scripts or event handlers', () => {
        expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
        expect(html).not.toMatch(/\son[a-z]+="/);
        expect(html).toMatch(/<script type="module" src="popup\.js"><\/script>/);
        expect(html).toMatch(/href="styles\.css"/);
        expect(html).toMatch(/href="screens\.css"/);
    });

    test('cookie confirmation uses the destructive button style', () => {
        expect(html).toMatch(/id="confirmBtn" class="btn btn-danger"/);
        // the review level switches it to the primary style at runtime
        expect(js).toMatch(/'btn-danger' : 'btn-primary'/);
    });

    test('scope note starts in a declared scope state', () => {
        expect(html).toMatch(/id="scopeNote"[^>]*data-scope="(exact|wide)"/);
    });

    test('cookie values are never read: no ".value" on cookie objects, cookies go through the classifier', () => {
        expect(js).not.toMatch(/\b(?:cookie|cookies|ck|meta|found)\w*(?:\[[^\]]*\])?\.value\b/);
        expect(js).not.toMatch(/\bvalue\s*:\s*(?:cookie|ck|meta)\b/);
        expect(js).not.toMatch(/JSON\.stringify\([^)]*cookie/i);
        expect(js).toMatch(/classifyCookies\(found, origin\)/);
        // only metadata fields are rendered
        for (const field of ['meta.name', 'meta.id', 'meta.httpOnly', 'meta.secure', 'meta.sameSite']) expect(js).toContain(field);
    });

    test('every deletion goes through cleanup-core: the popup never calls the removal APIs', () => {
        for (const [file, source] of Object.entries(popupSources)) {
            expect([file, /browsingData/.test(source)]).toEqual([file, false]);
            expect([file, /cookies\.remove/.test(source)]).toEqual([file, false]);
        }
        expect(js).toMatch(/executePlan\(plan, \{ deferAfter: true \}\)/);
        expect(js).toMatch(/runAfterAction\(plan\)/);
    });

    test('the confirmation is rendered from describePlan() of the validated plan', () => {
        expect(js).toMatch(/const description = describePlan\(plan, describeExtras\(plan\)\)/);
        expect(js).toMatch(/createPlan\(\{/);
        // a plan without confirmation level runs without the confirm screen, others never run directly
        expect(js).toMatch(/if \(level === 'none'\)/);
    });
});

describe('Popup DOM contract (docs/architecture.md)', () => {
    const section = architecture.slice(architecture.indexOf('## Popup DOM contract'), architecture.indexOf('## Permissions'));
    const ids = [...new Set([...section.matchAll(/`#([A-Za-z][A-Za-z0-9]*)/g)].map(m => m[1]))].sort();
    const modules = ['popup-result.js', 'popup-unsupported.js'].map(read).join('\n');

    test('the contract lists the expected hooks', () => {
        expect(ids.length).toBeGreaterThan(40);
        for (const id of ['originInput', 'clearBtn', 'cookieManageBtn', 'confirmBtn', 'resultDoneBtn', 'continueBtn', 'testModeTag']) {
            expect(ids).toContain(id);
        }
    });

    test('every contract id exists in popup.html or is created by a screen module', () => {
        const missing = ids.filter((id) => !html.includes(`id="${id}"`) &&
            !new RegExp(`(?:id:\\s*|setAttribute\\('id',\\s*)'${id}'`).test(modules));
        expect(missing).toEqual([]);
    });

    test('screens are sections toggled with hidden and body[data-screen] starts on main', () => {
        expect(html).toMatch(/<body class="popup" data-screen="main">/);
        for (const id of ['screenMain', 'screenCookies', 'screenConfirm', 'screenResult', 'screenUnsupported']) {
            expect(html).toMatch(new RegExp(`<section id="${id}"`));
        }
        for (const id of ['screenCookies', 'screenConfirm', 'screenResult', 'screenUnsupported']) {
            expect(html).toMatch(new RegExp(`<section id="${id}"[^>]*\\bhidden`));
        }
        expect(js).toMatch(/document\.body\.dataset\.screen = name/);
        expect(js).toMatch(/classList\.toggle\('is-confirming'/);
    });

    test('data-type rows are in DATA_TYPES order, grouped Session / Storage / Cache & offline', () => {
        const keys = [...core.matchAll(/\{ key: '([A-Za-z]+)', group: '([a-z]+)'/g)].map(m => [m[1], m[2]]);
        expect(keys.length).toBe(8);
        const values = [...html.matchAll(/<input type="checkbox" value="([A-Za-z]+)">/g)].map(m => m[1]);
        expect(values).toEqual(keys.map(([k]) => k));
        for (const [key] of keys) {
            expect(html).toContain(`data-count-for="${key}"`);
            expect(html).toContain(`data-row="${key}"`);
        }
        const groups = [...html.matchAll(/<div class="data-group" role="group" aria-labelledby="(group[A-Za-z]+)">([\s\S]*?)<\/div>\s*<\/div>/g)];
        expect(groups.map(g => g[1])).toEqual(['groupSession', 'groupStorage', 'groupCache']);
        const byGroup = groups.map(g => [...g[2].matchAll(/value="([A-Za-z]+)"/g)].map(m => m[1]));
        expect(byGroup).toEqual([
            ['cookies', 'sessionStorage'],
            ['localStorage', 'indexedDB', 'fileSystems'],
            ['cache', 'cacheStorage', 'serviceWorkers']
        ]);
    });

    test('the preset bar offers the four built-in presets with aria-pressed and one tab stop', () => {
        const bar = /<div id="presetBar"[\s\S]*?<\/div>/.exec(html)[0];
        expect([...bar.matchAll(/data-preset="([a-z]+)"/g)].map(m => m[1])).toEqual(['logout', 'fresh', 'stale', 'full']);
        expect([...bar.matchAll(/aria-pressed="false"/g)].length).toBe(4);
        expect([...bar.matchAll(/tabindex="0"/g)].length).toBe(1);
    });

    test('after-action options map to the plan values', () => {
        const select = /<select id="afterSelect"[\s\S]*?<\/select>/.exec(html)[0];
        expect([...select.matchAll(/value="([a-z]+)"/g)].map(m => m[1]).sort()).toEqual(['hard', 'none', 'reload', 'start']);
    });

    test('every form control of the main screen has a label or aria-label', () => {
        const main = /<section id="screenMain"[\s\S]*?<\/section>/.exec(html)[0];
        for (const m of main.matchAll(/<(input|select)\b([^>]*)>/g)) {
            const attrs = m[2];
            const id = (/id="([^"]+)"/.exec(attrs) || [])[1];
            const wrapped = /type="checkbox"/.test(attrs); // checkboxes sit inside their <label>
            const labelled = wrapped || /aria-label/.test(attrs) || /data-i18n-aria/.test(attrs) ||
                (id && new RegExp(`<label[^>]*for="${id}"`).test(main));
            expect([id || m[0], Boolean(labelled)]).toEqual([id || m[0], true]);
        }
    });
});

describe('Popup styles', () => {
    test('popup-only rules in styles.css are scoped under .popup so options.html is unaffected', () => {
        const marker = css.indexOf('Popup (v1.3 screens)');
        expect(marker).toBeGreaterThan(0);
        const popupCss = css.slice(marker);
        let depth = 0;
        const unscoped = [];
        for (const line of popupCss.split('\n')) {
            const opens = (line.match(/\{/g) || []).length;
            const closes = (line.match(/\}/g) || []).length;
            if (depth === 0 && opens > 0 && !/^\s*(@|\/\*)/.test(line) && !/^\.popup[\s.:[,{]/.test(line) && !/^\s*\*/.test(line)) {
                unscoped.push(line.trim());
            }
            depth += opens - closes;
        }
        expect(unscoped).toEqual([]);
    });

    test('both popup and screens styles use design tokens with a dark mode', () => {
        expect(css).toMatch(/@media \(prefers-color-scheme: dark\)/);
        expect(screensCss).toMatch(/@media \(prefers-color-scheme: dark\)/);
        const popupCss = css.slice(css.indexOf('Popup (v1.3 screens)'));
        // popup rules use tokens, not raw colors (the only exception is the blue summary text in dark mode)
        const raw = [...popupCss.matchAll(/(?:color|background-color|border-color|border):[^;]*#[0-9a-fA-F]{3,8}/g)].map(m => m[0]);
        expect(raw).toEqual(['color: #bfdbfe']);
    });

    test('every control keeps a visible focus style', () => {
        expect(css).toMatch(/\.popup \.seg-btn:focus-visible/);
        expect(css).toMatch(/\.popup \.icon-btn:focus-visible/);
        expect(css).toMatch(/\.popup \.select:focus-visible/);
        expect(css).toMatch(/\.btn:focus-visible/);
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
