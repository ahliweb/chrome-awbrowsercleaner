#!/usr/bin/env bun
/**
 * Version Validation Script — AW Browser Cleaner
 *
 * Ensures all version sources of truth are synchronized:
 * - manifest.json (canonical extension version)
 * - package.json (project tooling version)
 * - VERSION (repository release tag indicator)
 * - CHANGELOG.md (release heading when checking a specific release)
 *
 * Usage:
 *   bun scripts/check-version.js          # verify consistency
 *   bun scripts/check-version.js v1.2.0   # verify specific release tag readiness
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function normalizeSemver(v) {
    if (!v) return '';
    // Strip leading 'v'
    let clean = v.trim().replace(/^v/, '');
    // If "1.1" -> "1.1.0"
    const parts = clean.split('.');
    while (parts.length < 3) {
        parts.push('0');
    }
    return parts.join('.');
}

function checkVersions(expectedTag) {
    const manifestPath = path.join(ROOT_DIR, 'manifest.json');
    const packagePath = path.join(ROOT_DIR, 'package.json');
    const versionFilePath = path.join(ROOT_DIR, 'VERSION');
    const changelogPath = path.join(ROOT_DIR, 'CHANGELOG.md');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const versionFile = fs.readFileSync(versionFilePath, 'utf8').trim();

    const manifestNorm = normalizeSemver(manifest.version);
    const pkgNorm = normalizeSemver(pkg.version);
    const fileNorm = normalizeSemver(versionFile);

    console.log(`Checking version synchronization...`);
    console.log(`  manifest.json: ${manifest.version} (normalized: ${manifestNorm})`);
    console.log(`  package.json:  ${pkg.version} (normalized: ${pkgNorm})`);
    console.log(`  VERSION:       ${versionFile} (normalized: ${fileNorm})`);

    let errors = [];

    if (manifestNorm !== pkgNorm) {
        errors.push(`Mismatch between manifest.json (${manifest.version}) and package.json (${pkg.version})`);
    }

    if (manifestNorm !== fileNorm) {
        errors.push(`Mismatch between manifest.json (${manifest.version}) and VERSION (${versionFile})`);
    }

    if (expectedTag) {
        const expectedNorm = normalizeSemver(expectedTag);
        console.log(`  Expected tag:  ${expectedTag} (normalized: ${expectedNorm})`);

        if (manifestNorm !== expectedNorm) {
            errors.push(`Manifest version (${manifest.version}) does not match expected tag ${expectedTag}`);
        }

        // Check CHANGELOG heading
        const changelog = fs.readFileSync(changelogPath, 'utf8');
        const headingRegex = new RegExp(`##\\s*\\[?v?${expectedNorm.replace(/\\./g, '\\.')}\\]?`, 'i');
        if (!headingRegex.test(changelog)) {
            errors.push(`CHANGELOG.md is missing release heading for [v${expectedNorm}]`);
        }
    }

    if (errors.length > 0) {
        console.error(`\n❌ Version validation failed:`);
        errors.forEach(err => console.error(`  - ${err}`));
        process.exit(1);
    }

    console.log(`\n✅ All version sources are synchronized! (${manifestNorm})`);
}

const targetTag = process.argv[2];
checkVersions(targetTag);
