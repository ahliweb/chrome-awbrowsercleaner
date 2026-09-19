#!/usr/bin/env bun
/**
 * AW Browser Cleaner - Deterministic Packaging Script
 *
 * Builds a clean ZIP package containing only runtime-required files
 * for Chrome Web Store upload, and generates SHA-256 checksums.
 *
 * Usage:
 *   bun scripts/build-package.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

// Files required for runtime execution in Chrome Web Store package
const RUNTIME_FILES = [
    'manifest.json',
    'popup.html',
    'popup.js',
    'origin-utils.js',
    'styles.css',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png',
    'LICENSE'
];

function buildPackage() {
    console.log('📦 Starting extension build package...');

    // 1. Read manifest version
    const manifestPath = path.join(ROOT_DIR, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const version = manifest.version;
    const zipName = `aw-browser-cleaner-v${version}.zip`;
    const zipPath = path.join(DIST_DIR, zipName);
    const sha256Path = path.join(DIST_DIR, `${zipName}.sha256`);

    console.log(`  Target version: ${version}`);
    console.log(`  Output artifact: ${zipName}`);

    // 2. Ensure dist directory exists
    if (!fs.existsSync(DIST_DIR)) {
        fs.mkdirSync(DIST_DIR, { recursive: true });
    }

    // Clean prior build artifact if existing
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    if (fs.existsSync(sha256Path)) fs.unlinkSync(sha256Path);

    // 3. Verify all required files exist
    for (const file of RUNTIME_FILES) {
        const fullPath = path.join(ROOT_DIR, file);
        if (!fs.existsSync(fullPath)) {
            console.error(`❌ Required file missing: ${file}`);
            process.exit(1);
        }
    }

    // 4. Create ZIP archive with required files
    const fileList = RUNTIME_FILES.join(' ');
    try {
        execSync(`zip -q -9 "${zipPath}" ${fileList}`, {
            cwd: ROOT_DIR,
            stdio: 'inherit'
        });
    } catch (e) {
        console.error(`❌ Failed to create zip package:`, e.message);
        process.exit(1);
    }

    // 5. Generate SHA-256 checksum
    const zipBuffer = fs.readFileSync(zipPath);
    const hash = crypto.createHash('sha256').update(zipBuffer).digest('hex');
    const sha256Content = `${hash}  ${zipName}\n`;
    fs.writeFileSync(sha256Path, sha256Content, 'utf8');

    const stats = fs.statSync(zipPath);
    console.log(`\n✅ Package built successfully!`);
    console.log(`  File:     ${zipPath} (${stats.size} bytes)`);
    console.log(`  SHA-256:  ${hash}`);
    console.log(`  Checksum: ${sha256Path}`);
}

buildPackage();
