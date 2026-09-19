#!/usr/bin/env bun
/**
 * AW Browser Cleaner - Package Validation Script
 *
 * Verifies that the built ZIP package in dist/ complies with Chrome Web Store
 * integrity requirements:
 * - Only runtime-required files are present
 * - No tests, docs, secrets, git files, or build configs leaked into the archive
 * - SHA-256 checksum matches the generated .sha256 file
 *
 * Usage:
 *   bun scripts/validate-package.js [version]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const ALLOWED_FILES = new Set([
    'manifest.json',
    'popup.html',
    'popup.js',
    'origin-utils.js',
    'styles.css',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png',
    '_locales/en/messages.json',
    '_locales/id/messages.json',
    'LICENSE'
]);

function validatePackage(targetVersion) {
    const version = targetVersion || JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'manifest.json'), 'utf8')).version;
    const zipName = `aw-browser-cleaner-v${version}.zip`;
    const zipPath = path.join(DIST_DIR, zipName);
    const sha256Path = path.join(DIST_DIR, `${zipName}.sha256`);

    console.log(`🔍 Validating package: ${zipName}...`);

    if (!fs.existsSync(zipPath)) {
        console.error(`❌ ZIP package not found at: ${zipPath}`);
        process.exit(1);
    }

    if (!fs.existsSync(sha256Path)) {
        console.error(`❌ SHA-256 file not found at: ${sha256Path}`);
        process.exit(1);
    }

    // 1. Verify SHA-256 checksum
    const zipBuffer = fs.readFileSync(zipPath);
    const computedHash = crypto.createHash('sha256').update(zipBuffer).digest('hex');
    const recordedHash = fs.readFileSync(sha256Path, 'utf8').trim().split(/\s+/)[0];

    if (computedHash !== recordedHash) {
        console.error(`❌ SHA-256 checksum mismatch!`);
        console.error(`   Computed: ${computedHash}`);
        console.error(`   Recorded: ${recordedHash}`);
        process.exit(1);
    }
    console.log(`  ✓ SHA-256 checksum matches (${computedHash.slice(0, 16)}...)`);

    // 2. Inspect ZIP contents
    const output = execSync(`unzip -Z1 "${zipPath}"`, { encoding: 'utf8' }).trim();
    const entries = output.split('\n').map(e => e.trim()).filter(Boolean);

    let disallowed = [];
    for (const entry of entries) {
        if (!ALLOWED_FILES.has(entry)) {
            disallowed.push(entry);
        }
    }

    if (disallowed.length > 0) {
        console.error(`❌ Disallowed files found in package:`);
        disallowed.forEach(f => console.error(`   - ${f}`));
        process.exit(1);
    }

    // 3. Verify all expected files are present
    let missing = [];
    const entrySet = new Set(entries);
    for (const file of ALLOWED_FILES) {
        if (!entrySet.has(file)) {
            missing.push(file);
        }
    }

    if (missing.length > 0) {
        console.error(`❌ Expected runtime files missing from package:`);
        missing.forEach(f => console.error(`   - ${f}`));
        process.exit(1);
    }

    console.log(`  ✓ All ${entries.length} package entries match allowed runtime specification.`);
    console.log(`\n✅ Package validation passed successfully!`);
}

const argVersion = process.argv[2];
validatePackage(argVersion);
