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
 */

document.addEventListener('DOMContentLoaded', () => {
    const originInput = document.getElementById('originInput');
    const fillCurrentBtn = document.getElementById('fillCurrent');
    const clearBtn = document.getElementById('clearBtn');
    const statusMessage = document.getElementById('statusMessage');
    const selectAllBtn = document.getElementById('selectAll');
    const checkboxes = document.querySelectorAll('.checkbox-grid input[type="checkbox"]');

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

    // Initial load — auto-fill with current tab's origin
    getCurrentTabOrigin();

    // Fill Current button
    fillCurrentBtn.addEventListener('click', getCurrentTabOrigin);

    // Select All Toggle
    selectAllBtn.addEventListener('click', () => {
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
        selectAllBtn.textContent = allChecked ? 'Select All' : 'Deselect All';
    });

    // Clear Data Logic
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

        // Construct removal options with a single exact origin
        const removalOptions = {
            origins: [targetOrigin]
        };

        // Disable button while processing
        clearBtn.disabled = true;
        clearBtn.querySelector('.btn-text').textContent = 'Clearing...';

        // Execute removal
        chrome.browsingData.remove(removalOptions, selectedTypes, () => {
            if (chrome.runtime.lastError) {
                showStatus(`Error: ${chrome.runtime.lastError.message}`, 'error');
            } else {
                showStatus(`Cleaned data for ${targetOrigin}`, 'success');
            }
            // Reset button
            clearBtn.disabled = false;
            clearBtn.querySelector('.btn-text').textContent = 'Clear Data';
        });
    });
});
