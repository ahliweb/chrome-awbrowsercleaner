/**
 * AW Browser Cleaner - Popup Logic
 * Handles user interactions and calls the chrome.browsingData API.
 *
 * Design principles:
 * - Uses exact origin (scheme + hostname + port) for precise targeting.
 * - Only HTTP(S) origins are supported.
 * - A single exact origin is passed to chrome.browsingData.remove.
 * - Unsupported schemes (chrome:, file:, about:, etc.) are rejected.
 */

/**
 * Supported URL schemes for cleanup operations.
 * @type {Set<string>}
 */
const SUPPORTED_SCHEMES = new Set(['http:', 'https:']);

document.addEventListener('DOMContentLoaded', () => {
    const originInput = document.getElementById('originInput');
    const fillCurrentBtn = document.getElementById('fillCurrent');
    const clearBtn = document.getElementById('clearBtn');
    const statusMessage = document.getElementById('statusMessage');
    const selectAllBtn = document.getElementById('selectAll');
    const checkboxes = document.querySelectorAll('.checkbox-grid input[type="checkbox"]');

    /**
     * Displays a status message to the user.
     * @param {string} msg - The message to display.
     * @param {string} type - 'success' or 'error'.
     */
    function showStatus(msg, type) {
        statusMessage.textContent = msg;
        statusMessage.className = `status-message ${type}`; // 'success' or 'error'
        setTimeout(() => {
            statusMessage.className = 'status-message hidden';
        }, 3000);
    }

    /**
     * Checks whether a URL scheme is supported for cleanup operations.
     * @param {string} scheme - The URL scheme (e.g., 'https:').
     * @returns {boolean} True if the scheme is supported.
     */
    function isSupportedScheme(scheme) {
        return SUPPORTED_SCHEMES.has(scheme);
    }

    /**
     * Gets the active tab's exact origin and populates the input field.
     * Uses URL.origin to preserve scheme, hostname, and explicit port.
     */
    function getCurrentTabOrigin() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].url) {
                try {
                    const url = new URL(tabs[0].url);
                    if (isSupportedScheme(url.protocol)) {
                        // URL.origin preserves scheme + hostname + port
                        originInput.value = url.origin;
                    } else {
                        originInput.value = '';
                        showStatus('This page uses an unsupported scheme. Navigate to an HTTP(S) page.', 'error');
                    }
                } catch (e) {
                    console.error('Invalid URL:', e);
                    originInput.value = '';
                }
            }
        });
    }

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
        if (!rawInput) {
            showStatus('Please enter a target origin.', 'error');
            return;
        }

        // Validate and normalize the target to an exact origin
        let targetOrigin;
        try {
            let urlString = rawInput;
            // If the user typed a bare hostname without a scheme, default to https
            if (!rawInput.includes('://')) {
                urlString = `https://${rawInput}`;
            }

            const url = new URL(urlString);

            if (!isSupportedScheme(url.protocol)) {
                showStatus(`Unsupported scheme "${url.protocol}". Only HTTP and HTTPS are supported.`, 'error');
                return;
            }

            // Use URL.origin for the exact origin (strips path, query, hash)
            targetOrigin = url.origin;

            // Guard against opaque origins (e.g., blob:, data:)
            if (targetOrigin === 'null') {
                showStatus('Could not determine a valid origin from the input.', 'error');
                return;
            }
        } catch (e) {
            showStatus('Invalid URL or origin. Example: https://example.com', 'error');
            return;
        }

        // Update the input field to show the normalized origin
        originInput.value = targetOrigin;

        const selectedTypes = {};
        let hasSelection = false;

        // Mapping from UI checkbox values to chrome.browsingData API type keys
        const typeMapping = {
            'cache': 'cacheStorage',
            'cookies': 'cookies',
            'localStorage': 'localStorage',
            'indexedDB': 'indexedDB',
            'serviceWorkers': 'serviceWorkers'
        };

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
