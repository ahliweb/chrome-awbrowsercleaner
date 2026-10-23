/**
 * AW Browser Cleaner - documentation snippet tests
 *
 * The code examples in docs/automation.md are copied from marked blocks of
 * tests/automation/cdp-example.test.js (`// docs:begin <name>` ... `// docs:end <name>`), which CI
 * runs. These tests fail when the document and the tested code drift apart.
 *
 * The block is compared after removing its common leading indentation (the code sits inside a
 * test body, the document shows it at the left margin). Every other byte must be identical.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dir, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT_DIR, p), 'utf8');

const TEST_FILE = 'tests/automation/cdp-example.test.js';
const DOC_FILE = 'docs/automation.md';

/** Removes the indentation shared by all non-empty lines. */
export function dedent(text) {
    const lines = text.split('\n');
    const indents = lines.filter((l) => l.trim() !== '').map((l) => /^ */.exec(l)[0].length);
    const strip = indents.length ? Math.min(...indents) : 0;
    return lines.map((l) => l.slice(strip)).join('\n');
}

/**
 * Extracts the marked blocks of a source file.
 * @returns {Map<string, string>} name to dedented block text (without the marker lines).
 */
export function extractBlocks(source) {
    const blocks = new Map();
    const lines = source.split('\n');
    let name = null;
    let buffer = [];
    for (const line of lines) {
        const begin = /^\s*\/\/ docs:begin ([a-z0-9-]+)\s*$/.exec(line);
        const end = /^\s*\/\/ docs:end ([a-z0-9-]+)\s*$/.exec(line);
        if (begin) {
            if (name) throw new Error(`docs:begin ${begin[1]} inside block ${name}`);
            name = begin[1];
            buffer = [];
        } else if (end) {
            if (end[1] !== name) throw new Error(`docs:end ${end[1]} does not match docs:begin ${name}`);
            blocks.set(name, dedent(buffer.join('\n')));
            name = null;
        } else if (name) {
            buffer.push(line);
        }
    }
    if (name) throw new Error(`docs:begin ${name} has no docs:end`);
    return blocks;
}

describe('documentation snippets', () => {
    const blocks = extractBlocks(read(TEST_FILE));
    const doc = read(DOC_FILE);

    test('the automation test defines the expected blocks', () => {
        expect([...blocks.keys()].sort()).toEqual(['cdp-clear', 'test-mode-clean', 'test-mode-ping']);
    });

    for (const name of ['cdp-clear', 'test-mode-clean', 'test-mode-ping']) {
        test(`docs/automation.md contains the tested block "${name}" byte for byte`, () => {
            const block = blocks.get(name);
            expect(block).toBeTruthy();
            expect(doc.includes(block)).toBe(true);
        });
    }

    test('extractBlocks rejects an unterminated block', () => {
        expect(() => extractBlocks('// docs:begin x\nconst a = 1;\n')).toThrow();
    });

    test('dedent removes only the common indentation', () => {
        expect(dedent('    a\n      b\n    c')).toBe('a\n  b\nc');
    });
});
