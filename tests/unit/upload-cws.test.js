/**
 * AW Browser Cleaner - Chrome Web Store Automated Upload Unit Tests
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const {
    parseCliArgs,
    resolvePackageZip,
    validateCredentials,
    DEFAULT_EXTENSION_ID
} = require('../../scripts/upload-cws.js');

describe('Chrome Web Store Upload Script', () => {
    describe('parseCliArgs', () => {
        test('parses --dry-run correctly', () => {
            const args = parseCliArgs(['--dry-run']);
            expect(args.dryRun).toBe(true);
            expect(args.publish).toBe(false);
            expect(args.customFile).toBeNull();
        });

        test('parses --publish correctly', () => {
            const args = parseCliArgs(['--publish']);
            expect(args.publish).toBe(true);
            expect(args.dryRun).toBe(false);
        });

        test('parses --file=path/to/zip correctly', () => {
            const args = parseCliArgs(['--file=custom/test.zip']);
            expect(args.customFile).toBe('custom/test.zip');
        });

        test('parses positional zip file path correctly', () => {
            const args = parseCliArgs(['dist/test.zip', '--publish']);
            expect(args.customFile).toBe('dist/test.zip');
            expect(args.publish).toBe(true);
        });
    });

    describe('validateCredentials', () => {
        test('identifies missing credentials when environment is empty', () => {
            const res = validateCredentials({});
            expect(res.isConfigured).toBe(false);
            expect(res.missing).toContain('CWS_CLIENT_ID');
            expect(res.missing).toContain('CWS_CLIENT_SECRET');
            expect(res.missing).toContain('CWS_REFRESH_TOKEN');
            expect(res.extensionId).toBe(DEFAULT_EXTENSION_ID);
        });

        test('detects custom extension id and partial credentials', () => {
            const res = validateCredentials({
                CWS_EXTENSION_ID: 'custom_id_123',
                CWS_CLIENT_ID: 'client_xyz'
            });
            expect(res.isConfigured).toBe(false);
            expect(res.extensionId).toBe('custom_id_123');
            expect(res.missing).toEqual(['CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN']);
        });

        test('confirms valid credentials when all required variables are set', () => {
            const res = validateCredentials({
                CWS_CLIENT_ID: 'mock_client_id',
                CWS_CLIENT_SECRET: 'mock_secret',
                CWS_REFRESH_TOKEN: 'mock_token',
                CWS_AUTO_PUBLISH: 'true'
            });
            expect(res.isConfigured).toBe(true);
            expect(res.missing).toHaveLength(0);
            expect(res.autoPublish).toBe(true);
        });
    });

    describe('resolvePackageZip', () => {
        test('resolves default package zip when built', () => {
            // Ensure package is built
            execSync('bun scripts/build-package.js', { cwd: ROOT_DIR, stdio: 'pipe' });

            const zipPath = resolvePackageZip();
            expect(fs.existsSync(zipPath)).toBe(true);
            expect(zipPath).toContain('aw-browser-cleaner-v');
            expect(zipPath.endsWith('.zip')).toBe(true);
        });

        test('throws descriptive error if custom file path does not exist', () => {
            expect(() => {
                resolvePackageZip('non_existent_archive_123.zip');
            }).toThrow('Specified package file not found');
        });
    });

    describe('CLI dry-run execution', () => {
        test('runs dry-run mode cleanly without throwing', () => {
            const output = execSync('bun scripts/upload-cws.js --dry-run', {
                cwd: ROOT_DIR,
                encoding: 'utf8'
            });
            expect(output).toContain('Chrome Web Store Automated Upload Tool');
            expect(output).toContain('Target package:');
            expect(output).toContain('Dry-run completed');
        });
    });
});
