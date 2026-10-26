'use strict';

// ESLint flat config. The `no-restricted-syntax` rules are the lint half of the
// Scope Guard: only cleanup-core.js may touch browsingData, chrome.cookies.remove
// or per-type browsingData remove* calls. Do not weaken them.
const globals = require('globals');

const SCOPE_GUARD = [
    'error',
    {
        selector: "MemberExpression[property.name='browsingData']",
        message: 'browsingData may only be used in cleanup-core.js (Scope Guard).'
    },
    {
        selector: "MemberExpression[computed=true][property.value='browsingData']",
        message: 'browsingData may only be used in cleanup-core.js (Scope Guard).'
    },
    {
        selector: "MemberExpression[property.name='remove'][object.property.name='cookies']",
        message: 'chrome.cookies.remove may only be used in cleanup-core.js (Scope Guard).'
    },
    {
        selector: "MemberExpression[computed=true][property.value='remove'][object.property.name='cookies']",
        message: 'chrome.cookies.remove may only be used in cleanup-core.js (Scope Guard).'
    },
    {
        selector: 'CallExpression[callee.property.name=/^(removeCache|removeHistory|removeDownloads|removeFormData|removePasswords|removePluginData|removeAppcache|removeWebSQL|removeFileSystems|removeCookies|removeLocalStorage|removeIndexedDB|removeServiceWorkers|removeCacheStorage)$/]',
        message: 'Per-type browsingData removal calls may only be used in cleanup-core.js (Scope Guard).'
    }
];

module.exports = [
    { ignores: ['node_modules/**', 'dist/**', 'test-artifacts/**'] },
    {
        files: ['**/*.js'],
        // ESLint 8 did not report unused disable directives; keep that so shipped
        // runtime files need no edit (presets.js has a harmless legacy directive).
        linterOptions: { reportUnusedDisableDirectives: 'off' },
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                ...globals.node,
                ...globals.es2021
            }
        },
        rules: {
            // caughtErrors: 'none' keeps the ESLint 8 behaviour (v9+ defaults to 'all').
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
            'no-undef': 'error',
            'no-restricted-syntax': SCOPE_GUARD
        }
    },
    {
        files: ['cleanup-core.js'],
        rules: { 'no-restricted-syntax': 'off' }
    },
    {
        files: ['tests/**/*.js'],
        languageOptions: { globals: { ...globals.jest } },
        rules: { 'no-restricted-syntax': 'off' }
    }
];
