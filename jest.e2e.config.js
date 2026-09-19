/** @type {import('jest').Config} */
module.exports = {
    testMatch: ['**/tests/e2e/**/*.test.js'],
    testEnvironment: 'node',
    testTimeout: 30000,
    verbose: true
};
