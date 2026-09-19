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
