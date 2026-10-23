/**
 * AW Browser Cleaner - permission documentation check tests
 *
 * scripts/check-permissions.js keeps manifest.json, docs/PERMISSION_MATRIX.md and PRIVACY.md in sync.
 * These tests run it against the real repository (must pass) and against synthetic manifests
 * (must fail with a clear message).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { checkPermissions, parseMatrix, runCheck, BEGIN_MARKER, END_MARKER } =
    require('../../scripts/check-permissions.js');

const ROOT_DIR = path.resolve(import.meta.dir, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT_DIR, p), 'utf8');

const manifest = JSON.parse(read('manifest.json'));
const matrix = read('docs/PERMISSION_MATRIX.md');
const privacy = read('PRIVACY.md');

describe('check-permissions against the real repository', () => {
    test('passes', () => {
        const result = runCheck({ rootDir: ROOT_DIR });
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);
    });

    test('the matrix documents every manifest entry', () => {
        const { found, entries } = parseMatrix(matrix);
        expect(found).toBe(true);
        const documented = entries.map((e) => `${e.key}|${e.entry}`);
        for (const p of manifest.permissions) expect(documented).toContain(`permissions|${p}`);
        for (const p of manifest.optional_host_permissions) expect(documented).toContain(`optional_host_permissions|${p}`);
        for (const p of manifest.externally_connectable.matches) {
            expect(documented).toContain(`externally_connectable.matches|${p}`);
        }
    });

    test('the manifest has no permanent host access', () => {
        expect('host_permissions' in manifest).toBe(false);
    });
});

describe('checkPermissions (pure function)', () => {
    test('accepts the real inputs', () => {
        expect(checkPermissions({ manifest, matrix, privacy })).toEqual({ ok: true, errors: [] });
    });

    test('fails when an install-time permission is not in the matrix', () => {
        const changed = { ...manifest, permissions: [...manifest.permissions, 'history'] };
        const result = checkPermissions({ manifest: changed, matrix, privacy });
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toContain('does not document permissions entry "history"');
        // Not documented in PRIVACY.md either.
        expect(result.errors.join('\n')).toContain('PRIVACY.md does not mention install-time permission `history`');
    });

    test('fails when an optional host permission is not in the matrix', () => {
        const changed = { ...manifest, optional_host_permissions: [...manifest.optional_host_permissions, 'ftp://*/*'] };
        const result = checkPermissions({ manifest: changed, matrix, privacy });
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toContain('optional_host_permissions entry "ftp://*/*"');
    });

    test('fails when an externally_connectable match is not in the matrix', () => {
        const changed = {
            ...manifest,
            externally_connectable: { matches: [...manifest.externally_connectable.matches, 'https://example.com/*'] }
        };
        const result = checkPermissions({ manifest: changed, matrix, privacy });
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toContain('externally_connectable.matches entry "https://example.com/*"');
    });

    test('fails when the matrix documents a permission the manifest no longer has', () => {
        const changed = { ...manifest, permissions: manifest.permissions.filter((p) => p !== 'contextMenus') };
        const result = checkPermissions({ manifest: changed, matrix, privacy });
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toContain('documents permissions entry "contextMenus", which manifest.json no longer has');
    });

    test('fails when an install-time permission is missing from PRIVACY.md', () => {
        const result = checkPermissions({ manifest, matrix, privacy: privacy.replaceAll('`scripting`', 'scripting') });
        expect(result.ok).toBe(false);
        expect(result.errors).toEqual(['PRIVACY.md does not mention install-time permission `scripting`.']);
    });

    test('does not require optional host permissions in PRIVACY.md', () => {
        const stripped = privacy.replaceAll('http://*/*', '').replaceAll('https://*/*', '');
        expect(checkPermissions({ manifest, matrix, privacy: stripped }).ok).toBe(true);
    });

    test('fails when host_permissions exists at all', () => {
        for (const host_permissions of [['<all_urls>'], []]) {
            const result = checkPermissions({ manifest: { ...manifest, host_permissions }, matrix, privacy });
            expect(result.ok).toBe(false);
            expect(result.errors[0]).toContain('host_permissions');
            expect(result.errors[0]).toContain('permanent host access');
        }
    });

    test('fails when the matrix has no machine-readable table', () => {
        const result = checkPermissions({ manifest, matrix: matrix.replace(BEGIN_MARKER, '').replace(END_MARKER, ''), privacy });
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toContain('machine-readable table');
    });

    test('rejects an unknown manifest key in the matrix', () => {
        const bad = matrix.replace('| `storage` | `permissions` |', '| `storage` | `permission` |');
        const result = checkPermissions({ manifest, matrix: bad, privacy });
        expect(result.ok).toBe(false);
        expect(result.errors.join('\n')).toContain('unknown manifest key "permission"');
    });
});

describe('runCheck with a temporary repository copy', () => {
    function makeRepo(manifestObject) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-check-permissions-'));
        fs.mkdirSync(path.join(dir, 'docs'));
        fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifestObject, null, 2));
        fs.writeFileSync(path.join(dir, 'docs', 'PERMISSION_MATRIX.md'), matrix);
        fs.writeFileSync(path.join(dir, 'PRIVACY.md'), privacy);
        return dir;
    }

    test('passes with the real manifest', () => {
        const dir = makeRepo(manifest);
        try {
            expect(runCheck({ rootDir: dir }).ok).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('fails with an undocumented permission', () => {
        const dir = makeRepo({ ...manifest, permissions: [...manifest.permissions, 'downloads'] });
        try {
            const result = runCheck({ rootDir: dir });
            expect(result.ok).toBe(false);
            expect(result.errors.join('\n')).toContain('"downloads"');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the command line exits with status 1 and prints the reason', () => {
        const dir = makeRepo({ ...manifest, host_permissions: ['<all_urls>'] });
        try {
            const script = path.join(ROOT_DIR, 'scripts', 'check-permissions.js');
            // The script always checks its own repository; run it in a copy to see the failure path.
            const copy = path.join(dir, 'scripts');
            fs.mkdirSync(copy);
            fs.copyFileSync(script, path.join(copy, 'check-permissions.js'));
            const run = Bun.spawnSync(['bun', path.join(copy, 'check-permissions.js')], { stdout: 'pipe', stderr: 'pipe' });
            expect(run.exitCode).toBe(1);
            expect(run.stderr.toString()).toContain('host_permissions');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
