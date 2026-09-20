#!/usr/bin/env bun
/**
 * Interactive Automated Setup Wizard for Chrome Web Store Credentials
 *
 * This wizard helps:
 * 1. Exchange Client ID & Secret for a Refresh Token (via local server or OAuth code)
 * 2. Automatically push secrets to GitHub Repository Secrets using `gh secret set`
 * 3. Save to local `.env` file (protected by .gitignore)
 * 4. Verify end-to-end configuration
 *
 * Usage:
 *   bun scripts/setup-cws-credentials.js
 *   bun scripts/setup-cws-credentials.js --client-id=... --client-secret=... --refresh-token=...
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_EXTENSION_ID = 'njflkejajbifofomeebakgebgcincepf';
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const PORT = 8933;
const REDIRECT_URI = `http://localhost:${PORT}`;

function createPrompt() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return (query) => new Promise((resolve) => rl.question(query, (ans) => resolve(ans.trim())));
}

function parseFlags() {
    const flags = {};
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith('--client-id=')) flags.clientId = arg.slice(12);
        if (arg.startsWith('--client-secret=')) flags.clientSecret = arg.slice(16);
        if (arg.startsWith('--refresh-token=')) flags.refreshToken = arg.slice(16);
        if (arg.startsWith('--extension-id=')) flags.extensionId = arg.slice(15);
    }
    return flags;
}

async function exchangeAuthCodeForTokens(clientId, clientSecret, authCode, redirectUri) {
    const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: authCode,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to exchange authorization code (${response.status}): ${errText}`);
    }

    const data = await response.json();
    if (!data.refresh_token) {
        throw new Error(
            'Google did not return a refresh_token in response.\n' +
            'This happens if access was previously authorized without prompt=consent.\n' +
            'Please revoke access or add prompt=consent, then try again.'
        );
    }

    return data.refresh_token;
}

async function captureOAuthCodeWithLocalServer(clientId, clientSecret) {
    return new Promise((resolve, reject) => {
        let server;
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
            client_id: clientId,
            redirect_uri: REDIRECT_URI,
            response_type: 'code',
            scope: OAUTH_SCOPE,
            access_type: 'offline',
            prompt: 'consent'
        }).toString();

        console.log('\n🌐 Silakan buka URL berikut di browser untuk mengizinkan akses:');
        console.log(`\n  \x1b[36m${authUrl}\x1b[0m\n`);
        console.log(`Menunggu otorisasi via ${REDIRECT_URI} ... (atau tekan Ctrl+C untuk batal)`);

        server = Bun.serve({
            port: PORT,
            async fetch(req) {
                const url = new URL(req.url);
                const code = url.searchParams.get('code');
                const error = url.searchParams.get('error');

                if (error) {
                    setTimeout(() => { server.stop(); reject(new Error(`Otorisasi ditolak: ${error}`)); }, 500);
                    return new Response(`<h1>Otorisasi Gagal</h1><p>${error}</p>`, {
                        headers: { 'Content-Type': 'text/html' }
                    });
                }

                if (code) {
                    setTimeout(async () => {
                        try {
                            const refreshToken = await exchangeAuthCodeForTokens(clientId, clientSecret, code, REDIRECT_URI);
                            server.stop();
                            resolve(refreshToken);
                        } catch (err) {
                            server.stop();
                            reject(err);
                        }
                    }, 500);

                    return new Response(
                        `<html><body style="font-family:sans-serif;text-align:center;padding:50px;">
                            <h2 style="color:#22c55e;">✓ Otorisasi Berhasil!</h2>
                            <p>Refresh token berhasil diambil. Anda dapat menutup tab ini dan kembali ke terminal.</p>
                        </body></html>`,
                        { headers: { 'Content-Type': 'text/html' } }
                    );
                }

                return new Response('Menunggu kode otorisasi...', { headers: { 'Content-Type': 'text/plain' } });
            }
        });
    });
}

function setGitHubSecret(secretName, secretValue) {
    try {
        execSync(`gh secret set ${secretName} -b "${secretValue.replace(/"/g, '\\"')}"`, {
            cwd: ROOT_DIR,
            stdio: 'pipe'
        });
        console.log(`  ✓ GitHub Secret '${secretName}' berhasil disetel!`);
        return true;
    } catch (err) {
        console.warn(`  ⚠️  Gagal menyetel GitHub Secret '${secretName}': ${err.message}`);
        return false;
    }
}

async function main() {
    console.log('🚀 Wizard Konfigurasi Otomatisasi Chrome Web Store API');
    console.log('====================================================\n');

    const prompt = createPrompt();
    const flags = parseFlags();

    let clientId = flags.clientId || process.env.CWS_CLIENT_ID;
    let clientSecret = flags.clientSecret || process.env.CWS_CLIENT_SECRET;
    let refreshToken = flags.refreshToken || process.env.CWS_REFRESH_TOKEN;
    let extensionId = flags.extensionId || process.env.CWS_EXTENSION_ID || DEFAULT_EXTENSION_ID;

    // 1. Dapatkan Client ID
    if (!clientId) {
        console.log('📌 Langkah 1: Masukkan Google OAuth 2.0 Client ID');
        console.log('   (Dibuat di Google Cloud Console > APIs & Services > Credentials)');
        clientId = await prompt('   Client ID: ');
    }

    if (!clientId) {
        console.error('❌ Client ID wajib diisi.');
        process.exit(1);
    }

    // 2. Dapatkan Client Secret
    if (!clientSecret) {
        console.log('\n📌 Langkah 2: Masukkan Google OAuth 2.0 Client Secret');
        clientSecret = await prompt('   Client Secret: ');
    }

    if (!clientSecret) {
        console.error('❌ Client Secret wajib diisi.');
        process.exit(1);
    }

    // 3. Dapatkan Refresh Token
    if (!refreshToken) {
        console.log('\n📌 Langkah 3: Pengambilan Refresh Token');
        console.log('   Pilihan alur:');
        console.log('   [1] Otomatis via browser lokal (localhost:8933)');
        console.log('   [2] Input manual (jika sudah didapat dari Google OAuth Playground)');
        const choice = await prompt('   Pilih opsi [1/2] (default: 1): ');

        if (choice === '2') {
            refreshToken = await prompt('   Refresh Token: ');
        } else {
            try {
                refreshToken = await captureOAuthCodeWithLocalServer(clientId, clientSecret);
                console.log('  ✓ Refresh Token berhasil didapatkan secara otomatis!');
            } catch (err) {
                console.warn(`\n⚠️  Alur otomatis gagal: ${err.message}`);
                console.log('Beralih ke input manual...');
                refreshToken = await prompt('   Refresh Token: ');
            }
        }
    }

    if (!refreshToken) {
        console.error('❌ Refresh Token wajib diisi.');
        process.exit(1);
    }

    // 4. Update GitHub Secrets via `gh`
    console.log('\n📌 Langkah 4: Menyinkronkan ke GitHub Repository Secrets...');
    setGitHubSecret('CWS_CLIENT_ID', clientId);
    setGitHubSecret('CWS_CLIENT_SECRET', clientSecret);
    setGitHubSecret('CWS_REFRESH_TOKEN', refreshToken);
    setGitHubSecret('CWS_EXTENSION_ID', extensionId);

    // 5. Simpan ke .env lokal
    console.log('\n📌 Langkah 5: Menyimpan ke file .env lokal (diabaikan oleh git)...');
    const envContent = [
        `# Chrome Web Store API Credentials`,
        `CWS_EXTENSION_ID=${extensionId}`,
        `CWS_CLIENT_ID=${clientId}`,
        `CWS_CLIENT_SECRET=${clientSecret}`,
        `CWS_REFRESH_TOKEN=${refreshToken}`,
        `CWS_AUTO_PUBLISH=true`
    ].join('\n') + '\n';

    fs.writeFileSync(path.join(ROOT_DIR, '.env'), envContent, 'utf8');
    console.log('  ✓ File .env lokal berhasil dibuat!');

    // 6. Jalankan Verifikasi Dry-run
    console.log('\n📌 Langkah 6: Menjalankan uji verifikasi (Dry-run)...');
    try {
        const out = execSync('bun scripts/upload-cws.js --dry-run', {
            cwd: ROOT_DIR,
            encoding: 'utf8',
            env: {
                ...process.env,
                CWS_CLIENT_ID: clientId,
                CWS_CLIENT_SECRET: clientSecret,
                CWS_REFRESH_TOKEN: refreshToken,
                CWS_EXTENSION_ID: extensionId
            }
        });
        console.log(out);
        console.log('🎉 Setup Selesai 100%! Otomatisasi Chrome Web Store API siap digunakan.');
    } catch (err) {
        console.error(`❌ Uji verifikasi gagal: ${err.message}`);
    }

    process.exit(0);
}

if (import.meta.main || require.main === module) {
    main();
}
