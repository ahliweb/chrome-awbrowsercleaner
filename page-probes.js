/**
 * AW Browser Cleaner - Page Probes
 *
 * Functions passed to chrome.scripting.executeScript({ func, args }).
 *
 * IMPORTANT: Chrome serializes these functions and re-creates them in the page,
 * so each probe MUST be fully self-contained: no imports, no closures, no
 * module-scope references. Everything a probe needs is declared inside it.
 * Probes only return counts and metadata, never stored values.
 */

/**
 * Counts what an origin stores, from inside a frame of that origin.
 * Returns null when the frame's origin is not `targetOrigin`.
 *
 * Every field is a number, or null when it cannot be measured
 * (`persisted` is a boolean or null).
 *
 * @param {string} targetOrigin
 * @returns {Promise<null|{
 *   origin: string, localStorage: number|null, sessionStorage: number|null,
 *   indexedDB: number|null, cacheStorage: number|null, serviceWorkers: number|null,
 *   fileSystems: number|null, usage: number|null, quota: number|null,
 *   persisted: boolean|null
 * }>}
 */
export async function snapshotProbe(targetOrigin) {
    const num = async read => {
        try {
            const v = await read();
            return typeof v === 'number' && Number.isFinite(v) ? v : null;
        } catch (e) {
            return null;
        }
    };

    let currentOrigin;
    try {
        currentOrigin = location.origin;
    } catch (e) {
        return null;
    }
    if (currentOrigin !== targetOrigin) return null;

    const estimate = async () => {
        try {
            return await navigator.storage.estimate();
        } catch (e) {
            return null;
        }
    };
    const est = await estimate();

    let persisted = null;
    try {
        const p = await navigator.storage.persisted();
        persisted = typeof p === 'boolean' ? p : null;
    } catch (e) {
        persisted = null;
    }

    return {
        origin: currentOrigin,
        localStorage: await num(() => localStorage.length),
        sessionStorage: await num(() => sessionStorage.length),
        indexedDB: await num(async () => {
            const dbs = await indexedDB.databases?.();
            return dbs ? dbs.length : null;
        }),
        cacheStorage: await num(async () => (await caches.keys()).length),
        serviceWorkers: await num(async () => {
            const regs = await navigator.serviceWorker?.getRegistrations();
            return regs ? regs.length : null;
        }),
        fileSystems: await num(async () => {
            const dir = await navigator.storage.getDirectory();
            let entries = 0;
            for await (const name of dir.keys()) {
                if (typeof name === 'string') entries += 1;
            }
            return entries;
        }),
        usage: est ? await num(() => est.usage) : null,
        quota: est ? await num(() => est.quota) : null,
        persisted
    };
}

/**
 * Clears sessionStorage of the frame when its origin is `targetOrigin`.
 * Returns the number of keys removed (never their contents), or null when the
 * frame's origin differs or sessionStorage is not accessible.
 *
 * @param {string} targetOrigin
 * @returns {{origin: string, cleared: number}|null}
 */
export function clearSessionStorageProbe(targetOrigin) {
    try {
        if (location.origin !== targetOrigin) return null;
        const cleared = sessionStorage.length;
        sessionStorage.clear();
        return { origin: location.origin, cleared };
    } catch (e) {
        return null;
    }
}

/**
 * Picks the first non-null result from chrome.scripting.executeScript output
 * (main frame first, then sub-frames).
 *
 * @param {Array<{result?: unknown}|null>|null|undefined} injectionResults
 * @returns {unknown|null}
 */
export function mergeFrameResults(injectionResults) {
    if (!Array.isArray(injectionResults)) return null;
    for (const item of injectionResults) {
        if (item && item.result !== undefined && item.result !== null) return item.result;
    }
    return null;
}
