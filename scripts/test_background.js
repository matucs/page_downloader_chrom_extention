/**
 * Integration checks for background.js quota enforcement, run against stubbed
 * chrome.* APIs in a simulated MV3 service worker global.
 * Run with: node scripts/test_background.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

function buildWorker({ syncStore = {}, sessionStore = {} } = {}) {
    const messageListeners = [];
    const downloadCalls = [];

    function makeArea(store) {
        return {
            get(keys, callback) {
                let result;
                if (typeof keys === 'string') {
                    result = { [keys]: store[keys] };
                } else {
                    result = {};
                    for (const key of Object.keys(keys)) {
                        result[key] = key in store ? store[key] : keys[key];
                    }
                }
                if (callback) {
                    callback(result);
                    return undefined;
                }
                return Promise.resolve(result);
            },
            set(data, callback) {
                Object.assign(store, data);
                if (callback) {
                    callback();
                    return undefined;
                }
                return Promise.resolve();
            }
        };
    }

    const chromeStub = {
        runtime: {
            lastError: null,
            onMessage: { addListener: (fn) => messageListeners.push(fn) },
            onInstalled: { addListener: () => {} },
            getPlatformInfo: (cb) => cb({})
        },
        storage: {
            sync: makeArea(syncStore),
            local: makeArea(sessionStore),
            session: makeArea(sessionStore)
        },
        downloads: {
            onChanged: { addListener: () => {}, removeListener: () => {} },
            download: (options, cb) => {
                downloadCalls.push(options);
                cb(downloadCalls.length);
            },
            cancel: async () => {},
            pause: async () => {},
            resume: async () => {}
        },
        scripting: { executeScript: async () => [{ result: [] }] }
    };

    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        chrome: chromeStub,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        URL,
        URLSearchParams,
        Date,
        Math,
        Promise,
        JSON,
        Map,
        Set,
        Error,
        TypeError,
        Object,
        Array,
        Number,
        Boolean,
        String,
        fetch: async () => ({ ok: true, json: async () => ({ success: false, message: 'no' }) })
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.importScripts = (...files) => {
        for (const file of files) {
            vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox);
        }
    };

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), sandbox);

    return { sandbox, messageListeners, downloadCalls, syncStore, sessionStore };
}

function sendMessage(worker, message) {
    return new Promise((resolve) => {
        for (const listener of worker.messageListeners) {
            listener(message, { tab: { id: 1 } }, resolve);
        }
    });
}

const results = [];
function check(name, passed, detail = '') {
    results.push({ name, passed, detail });
}

function makeResources(count) {
    return Array.from({ length: count }, (_, i) => ({
        url: `https://example.com/file${i}.jpg`,
        filename: `file${i}.jpg`,
        type: 'image'
    }));
}

async function testBatchLimitEnforcedInBackground() {
    const worker = buildWorker();
    const response = await sendMessage(worker, {
        action: 'downloadResources',
        tabId: 1,
        resources: makeResources(10)
    });

    check(
        'background blocks an over-limit batch even with no popup open',
        response?.success === false && /3 files at once/.test(response.error || ''),
        JSON.stringify(response)
    );
    check('blocked batch starts no downloads', worker.downloadCalls.length === 0);
}

async function testDailyLimitEnforcedInBackground() {
    const worker = buildWorker({ syncStore: { dailyDownloads: 25, lastResetDate: new Date().toDateString() } });
    const response = await sendMessage(worker, {
        action: 'downloadResources',
        tabId: 1,
        resources: makeResources(2)
    });

    check(
        'background blocks downloads once the daily quota is spent',
        response?.success === false && /daily downloads/i.test(response.error || ''),
        JSON.stringify(response)
    );
}

async function testProUserBypassesLimits() {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 10);
    const worker = buildWorker({
        syncStore: {
            isPro: true,
            licenseKey: 'PAID-KEY-1234-5678',
            expiryDate: expiry.toISOString(),
            lastVerifiedAt: new Date().toISOString()
        }
    });

    const response = await sendMessage(worker, {
        action: 'downloadResources',
        tabId: 1,
        resources: makeResources(100)
    });

    check(
        'an active Pro license can start a large batch',
        response?.success === true && response.total === 100,
        JSON.stringify(response)
    );
}

async function testWithinLimitsStarts() {
    const worker = buildWorker();
    const response = await sendMessage(worker, {
        action: 'downloadResources',
        tabId: 1,
        resources: makeResources(2)
    });

    check(
        'a free user within limits can start a batch',
        response?.success === true && response.started === true,
        JSON.stringify(response)
    );
}

// YouTube downloading is prohibited by Chrome Web Store policy, so the
// extension must refuse platform watch pages rather than extract streams.
async function testPlatformPagesRejected() {
    const { sandbox } = buildWorker();
    const { isBlockedPlatformPageUrl } = sandbox;

    check('youtube watch page is rejected as a download',
        isBlockedPlatformPageUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
    check('youtu.be short link is rejected',
        isBlockedPlatformPageUrl('https://youtu.be/dQw4w9WgXcQ'));
    check('vimeo watch page is rejected',
        isBlockedPlatformPageUrl('https://vimeo.com/123456789'));
    check('a real media file is not rejected',
        !isBlockedPlatformPageUrl('https://example.com/clip.mp4'));

    check('no googlevideo stream extractor remains', sandbox.normalizeGoogleVideoUrl === undefined);
    check('no YouTube stream builder remains', sandbox.buildYouTubeStreamResource === undefined);
}

async function testDeadCodeRemoved() {
    const source = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
    check('no MAIN-world injection remains (it existed only for YouTube)',
        !source.includes("world: 'MAIN'"));
    check('no itag stream table remains', !source.includes('YOUTUBE_ITAG_QUALITY'));
    check('whole-video-into-memory fetch path removed', !source.includes('fetchStreamAsObjectUrl'));
    check('legacy broken downloadResource helper is gone', !/async function downloadResource\(/.test(source));
    check('a stall timeout guards hung downloads', source.includes('DOWNLOAD_STALL_TIMEOUT_MS'));
}

async function testManifestHygiene() {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    check('COEP header removed (it breaks cross-origin loads)', !manifest.cross_origin_embedder_policy);
    check('license.js is no longer web-accessible', !manifest.web_accessible_resources);
    check('no YouTube capture content script is registered', !manifest.content_scripts);
    check('youtube_capture.js file deleted', !fs.existsSync(path.join(root, 'youtube_capture.js')));
    check('management permission dropped (getSelf does not need it)',
        !manifest.permissions.includes('management'));
    check('service worker still registered', manifest.background?.service_worker === 'background.js');
    check('downloads permission present', manifest.permissions.includes('downloads'));
    check('content.js file deleted', !fs.existsSync(path.join(root, 'content.js')));
}

async function main() {
    await testBatchLimitEnforcedInBackground();
    await testDailyLimitEnforcedInBackground();
    await testProUserBypassesLimits();
    await testWithinLimitsStarts();
    await testPlatformPagesRejected();
    await testDeadCodeRemoved();
    await testManifestHygiene();

    let failures = 0;
    for (const { name, passed, detail } of results) {
        if (passed) {
            console.log(`PASS  ${name}`);
        } else {
            failures += 1;
            console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
        }
    }

    console.log(`\n${results.length - failures}/${results.length} checks passed`);
    process.exit(failures === 0 ? 0 : 1);
}

main();
