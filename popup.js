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
 * - The UI always states the effective scope: exact origin, or
 *   registrable domain when cookies are selected.
 * - Dynamic text is rendered with textContent only (no innerHTML).
 */

/** How long error/info messages stay visible. Success stays until the next action. */
const STATUS_TIMEOUT_MS = 5000;

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
    const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
    const fallbacks = {
        extensionName: 'AW Browser Cleaner',
        extensionDescription: 'Selectively clear site data for a specific origin',
        targetOriginLabel: 'Target origin',
        targetOriginPlaceholder: 'https://example.com',
        useCurrentTabTitle: 'Use current tab',
        useCurrentTabShort: 'This tab',
        scopeExact: 'Only this origin. Other origins are not touched.',
        scopeWide: 'Cookies apply to the whole registrable domain, so related subdomains may be signed out.',
        dataToClearLabel: 'Data to clear',
        selectAll: 'Select all',
        deselectAll: 'Deselect all',
        selectedCount: `${subs[0] || 0} of ${subs[1] || 0} selected`,
        groupSession: 'Session',
        groupStorage: 'Storage',
        groupCache: 'Cache & offline',
        dataTypeCache: 'Cache Storage',
        dataTypeCookies: 'Cookies',
        dataTypeLocalStorage: 'Local Storage',
        dataTypeIndexedDB: 'IndexedDB',
        dataTypeServiceWorkers: 'Service Workers',
        cookieScopeTag: 'domain-wide',
        confirmTitle: 'Confirm cleanup',
        confirmTargetLabel: 'Target',
        confirmDataLabel: 'Will be removed',
        confirmUntouchedLabel: 'Not touched',
        confirmUntouchedOrigins: 'Site storage of every other origin',
        confirmUntouchedBrowser: 'History, downloads, form data and passwords',
        confirmCookieNotice: 'Cookies are removed for the whole registrable domain, including related subdomains.',
        confirmCleanupBtn: 'Clear including domain cookies',
        cancelBtn: 'Cancel',
        clearSiteDataBtn: 'Clear site data',
        clearingStatus: 'Clearing…',
        cleanedSuccess: `Cleaned data for ${subs[0] || ''}`,
        errorUnsupportedScheme: 'This page uses an unsupported scheme. Navigate to an HTTP(S) page.',
        errorSelectDataType: 'Please select at least one data type.',
        cleanupCancelled: 'Cleanup cancelled.',
        errorPrefix: `Error: ${subs[0] || ''}`,
        poweredBy: 'Powered by AhliWeb.com'
    };
    return fallbacks[messageName] || messageName;
}

/**
 * Localizes all DOM elements containing data-i18n attributes.
 */
function localizeDocument() {
    if (typeof document === 'undefined') return;
    if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getUILanguage === 'function') {
        document.documentElement.lang = chrome.i18n.getUILanguage();
    }
    document.querySelectorAll('[data-i18n]').forEach(elem => {
        elem.textContent = getMessage(elem.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(elem => {
        elem.setAttribute('placeholder', getMessage(elem.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(elem => {
        elem.setAttribute('title', getMessage(elem.getAttribute('data-i18n-title')));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(elem => {
        elem.setAttribute('aria-label', getMessage(elem.getAttribute('data-i18n-aria')));
    });
}

document.addEventListener('DOMContentLoaded', () => {
    localizeDocument();

    const originInput = document.getElementById('originInput');
    const fillCurrentBtn = document.getElementById('fillCurrent');
    const clearBtn = document.getElementById('clearBtn');
    const statusMessage = document.getElementById('statusMessage');
    const selectAllBtn = document.getElementById('selectAll');
    const selectedCount = document.getElementById('selectedCount');
    const checkboxes = Array.from(document.querySelectorAll('.checkbox-grid input[type="checkbox"]'));
    const cookiesCheckbox = document.querySelector('.checkbox-grid input[value="cookies"]');
    const scopeNote = document.getElementById('scopeNote');
    const scopeNoteText = document.getElementById('scopeNoteText');
    const confirmArea = document.getElementById('confirmArea');
    const confirmOrigin = document.getElementById('confirmOrigin');
    const confirmTypes = document.getElementById('confirmTypes');
    const confirmBtn = document.getElementById('confirmBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const versionTag = document.getElementById('versionTag');

    /** Pending cleanup state waiting for confirmation. */
    let pendingCleanup = null;
    /** Active status timer, cleared before a new message is shown. */
    let statusTimer = null;

    if (versionTag && typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function') {
        versionTag.textContent = `v${chrome.runtime.getManifest().version}`;
    }

    /**
     * Mapping from UI checkbox values to chrome.browsingData API type keys
     * and their i18n label keys.
     */
    const typeMapping = {
        cache: { api: 'cacheStorage', label: 'dataTypeCache' },
        cookies: { api: 'cookies', label: 'dataTypeCookies' },
        localStorage: { api: 'localStorage', label: 'dataTypeLocalStorage' },
        indexedDB: { api: 'indexedDB', label: 'dataTypeIndexedDB' },
        serviceWorkers: { api: 'serviceWorkers', label: 'dataTypeServiceWorkers' }
    };

    /**
     * Displays a status message. Success messages persist until the next
     * action; errors and info messages disappear after STATUS_TIMEOUT_MS.
     * @param {string} msg - The message to display.
     * @param {'success'|'error'|'info'} type - Message type.
     */
    function showStatus(msg, type) {
        if (statusTimer) {
            clearTimeout(statusTimer);
            statusTimer = null;
        }
        statusMessage.textContent = msg;
        statusMessage.className = `status-message ${type}`;
        if (type !== 'success') {
            statusTimer = setTimeout(clearStatus, STATUS_TIMEOUT_MS);
        }
    }

    /** Hides the status message. */
    function clearStatus() {
        if (statusTimer) {
            clearTimeout(statusTimer);
            statusTimer = null;
        }
        statusMessage.textContent = '';
        statusMessage.className = 'status-message hidden';
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
     * Keeps the Select All label, selection count, and scope note in sync
     * with the checkbox state.
     */
    function syncSelectionUi() {
        const checkedCount = checkboxes.filter(cb => cb.checked).length;
        const allChecked = checkedCount === checkboxes.length;
        selectAllBtn.textContent = allChecked ? getMessage('deselectAll') : getMessage('selectAll');
        selectedCount.textContent = getMessage('selectedCount', [String(checkedCount), String(checkboxes.length)]);

        const wide = Boolean(cookiesCheckbox && cookiesCheckbox.checked);
        scopeNote.dataset.scope = wide ? 'wide' : 'exact';
        scopeNoteText.textContent = getMessage(wide ? 'scopeWide' : 'scopeExact');

        if (pendingCleanup) hideConfirmation();
    }

    /**
     * Confirmation is required when Cookies is selected, because cookie
     * cleanup can affect the entire registrable domain.
     * @returns {boolean} True if confirmation is required.
     */
    function requiresConfirmation() {
        return Boolean(cookiesCheckbox && cookiesCheckbox.checked);
    }

    /**
     * Shows the confirmation panel. All dynamic values use textContent.
     * @param {string} targetOrigin - The exact origin being targeted.
     * @param {Object} selectedTypes - The selected data types.
     * @param {Array<string>} labels - Localized names of the selected types.
     */
    function showConfirmation(targetOrigin, selectedTypes, labels) {
        confirmOrigin.textContent = targetOrigin;
        confirmTypes.replaceChildren(...labels.map(label => {
            const li = document.createElement('li');
            li.textContent = label;
            return li;
        }));
        confirmArea.classList.remove('hidden');
        document.body.classList.add('is-confirming');
        clearBtn.disabled = true;
        confirmBtn.focus();
        pendingCleanup = { targetOrigin, selectedTypes };
    }

    /** Hides the confirmation panel and clears pending state. */
    function hideConfirmation() {
        confirmArea.classList.add('hidden');
        document.body.classList.remove('is-confirming');
        clearBtn.disabled = false;
        pendingCleanup = null;
    }

    /**
     * Executes the actual data cleanup via chrome.browsingData.remove.
     * @param {string} targetOrigin - The exact origin to clean.
     * @param {Object} selectedTypes - The data types to remove.
     */
    function executeCleanup(targetOrigin, selectedTypes) {
        const removalOptions = { origins: [targetOrigin] };
        const clearLabel = clearBtn.querySelector('.btn-text');

        clearBtn.disabled = true;
        confirmBtn.disabled = true;
        clearLabel.textContent = getMessage('clearingStatus');

        chrome.browsingData.remove(removalOptions, selectedTypes, () => {
            if (chrome.runtime.lastError) {
                showStatus(getMessage('errorPrefix', chrome.runtime.lastError.message), 'error');
            } else {
                showStatus(getMessage('cleanedSuccess', targetOrigin), 'success');
            }
            confirmBtn.disabled = false;
            hideConfirmation();
            clearLabel.textContent = getMessage('clearSiteDataBtn');
        });
    }

    // Initial state
    getCurrentTabOrigin();
    syncSelectionUi();

    fillCurrentBtn.addEventListener('click', getCurrentTabOrigin);

    checkboxes.forEach(cb => cb.addEventListener('change', syncSelectionUi));

    selectAllBtn.addEventListener('click', () => {
        const allChecked = checkboxes.every(cb => cb.checked);
        checkboxes.forEach(cb => { cb.checked = !allChecked; });
        syncSelectionUi();
    });

    originInput.addEventListener('input', () => {
        if (pendingCleanup) hideConfirmation();
    });

    clearBtn.addEventListener('click', () => {
        clearStatus();

        const result = normalizeTarget(originInput.value.trim());
        if (!result.valid) {
            showStatus(result.error, 'error');
            return;
        }

        const targetOrigin = result.origin;
        originInput.value = targetOrigin;

        const selectedTypes = {};
        const labels = [];
        checkboxes.forEach(cb => {
            const mapping = typeMapping[cb.value];
            if (cb.checked && mapping) {
                selectedTypes[mapping.api] = true;
                labels.push(getMessage(mapping.label));
            }
        });

        if (labels.length === 0) {
            showStatus(getMessage('errorSelectDataType'), 'error');
            return;
        }

        if (requiresConfirmation()) {
            showConfirmation(targetOrigin, selectedTypes, labels);
        } else {
            executeCleanup(targetOrigin, selectedTypes);
        }
    });

    confirmBtn.addEventListener('click', () => {
        if (pendingCleanup) {
            executeCleanup(pendingCleanup.targetOrigin, pendingCleanup.selectedTypes);
        }
    });

    cancelBtn.addEventListener('click', () => {
        hideConfirmation();
        showStatus(getMessage('cleanupCancelled'), 'info');
        clearBtn.focus();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && pendingCleanup) {
            event.preventDefault();
            cancelBtn.click();
        }
    });
});
