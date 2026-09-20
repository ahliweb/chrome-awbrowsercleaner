#!/usr/bin/env bun
/**
 * Chrome Web Store API Automated Upload & Publish Script
 *
 * Automates uploading extension packages to Google Chrome Web Store Developer Dashboard
 * using Chrome Web Store Publish API v1.1.
 *
 * Environment variables:
 * - CWS_EXTENSION_ID    : Chrome Web Store Item ID (default: njflkejajbifofomeebakgebgcincepf)
 * - CWS_CLIENT_ID       : Google Cloud OAuth 2.0 Client ID
 * - CWS_CLIENT_SECRET   : Google Cloud OAuth 2.0 Client Secret
 * - CWS_REFRESH_TOKEN   : OAuth 2.0 Refresh Token with chromewebstore scope
 * - CWS_AUTO_PUBLISH    : Set to 'true' to automatically submit for review after upload
 * - STRICT_UPLOAD       : Set to 'true' to fail if secrets are missing (default: false in CI)
 *
 * Usage:
 *   bun scripts/upload-cws.js
 *   bun scripts/upload-cws.js --dry-run
 *   bun scripts/upload-cws.js --publish
 *   bun scripts/upload-cws.js dist/aw-browser-cleaner-v1.2.0.zip
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_EXTENSION_ID = 'njflkejajbifofomeebakgebgcincepf';

function parseCliArgs(argv = process.argv.slice(2)) {
    let dryRun = false;
    let publish = false;
    let customFile = null;

    for (const arg of argv) {
        if (arg === '--dry-run') {
            dryRun = true;
        } else if (arg === '--publish') {
            publish = true;
        } else if (arg.startsWith('--file=')) {
            customFile = arg.slice(7);
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else if (!arg.startsWith('-') && !customFile) {
            customFile = arg;
        }
    }

    return { dryRun, publish, customFile };
}

function printHelp() {
    console.log(`
AW Browser Cleaner — Chrome Web Store Automated Upload

Usage:
  bun scripts/upload-cws.js [options] [zip-file]

Options:
  --dry-run       Verify package and check environment credentials without calling API
  --publish       Submit extension for review immediately after upload
  --file=<path>   Specify path to zip package
  --help, -h      Show this help message

Required Environment Variables:
  CWS_CLIENT_ID       Google Cloud OAuth Client ID
  CWS_CLIENT_SECRET   Google Cloud OAuth Client Secret
  CWS_REFRESH_TOKEN   OAuth Refresh Token

Optional Environment Variables:
  CWS_EXTENSION_ID    Item ID (default: ${DEFAULT_EXTENSION_ID})
  CWS_AUTO_PUBLISH    Submit for review if 'true'
  STRICT_UPLOAD       Exit with code 1 if credentials are missing (default: false)
`);
}

function resolvePackageZip(customPath) {
    if (customPath) {
        const resolved = path.resolve(process.cwd(), customPath);
        if (!fs.existsSync(resolved)) {
            throw new Error(`Specified package file not found: ${resolved}`);
        }
        return resolved;
    }

    const manifestPath = path.join(ROOT_DIR, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`manifest.json not found at ${manifestPath}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const version = manifest.version;
    const defaultZip = path.join(ROOT_DIR, 'dist', `aw-browser-cleaner-v${version}.zip`);

    if (!fs.existsSync(defaultZip)) {
        throw new Error(
            `Release package not found at: ${defaultZip}\n` +
            `Run 'bun run build:package' first to generate the artifact.`
        );
    }

    return defaultZip;
}

function validateCredentials(env = process.env) {
    const extensionId = env.CWS_EXTENSION_ID || DEFAULT_EXTENSION_ID;
    const clientId = env.CWS_CLIENT_ID;
    const clientSecret = env.CWS_CLIENT_SECRET;
    const refreshToken = env.CWS_REFRESH_TOKEN;
    const autoPublish = env.CWS_AUTO_PUBLISH === 'true';
    const isStrict = env.STRICT_UPLOAD === 'true';

    const isUnset = (v) => !v || v.trim() === '' || v.trim().toLowerCase() === 'placeholder';

    const missing = [];
    if (isUnset(clientId)) missing.push('CWS_CLIENT_ID');
    if (isUnset(clientSecret)) missing.push('CWS_CLIENT_SECRET');
    if (isUnset(refreshToken)) missing.push('CWS_REFRESH_TOKEN');

    return {
        isConfigured: missing.length === 0,
        missing,
        extensionId,
        clientId,
        clientSecret,
        refreshToken,
        autoPublish,
        isStrict
    };
}

async function getAccessToken(clientId, clientSecret, refreshToken) {
    console.log('🔑 Requesting Google OAuth2 access token...');

    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to obtain Google access token (${response.status}): ${errorData}`);
    }

    const data = await response.json();
    if (!data.access_token) {
        throw new Error('No access_token field returned in OAuth response.');
    }

    console.log('  ✓ OAuth2 access token obtained successfully.');
    return data.access_token;
}

async function uploadPackage(extensionId, accessToken, zipPath) {
    const zipStats = fs.statSync(zipPath);
    console.log(`📤 Uploading package to Chrome Web Store item ${extensionId}...`);
    console.log(`  File: ${path.basename(zipPath)} (${zipStats.size} bytes)`);

    const zipBuffer = fs.readFileSync(zipPath);
    const uploadUrl = `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${extensionId}`;

    const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-goog-api-version': '2',
            'Content-Type': 'application/zip'
        },
        body: zipBuffer
    });

    const result = await response.json();

    if (!response.ok || result.uploadState !== 'SUCCESS') {
        const errorDetails = JSON.stringify(result.itemError || result, null, 2);
        throw new Error(`Chrome Web Store package upload failed (${response.status}):\n${errorDetails}`);
    }

    console.log('  ✓ Package uploaded successfully (uploadState: SUCCESS).');
    return result;
}

async function publishPackage(extensionId, accessToken) {
    console.log(`🚀 Submitting package for Chrome Web Store review...`);
    const publishUrl = `https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish`;

    const response = await fetch(publishUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-goog-api-version': '2',
            'Content-Length': '0'
        }
    });

    const result = await response.json();

    if (!response.ok) {
        const errorDetails = JSON.stringify(result.itemError || result, null, 2);
        throw new Error(`Chrome Web Store review submission failed (${response.status}):\n${errorDetails}`);
    }

    console.log('  ✓ Package submitted for review successfully!');
    if (result.statusDetail) {
        console.log(`  Status details: ${result.statusDetail}`);
    }
    return result;
}

async function run() {
    console.log('🌐 Chrome Web Store Automated Upload Tool');
    console.log('=========================================');

    const { dryRun, publish, customFile } = parseCliArgs();
    const creds = validateCredentials(process.env);

    // 1. Resolve ZIP file
    let zipPath;
    try {
        zipPath = resolvePackageZip(customFile);
        console.log(`📦 Target package: ${path.basename(zipPath)}`);
    } catch (err) {
        console.error(`❌ ${err.message}`);
        process.exit(1);
    }

    // 2. Check credentials
    console.log(`🎯 Extension Item ID: ${creds.extensionId}`);
    if (!creds.isConfigured) {
        console.warn(`\n⚠️  Missing required Chrome Web Store API credentials:`);
        creds.missing.forEach(m => console.warn(`   - ${m}`));
        console.warn(`\nRefer to 'docs/chrome-web-store/API_UPLOAD_SETUP.md' for setup instructions.`);

        if (dryRun) {
            console.log('\n[Dry-run completed]: Package is valid. Configure the secrets above to enable automated upload.');
            process.exit(0);
        }

        if (creds.isStrict) {
            console.error('\n❌ STRICT_UPLOAD is enabled. Exiting with error.');
            process.exit(1);
        } else {
            console.log('\n⏭️  Skipping automated upload (credentials not yet configured).');
            process.exit(0);
        }
    }

    if (dryRun) {
        console.log('\n[Dry-run completed]: Package exists and all API credentials are configured.');
        process.exit(0);
    }

    // 3. Authenticate & Upload
    try {
        const accessToken = await getAccessToken(creds.clientId, creds.clientSecret, creds.refreshToken);
        await uploadPackage(creds.extensionId, accessToken, zipPath);

        const shouldPublish = publish || creds.autoPublish;
        if (shouldPublish) {
            await publishPackage(creds.extensionId, accessToken);
        } else {
            console.log(`\nℹ️  Package uploaded in draft state. Review at:`);
            console.log(`   https://chrome.google.com/webstore/devconsole/detail/${creds.extensionId}`);
            console.log(`   (Pass '--publish' or set CWS_AUTO_PUBLISH=true to submit automatically)`);
        }

        console.log('\n🎉 Done! All Chrome Web Store operations completed.');
    } catch (err) {
        console.error(`\n❌ Error: ${err.message}`);
        process.exit(1);
    }
}

// Export functions for unit testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        parseCliArgs,
        resolvePackageZip,
        validateCredentials,
        DEFAULT_EXTENSION_ID
    };
}

if (import.meta.main || (require.main === module)) {
    run();
}
