
document.addEventListener('DOMContentLoaded', () => {
    const domainInput = document.getElementById('domainInput');
    const fillCurrentBtn = document.getElementById('fillCurrent');
    const clearBtn = document.getElementById('clearBtn');
    const statusMessage = document.getElementById('statusMessage');
    const selectAllBtn = document.getElementById('selectAll');
    const checkboxes = document.querySelectorAll('.checkbox-grid input[type="checkbox"]');

    // Helper to show status
    function showStatus(msg, type) {
        statusMessage.textContent = msg;
        statusMessage.className = `status-message ${type}`; // 'success' or 'error'
        setTimeout(() => {
            statusMessage.className = 'status-message hidden';
        }, 3000);
    }

    // Get current tab domain
    function getCurrentTabDomain() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && tabs[0].url) {
                try {
                    const url = new URL(tabs[0].url);
                    // We prefer the hostname (e.g., "example.com" or "sub.example.com")
                    if (url.protocol.startsWith('http')) {
                        domainInput.value = url.hostname;
                    }
                } catch (e) {
                    console.error("Invalid URL:", e);
                }
            }
        });
    }

    // Initial load
    getCurrentTabDomain();

    // Fill Current button
    fillCurrentBtn.addEventListener('click', getCurrentTabDomain);

    // Select All Toggle
    selectAllBtn.addEventListener('click', () => {
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
        selectAllBtn.textContent = allChecked ? "Select All" : "Deselect All";
    });

    // Clear Data Logic
    clearBtn.addEventListener('click', () => {
        const domain = domainInput.value.trim();
        if (!domain) {
            showStatus("Please enter a domain.", "error");
            return;
        }

        const selectedTypes = {};
        let hasSelection = false;
        // Supported types for origin-scoped removal:
        // cookies, fileSystems, indexedDB, localStorage, serviceWorkers, webSQL, cacheStorage
        // 'cache' in UI maps to 'cacheStorage'

        const typeMapping = {
            'cache': 'cacheStorage',
            'cookies': 'cookies',
            'localStorage': 'localStorage',
            'indexedDB': 'indexedDB',
            'serviceWorkers': 'serviceWorkers',
            // these were removed from UI but keeping mapping just in case
            'fileSystems': 'fileSystems',
            'webSQL': 'webSQL'
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
            showStatus("Please select at least one data type.", "error");
            return;
        }

        // Construct removal options
        // We need to support origins. chrome.browsingData.remove takes an object for options.
        // For specific domains, we usually use the "origins" property with protocol.
        // However, users might just type "example.com". We should convert that to http/https origins.

        const origins = [];
        if (domain.includes('://')) {
            // User entered full URL or origin
            try {
                const url = new URL(domain);
                origins.push(url.origin);
            } catch (e) {
                // Fallback if URL parsing fails but it has protocol-like syntax
                origins.push(domain);
            }
        } else {
            // Assume both http and https for the domain
            origins.push(`http://${domain}`);
            origins.push(`https://${domain}`);
        }

        const removalOptions = {
            origins: origins
        };

        // Disable button while processing
        clearBtn.disabled = true;
        clearBtn.querySelector('.btn-text').textContent = "Clearing...";

        chrome.browsingData.remove(removalOptions, selectedTypes, () => {
            if (chrome.runtime.lastError) {
                showStatus(`Error: ${chrome.runtime.lastError.message}`, "error");
            } else {
                showStatus(`Cleaned data for ${domain}`, "success");
            }
            // Reset button
            clearBtn.disabled = false;
            clearBtn.querySelector('.btn-text').textContent = "Clear Data";
        });
    });
});
