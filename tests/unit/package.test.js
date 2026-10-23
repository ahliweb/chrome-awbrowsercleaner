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

describe('Package build targets', () => {
    const crypto = require('crypto');
    const { spawnSync } = require('child_process');
    const { RUNTIME_FILES } = require('../../scripts/package-files');
    const version = require('../../manifest.json').version;
    const chromeZip = path.join(DIST_DIR, `aw-browser-cleaner-v${version}.zip`);
    const edgeZip = path.join(DIST_DIR, `aw-browser-cleaner-edge-v${version}.zip`);
    const edgeSha = `${edgeZip}.sha256`;

    const run = (cmd) => execSync(cmd, { cwd: ROOT_DIR, stdio: 'pipe', encoding: 'utf8' });

    test('build-package --target=edge produces the edge zip and sha256', () => {
        run('bun scripts/build-package.js --target=edge');

        expect(fs.existsSync(edgeZip)).toBe(true);
        expect(fs.existsSync(edgeSha)).toBe(true);

        const shaContent = fs.readFileSync(edgeSha, 'utf8').trim();
        expect(shaContent).toMatch(/^[a-f0-9]{64}\s+aw-browser-cleaner-edge-v\S+\.zip$/);

        const recorded = shaContent.split(/\s+/)[0];
        const computed = crypto.createHash('sha256').update(fs.readFileSync(edgeZip)).digest('hex');
        expect(recorded).toBe(computed);
    });

    test('edge package has the same entries and manifest as the chrome package', () => {
        run('bun scripts/build-package.js');
        run('bun scripts/build-package.js --target=edge');

        const edgeEntries = run(`unzip -Z1 "${edgeZip}"`).trim().split('\n').map(e => e.trim()).sort();
        expect(edgeEntries).toEqual([...RUNTIME_FILES].sort());

        const edgeManifest = run(`unzip -p "${edgeZip}" manifest.json`);
        const chromeManifest = run(`unzip -p "${chromeZip}" manifest.json`);
        expect(edgeManifest).toBe(chromeManifest);
    });

    test('validate-package --target=edge passes for the edge artifact', () => {
        run('bun scripts/build-package.js --target=edge');
        expect(() => run('bun scripts/validate-package.js --target=edge')).not.toThrow();
    });

    test('validate-package accepts a version and --target=edge together, in either order', () => {
        run('bun scripts/build-package.js --target=edge');
        expect(() => run(`bun scripts/validate-package.js ${version} --target=edge`)).not.toThrow();
        expect(() => run(`bun scripts/validate-package.js --target=edge ${version}`)).not.toThrow();
    });

    test('unknown target fails with a non-zero exit code in both scripts', () => {
        for (const script of ['scripts/build-package.js', 'scripts/validate-package.js']) {
            const result = spawnSync('bun', [script, '--target=firefox'], { cwd: ROOT_DIR, encoding: 'utf8' });
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain('Unknown target');
        }
    });

    test('chrome artifact name is unchanged when no target is given', () => {
        const output = run('bun scripts/build-package.js');
        expect(output).toContain(`Output artifact: aw-browser-cleaner-v${version}.zip`);
        expect(output).not.toContain('aw-browser-cleaner-edge');
        expect(fs.existsSync(chromeZip)).toBe(true);
        expect(fs.existsSync(`${chromeZip}.sha256`)).toBe(true);
    });
});
