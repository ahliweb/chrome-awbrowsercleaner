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

document.addEventListener('DOMContentLoaded', () => {
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
                    showStatus('This page uses an unsupported scheme. Navigate to an HTTP(S) page.', 'error');
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
        if (selectedTypes.cacheStorage) typeNames.push('Cache Storage');
        if (selectedTypes.cookies) typeNames.push('Cookies');
        if (selectedTypes.localStorage) typeNames.push('Local Storage');
        if (selectedTypes.indexedDB) typeNames.push('IndexedDB');
        if (selectedTypes.serviceWorkers) typeNames.push('Service Workers');

        confirmTarget.innerHTML =
            `<strong>Target:</strong> <code>${targetOrigin}</code><br>` +
            `<strong>Data:</strong> ${typeNames.join(', ')}<br>` +
            `<em>Cookie cleanup may affect the entire registrable domain.</em>`;

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
        clearBtn.querySelector('.btn-text').textContent = 'Clearing...';
        confirmBtn.disabled = true;

        chrome.browsingData.remove(removalOptions, selectedTypes, () => {
            if (chrome.runtime.lastError) {
                showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
            } else {
                showStatus(`Cleaned data for ${targetOrigin}`, 'success');
            }
            // Reset buttons
            clearBtn.disabled = false;
            clearBtn.querySelector('.btn-text').textContent = 'Clear Data';
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
        selectAllBtn.textContent = allChecked ? 'Select All' : 'Deselect All';
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
            showStatus('Please select at least one data type.', 'error');
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
        showStatus('Cleanup cancelled.', 'error');
    });
});
