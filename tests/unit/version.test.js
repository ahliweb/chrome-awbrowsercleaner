/**
 * AW Browser Cleaner - Version Consistency Tests
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

function normalizeSemver(v) {
    if (!v) return '';
    let clean = v.trim().replace(/^v/, '');
    const parts = clean.split('.');
    while (parts.length < 3) {
        parts.push('0');
    }
    return parts.join('.');
}

describe('Version Synchronization', () => {
    const manifest = require('../../manifest.json');
    const pkg = require('../../package.json');
    const versionFile = fs.readFileSync(path.join(ROOT_DIR, 'VERSION'), 'utf8').trim();

    test('manifest.json version matches package.json version', () => {
        expect(normalizeSemver(manifest.version)).toBe(normalizeSemver(pkg.version));
    });

    test('manifest.json version matches VERSION file', () => {
        expect(normalizeSemver(manifest.version)).toBe(normalizeSemver(versionFile));
    });

    test('CHANGELOG contains entry for baseline version', () => {
        const changelog = fs.readFileSync(path.join(ROOT_DIR, 'CHANGELOG.md'), 'utf8');
        const norm = normalizeSemver(manifest.version);
        const headingRegex = new RegExp(`##\\s*\\[?v?${norm.replace(/\\./g, '\\.')}\\]?`, 'i');
        expect(headingRegex.test(changelog)).toBe(true);
    });

    test('CHANGELOG contains Unreleased section for upcoming release', () => {
        const changelog = fs.readFileSync(path.join(ROOT_DIR, 'CHANGELOG.md'), 'utf8');
        expect(changelog).toContain('## [Unreleased]');
    });
});
