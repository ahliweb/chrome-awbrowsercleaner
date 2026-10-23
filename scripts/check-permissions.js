#!/usr/bin/env bun
/**
 * Permission Documentation Check — AW Browser Cleaner
 *
 * Keeps manifest.json and the permission documentation in sync:
 *
 * - every entry of `permissions`, `optional_host_permissions` and
 *   `externally_connectable.matches` must be documented in the machine-readable
 *   table of docs/PERMISSION_MATRIX.md (between the check-permissions markers);
 * - every entry documented in that table must still exist in the manifest;
 * - every install-time permission (`permissions`) must be named in PRIVACY.md;
 * - `host_permissions` must not exist at all: this extension never has permanent
 *   host access (host access comes from `activeTab` or per-origin optional grants).
 *
 * Usage:
 *   bun scripts/check-permissions.js
 *
 * The pure function `checkPermissions` is exported so tests do not need a process.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

/** Marker comments that delimit the machine-readable table in the matrix. */
const BEGIN_MARKER = '<!-- check-permissions:begin -->';
const END_MARKER = '<!-- check-permissions:end -->';

/** Manifest keys whose entries must be documented, in report order. */
const DOCUMENTED_KEYS = Object.freeze([
    'permissions',
    'optional_host_permissions',
    'externally_connectable.matches'
]);

/**
 * Lists the documented entries of a manifest as "key|entry" strings.
 *
 * @param {Object} manifest - Parsed manifest.json.
 * @returns {Array<{key: string, entry: string}>} Entries in manifest order.
 */
function manifestEntries(manifest) {
    const out = [];
    const add = (key, list) => {
        if (!Array.isArray(list)) return;
        for (const entry of list) out.push({ key, entry: String(entry) });
    };
    add('permissions', manifest && manifest.permissions);
    add('optional_host_permissions', manifest && manifest.optional_host_permissions);
    add(
        'externally_connectable.matches',
        manifest && manifest.externally_connectable && manifest.externally_connectable.matches
    );
    return out;
}

/**
 * Reads the documented entries from the marked table of the permission matrix.
 * Each table row starts with two backticked cells: the entry and its manifest key.
 *
 * @param {string} matrixText - Contents of docs/PERMISSION_MATRIX.md.
 * @returns {{found: boolean, entries: Array<{key: string, entry: string}>}} Parsed table.
 */
function parseMatrix(matrixText) {
    const text = String(matrixText || '');
    const start = text.indexOf(BEGIN_MARKER);
    const end = text.indexOf(END_MARKER);
    if (start === -1 || end === -1 || end < start) return { found: false, entries: [] };

    const block = text.slice(start + BEGIN_MARKER.length, end);
    const entries = [];
    for (const line of block.split('\n')) {
        const match = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/.exec(line);
        if (match) entries.push({ entry: match[1], key: match[2] });
    }
    return { found: true, entries };
}

/**
 * Checks the manifest against the permission documentation.
 *
 * @param {Object} input
 * @param {Object} input.manifest - Parsed manifest.json.
 * @param {string} input.matrix - Contents of docs/PERMISSION_MATRIX.md.
 * @param {string} input.privacy - Contents of PRIVACY.md.
 * @returns {{ok: boolean, errors: string[]}} Result; `errors` is empty when ok.
 */
function checkPermissions({ manifest, matrix, privacy }) {
    const errors = [];

    if (manifest && Object.prototype.hasOwnProperty.call(manifest, 'host_permissions')) {
        errors.push(
            'manifest.json declares "host_permissions". This extension must never have permanent host access; ' +
            'use "activeTab" or "optional_host_permissions" requested per origin.'
        );
    }

    const actual = manifestEntries(manifest);
    const parsed = parseMatrix(matrix);

    if (!parsed.found) {
        errors.push(
            `docs/PERMISSION_MATRIX.md has no machine-readable table: wrap it in ${BEGIN_MARKER} and ${END_MARKER}.`
        );
    } else {
        const id = ({ key, entry }) => `${key}|${entry}`;
        const documented = new Set(parsed.entries.map(id));
        const present = new Set(actual.map(id));

        for (const item of actual) {
            if (!documented.has(id(item))) {
                errors.push(
                    `docs/PERMISSION_MATRIX.md does not document ${item.key} entry "${item.entry}" from manifest.json.`
                );
            }
        }
        for (const item of parsed.entries) {
            if (!DOCUMENTED_KEYS.includes(item.key)) {
                errors.push(
                    `docs/PERMISSION_MATRIX.md lists "${item.entry}" under unknown manifest key "${item.key}" ` +
                    `(expected one of: ${DOCUMENTED_KEYS.join(', ')}).`
                );
            } else if (!present.has(id(item))) {
                errors.push(
                    `docs/PERMISSION_MATRIX.md documents ${item.key} entry "${item.entry}", ` +
                    'which manifest.json no longer has.'
                );
            }
        }
    }

    const privacyText = String(privacy || '');
    const installTime = Array.isArray(manifest && manifest.permissions) ? manifest.permissions : [];
    for (const permission of installTime) {
        if (!privacyText.includes('`' + permission + '`')) {
            errors.push(`PRIVACY.md does not mention install-time permission \`${permission}\`.`);
        }
    }

    return { ok: errors.length === 0, errors };
}

/**
 * Runs the check against the files of a repository checkout.
 *
 * @param {{rootDir?: string}} [options] - Directory holding manifest.json, PRIVACY.md and docs/.
 * @returns {{ok: boolean, errors: string[]}} Result.
 */
function runCheck({ rootDir = ROOT_DIR } = {}) {
    const read = (...parts) => fs.readFileSync(path.join(rootDir, ...parts), 'utf8');
    let manifest;
    try {
        manifest = JSON.parse(read('manifest.json'));
    } catch (e) {
        return { ok: false, errors: [`Cannot read manifest.json: ${e.message}`] };
    }
    let matrix;
    let privacy;
    try {
        matrix = read('docs', 'PERMISSION_MATRIX.md');
        privacy = read('PRIVACY.md');
    } catch (e) {
        return { ok: false, errors: [`Cannot read documentation: ${e.message}`] };
    }
    return checkPermissions({ manifest, matrix, privacy });
}

module.exports = { checkPermissions, parseMatrix, manifestEntries, runCheck, BEGIN_MARKER, END_MARKER };

if (require.main === module) {
    const result = runCheck();
    if (!result.ok) {
        console.error('Permission documentation check failed:');
        for (const error of result.errors) console.error(`  - ${error}`);
        process.exit(1);
    }
    console.log('Permission documentation is in sync with manifest.json.');
}
