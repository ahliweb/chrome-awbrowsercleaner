/**
 * AW Browser Cleaner - Package Build & Integrity Tests
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

describe('Extension Packaging', () => {
    test('build-package script generates valid zip and checksum', () => {
        // Run build script
        execSync('bun scripts/build-package.js', { cwd: ROOT_DIR, stdio: 'pipe' });

        const manifest = require('../../manifest.json');
        const zipPath = path.join(DIST_DIR, `aw-browser-cleaner-v${manifest.version}.zip`);
        const sha256Path = path.join(DIST_DIR, `aw-browser-cleaner-v${manifest.version}.zip.sha256`);

        expect(fs.existsSync(zipPath)).toBe(true);
        expect(fs.existsSync(sha256Path)).toBe(true);

        const stats = fs.statSync(zipPath);
        expect(stats.size).toBeGreaterThan(1000); // Should be non-trivial

        const shaContent = fs.readFileSync(sha256Path, 'utf8').trim();
        expect(shaContent).toMatch(/^[a-f0-9]{64}\s+/);
    });

    test('validate-package script passes for freshly built artifact', () => {
        expect(() => {
            execSync('bun scripts/validate-package.js', { cwd: ROOT_DIR, stdio: 'pipe' });
        }).not.toThrow();
    });
});

describe('Runtime file list', () => {
    const { RUNTIME_FILES } = require('../../scripts/package-files');
    const shipped = new Set(RUNTIME_FILES);

    test('every module imported by a shipped script is shipped too', () => {
        const missing = [];
        for (const file of RUNTIME_FILES.filter(f => f.endsWith('.js'))) {
            const src = fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');
            for (const m of src.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]\.\/([^'"]+)['"]/g)) {
                if (!shipped.has(m[1])) missing.push(`${file} -> ${m[1]}`);
            }
        }
        expect(missing).toEqual([]);
    });

    test('every script and stylesheet referenced by a shipped page is shipped too', () => {
        const missing = [];
        for (const file of RUNTIME_FILES.filter(f => f.endsWith('.html'))) {
            const html = fs.readFileSync(path.join(ROOT_DIR, file), 'utf8');
            for (const m of html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css))"/g)) {
                if (!shipped.has(m[1])) missing.push(`${file} -> ${m[1]}`);
            }
        }
        expect(missing).toEqual([]);
    });

    test('manifest entry points are shipped', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8'));
        const entries = [
            manifest.action && manifest.action.default_popup,
            manifest.background && manifest.background.service_worker,
            manifest.options_ui && manifest.options_ui.page
        ].filter(Boolean);
        for (const entry of entries) expect(shipped.has(entry)).toBe(true);
    });
});
