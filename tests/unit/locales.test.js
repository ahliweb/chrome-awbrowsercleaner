/**
 * AW Browser Cleaner - Localization Tests
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const LOCALES_DIR = path.join(ROOT_DIR, '_locales');

describe('Extension Localization', () => {
    const enPath = path.join(LOCALES_DIR, 'en', 'messages.json');
    const idPath = path.join(LOCALES_DIR, 'id', 'messages.json');
    const manifest = require('../../manifest.json');

    test('manifest defines default_locale as en', () => {
        expect(manifest.default_locale).toBe('en');
    });

    test('manifest uses i18n placeholders for name and description', () => {
        expect(manifest.name).toBe('__MSG_extensionName__');
        expect(manifest.description).toBe('__MSG_extensionDescription__');
    });

    test('English and Indonesian locale files exist and are valid JSON', () => {
        expect(fs.existsSync(enPath)).toBe(true);
        expect(fs.existsSync(idPath)).toBe(true);

        const enMessages = JSON.parse(fs.readFileSync(enPath, 'utf8'));
        const idMessages = JSON.parse(fs.readFileSync(idPath, 'utf8'));

        expect(typeof enMessages).toBe('object');
        expect(typeof idMessages).toBe('object');
    });

    test('English and Indonesian have matching message keys (parity)', () => {
        const enMessages = JSON.parse(fs.readFileSync(enPath, 'utf8'));
        const idMessages = JSON.parse(fs.readFileSync(idPath, 'utf8'));

        const enKeys = Object.keys(enMessages).sort();
        const idKeys = Object.keys(idMessages).sort();

        expect(enKeys).toEqual(idKeys);
    });

    test('All messages contain non-empty message strings', () => {
        const enMessages = JSON.parse(fs.readFileSync(enPath, 'utf8'));
        const idMessages = JSON.parse(fs.readFileSync(idPath, 'utf8'));

        for (const [key, val] of Object.entries(enMessages)) {
            expect(val.message).toBeDefined();
            expect(typeof val.message).toBe('string');
            expect(val.message.trim().length).toBeGreaterThan(0);
        }

        for (const [key, val] of Object.entries(idMessages)) {
            expect(val.message).toBeDefined();
            expect(typeof val.message).toBe('string');
            expect(val.message.trim().length).toBeGreaterThan(0);
        }
    });
});
