/**
 * AW Browser Cleaner - Runtime package file list
 *
 * Single source of truth for the files shipped in the extension ZIP.
 * Used by build-package.js (what to pack) and validate-package.js
 * (what is allowed and required), so the two can never drift apart.
 */

const RUNTIME_FILES = Object.freeze([
    'manifest.json',
    'popup.html',
    'popup.js',
    'popup-result.js',
    'popup-unsupported.js',
    'origin-utils.js',
    'cleanup-core.js',
    'cookie-engine.js',
    'background.js',
    'chrome-helpers.js',
    'presets.js',
    'settings.js',
    'report.js',
    'page-probes.js',
    'i18n.js',
    'styles.css',
    'screens.css',
    'fonts/inter-latin-wght.woff2',
    'fonts/jetbrains-mono-latin-wght.woff2',
    'fonts/OFL-Inter.txt',
    'fonts/OFL-JetBrainsMono.txt',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png',
    '_locales/en/messages.json',
    '_locales/id/messages.json',
    'LICENSE'
]);

module.exports = { RUNTIME_FILES };
