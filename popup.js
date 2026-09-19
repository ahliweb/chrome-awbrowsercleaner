/**
 * AW Browser Cleaner - Popup Logic
 * Handles user interactions and calls the chrome.browsingData API.
 *
 * Design principles:
 * - Uses exact origin (scheme + hostname + port) for precise targeting.
 * - Only HTTP(S) origins are supported.
 * - A single exact origin is passed to chrome.browsingData.remove.
 * - Unsupported schemes (chrome:, file:, about:, etc.) are rejected.
 * - All validation is delegated to origin-utils.js for testability.
 * - Cookie-inclusive cleanup requires explicit confirmation due to
 *   registrable-domain scope behavior documented by Chrome.
 */

/**
 * Retrieves a localized string from Chrome i18n API with fallback support.
 * @param {string} messageName - Key in messages.json.
 * @param {string|Array<string>} [substitutions] - Optional substitutions.
 * @returns {string} Localized message string.
 */
function getMessage(messageName, substitutions) {
    if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
        const msg = chrome.i18n.getMessage(messageName, substitutions);
        if (msg) return msg;
    }
    const fallbacks = {
        extensionName: 'AW Browser Cleaner',
        extensionDescription: 'Selectively clear site data for a specific origin',
        targetOriginLabel: 'Target Origin',
        targetOriginPlaceholder: 'https://example.com',
        useCurrentTabTitle: 'Use Current Tab',
        dataToClearLabel: 'Data to Clear',
        selectAll: 'Select All',
        deselectAll: 'Deselect All',
        dataTypeCache: 'Cache Storage',
        dataTypeCookies: 'Cookies',
        dataTypeLocalStorage: 'Local Storage',
        dataTypeIndexedDB: 'IndexedDB',
        dataTypeServiceWorkers: 'Service Workers',
        cookieWarningTitle: 'Cookie Warning:',
        cookieWarningBody: 'Clearing cookies may sign you out of related subdomains. Cookies can be shared across a registrable domain (e.g., clearing www.example.com may also affect .example.com cookies).',
        confirmTargetLabel: 'Target:',
        confirmDataLabel: 'Data:',
        confirmCookieNotice: 'Cookie cleanup may affect the entire registrable domain.',
        confirmCleanupBtn: 'Confirm Cleanup',
        cancelBtn: 'Cancel',
        clearSiteDataBtn: 'Clear Site Data',
        clearingStatus: 'Clearing...',
        cleanedSuccess: `Cleaned data for ${substitutions || ''}`,
        errorUnsupportedScheme: 'This page uses an unsupported scheme. Navigate to an HTTP(S) page.',
        errorSelectDataType: 'Please select at least one data type.',
        cleanupCancelled: 'Cleanup cancelled.',
        errorPrefix: `Error: ${substitutions || ''}`
    };
    return fallbacks[messageName] || messageName;
}

/**
 * Localizes all DOM elements containing data-i18n attributes.
 */
function localizeDocument() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('[data-i18n]').forEach(elem => {
        const key = elem.getAttribute('data-i18n');
        elem.textContent = getMessage(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(elem => {
        const key = elem.getAttribute('data-i18n-placeholder');
        elem.setAttribute('placeholder', getMessage(key));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(elem => {
        const key = elem.getAttribute('data-i18n-title');
        elem.setAttribute('title', getMessage(key));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(elem => {
        const key = elem.getAttribute('data-i18n-aria');
        elem.setAttribute('aria-label', getMessage(key));
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Localize static UI elements on load
    localizeDocument();

    const originInput = document.getElementById('originInput');
    const fillCurrentBtn = document.getElementById('fillCurrent');
    const clearBtn = document.getElementById('clearBtn');
    const statusMessage = document.getElementById('statusMessage');
    const selectAllBtn = document.getElementById('selectAll');
    const checkboxes = document.querySelectorAll('.checkbox-grid input[type="checkbox"]');
    const cookieWarning = document.getElementById('cookieWarning');
    const confirmArea = document.getElementById('confirmArea');
    const confirmTarget = document.getElementById('confirmTarget');
    const confirmBtn = document.getElementById('confirmBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const cookiesCheckbox = document.querySelector('.checkbox-grid input[value="cookies"]');

    /** Pending cleanup state waiting for confirmation. */
    let pendingCleanup = null;

    /**
     * Displays a status message to the user.
     * The status region uses aria-live for assistive technology.
     * @param {string} msg - The message to display.
     * @param {string} type - 'success' or 'error'.
     */
    function showStatus(msg, type) {
        statusMessage.textContent = msg;
        statusMessage.className = `status-message ${type}`; // 'success' or 'error'
        setTimeout(() => {
            statusMessage.textContent = '';
            statusMessage.className = 'status-message hidden';
        }, 3000);
    }

    /**
     * Gets the active tab's exact origin and populates the input field.
     * Uses URL.origin to preserve scheme, hostname, and explicit port.
     */
    function getCurrentTabOrigin() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].url) {
                const result = normalizeTarget(tabs[0].url);
                if (result.valid) {
                    originInput.value = result.origin;
                } else {
                    originInput.value = '';
                    showStatus(getMessage('errorUnsupportedScheme'), 'error');
                }
            }
        });
    }

    /**
     * Mapping from UI checkbox values to chrome.browsingData API type keys.
     * @type {Object<string, string>}
     */
    const typeMapping = {
        'cache': 'cacheStorage',
        'cookies': 'cookies',
        'localStorage': 'localStorage',
        'indexedDB': 'indexedDB',
        'serviceWorkers': 'serviceWorkers'
    };

    /**
     * Determines whether the current data-type selection requires confirmation.
     * Confirmation is required when Cookies is selected, because cookie cleanup
     * can affect the entire registrable domain and related subdomains.
     * @returns {boolean} True if confirmation is required.
     */
    function requiresConfirmation() {
        return cookiesCheckbox && cookiesCheckbox.checked;
    }

    /**
     * Shows or hides the cookie warning based on checkbox state.
     */
    function updateCookieWarning() {
        if (cookiesCheckbox && cookiesCheckbox.checked) {
            cookieWarning.classList.remove('hidden');
        } else {
            cookieWarning.classList.add('hidden');
        }
    }

    /**
     * Shows the confirmation area with cleanup details.
     * @param {string} targetOrigin - The exact origin being targeted.
     * @param {Object} selectedTypes - The selected data types.
     */
    function showConfirmation(targetOrigin, selectedTypes) {
        const typeNames = [];
        if (selectedTypes.cacheStorage) typeNames.push(getMessage('dataTypeCache'));
        if (selectedTypes.cookies) typeNames.push(getMessage('dataTypeCookies'));
        if (selectedTypes.localStorage) typeNames.push(getMessage('dataTypeLocalStorage'));
        if (selectedTypes.indexedDB) typeNames.push(getMessage('dataTypeIndexedDB'));
        if (selectedTypes.serviceWorkers) typeNames.push(getMessage('dataTypeServiceWorkers'));

        confirmTarget.innerHTML =
            `<strong>${getMessage('confirmTargetLabel')}</strong> <code>${targetOrigin}</code><br>` +
            `<strong>${getMessage('confirmDataLabel')}</strong> ${typeNames.join(', ')}<br>` +
            `<em>${getMessage('confirmCookieNotice')}</em>`;

        confirmArea.classList.remove('hidden');
        confirmBtn.focus();

        pendingCleanup = { targetOrigin, selectedTypes };
    }

    /**
     * Hides the confirmation area and clears pending state.
     */
    function hideConfirmation() {
        confirmArea.classList.add('hidden');
        pendingCleanup = null;
    }

    /**
     * Executes the actual data cleanup via chrome.browsingData.remove.
     * @param {string} targetOrigin - The exact origin to clean.
     * @param {Object} selectedTypes - The data types to remove.
     */
    function executeCleanup(targetOrigin, selectedTypes) {
        const removalOptions = {
            origins: [targetOrigin]
        };

        // Disable buttons while processing
        clearBtn.disabled = true;
        clearBtn.querySelector('.btn-text').textContent = getMessage('clearingStatus');
        confirmBtn.disabled = true;

        chrome.browsingData.remove(removalOptions, selectedTypes, () => {
            if (chrome.runtime.lastError) {
                showStatus(getMessage('errorPrefix', chrome.runtime.lastError.message), 'error');
            } else {
                showStatus(getMessage('cleanedSuccess', targetOrigin), 'success');
            }
            // Reset buttons
            clearBtn.disabled = false;
            clearBtn.querySelector('.btn-text').textContent = getMessage('clearSiteDataBtn');
            confirmBtn.disabled = false;
            hideConfirmation();
        });
    }

    // Initial load — auto-fill with current tab's origin
    getCurrentTabOrigin();

    // Fill Current button
    fillCurrentBtn.addEventListener('click', getCurrentTabOrigin);

    // Cookie checkbox change — show/hide warning
    if (cookiesCheckbox) {
        cookiesCheckbox.addEventListener('change', updateCookieWarning);
    }

    // Also update warning when Select All toggles
    selectAllBtn.addEventListener('click', () => {
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
        selectAllBtn.textContent = allChecked ? getMessage('selectAll') : getMessage('deselectAll');
        updateCookieWarning();
    });

    // Update cookie warning on initial load (cookies is checked by default)
    updateCookieWarning();

    // Clear Data — initiate cleanup or show confirmation
    clearBtn.addEventListener('click', () => {
        const rawInput = originInput.value.trim();

        // Validate and normalize the target using origin-utils
        const result = normalizeTarget(rawInput);
        if (!result.valid) {
            showStatus(result.error, 'error');
            return;
        }

        const targetOrigin = result.origin;

        // Update the input field to show the normalized origin
        originInput.value = targetOrigin;

        const selectedTypes = {};
        let hasSelection = false;

        checkboxes.forEach(cb => {
            if (cb.checked) {
                const apiType = typeMapping[cb.value];
                if (apiType) {
                    selectedTypes[apiType] = true;
                    hasSelection = true;
                }
            }
        });

        if (!hasSelection) {
            showStatus(getMessage('errorSelectDataType'), 'error');
            return;
        }

        // If cookies are selected, require confirmation before proceeding
        if (requiresConfirmation()) {
            showConfirmation(targetOrigin, selectedTypes);
        } else {
            // Low-impact operation — execute directly
            executeCleanup(targetOrigin, selectedTypes);
        }
    });

    // Confirm button — execute the pending cleanup
    confirmBtn.addEventListener('click', () => {
        if (pendingCleanup) {
            executeCleanup(pendingCleanup.targetOrigin, pendingCleanup.selectedTypes);
        }
    });

    // Cancel button — dismiss confirmation
    cancelBtn.addEventListener('click', () => {
        hideConfirmation();
        showStatus(getMessage('cleanupCancelled'), 'error');
    });
});
