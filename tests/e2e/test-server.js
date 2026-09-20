/**
 * AW Browser Cleaner - E2E Test Server
 *
 * Minimal HTTP server that serves test pages for verifying
 * extension cleanup operations against controlled storage values.
 *
 * Usage: bun tests/e2e/test-server.js [port]
 * Default port: 8932
 */

const http = require('http');

/**
 * Test page HTML that sets various storage types for verification.
 */
const TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>AW Browser Cleaner Test Page</title></head>
<body>
<h1>Storage Test Page</h1>
<div id="status">Ready</div>
<script>
// Set test data in various storage types
localStorage.setItem('aw_test_key', 'test_value');
sessionStorage.setItem('aw_test_session', 'session_value');

// IndexedDB
const dbReq = indexedDB.open('aw_test_db', 1);
dbReq.onupgradeneeded = (e) => {
    const db = e.target.result;
    db.createObjectStore('test_store', { keyPath: 'id' });
};
dbReq.onsuccess = (e) => {
    const db = e.target.result;
    const tx = db.transaction('test_store', 'readwrite');
    tx.objectStore('test_store').put({ id: 1, value: 'test_data' });
};

// Cache Storage
caches.open('aw_test_cache').then(cache => {
    cache.put('/test', new Response('cached_data'));
});

// Cookie
document.cookie = 'aw_test_cookie=test_value; path=/';

// Report storage state
function getStorageState() {
    return {
        localStorage: localStorage.getItem('aw_test_key'),
        cookie: document.cookie.includes('aw_test_cookie'),
        cacheStorage: null, // checked async
        indexedDB: null // checked async
    };
}

window.getStorageState = getStorageState;
document.getElementById('status').textContent = 'Storage initialized';
</script>
</body>
</html>`;

function createTestServer(port = 8932) {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(TEST_PAGE_HTML);
    });

    return new Promise((resolve, reject) => {
        server.listen(port, () => {
            console.log(`Test server running on http://localhost:${port}`);
            resolve(server);
        });
        server.on('error', reject);
    });
}

if (require.main === module) {
    const portArg = parseInt(process.argv[2], 10);
    const port = Number.isInteger(portArg) ? portArg : 8932;
    createTestServer(port);
}

module.exports = { createTestServer, TEST_PAGE_HTML };
