/**
 * Behavioural checks for LicenseManager against a fake chrome.storage + fake Gumroad API.
 * Run with: node scripts/test_license.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const licenseSource = fs.readFileSync(path.join(__dirname, '..', 'license.js'), 'utf8');

let store = {};
let fetchHandler = null;
let fetchCalls = 0;

function makeChrome() {
    return {
        storage: {
            sync: {
                get(defaults, callback) {
                    const result = {};
                    for (const key of Object.keys(defaults)) {
                        result[key] = key in store ? store[key] : defaults[key];
                    }
                    callback(result);
                },
                set(data, callback) {
                    Object.assign(store, data);
                    callback();
                }
            }
        }
    };
}

function loadManager() {
    const sandbox = {
        console,
        chrome: makeChrome(),
        Date,
        URLSearchParams,
        TypeError,
        Error,
        Math,
        Boolean,
        Number,
        Promise,
        JSON,
        async fetch(url, options) {
            fetchCalls += 1;
            return fetchHandler(url, options);
        },
        window: {}
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(licenseSource, sandbox);
    return sandbox.LicenseManager || sandbox.window.LicenseManager;
}

const LicenseManager = loadManager();

function jsonResponse(body, ok = true, status = 200) {
    return {
        ok,
        status,
        json: async () => body
    };
}

const results = [];
function check(name, passed, detail = '') {
    results.push({ name, passed, detail });
}

function reset() {
    store = {};
    fetchCalls = 0;
    fetchHandler = async () => jsonResponse({ success: false, message: 'not configured' }, false, 404);
}

function daysFromNow(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString();
}

async function testFakeKeyRejected() {
    reset();
    fetchHandler = async () =>
        jsonResponse(
            { success: false, message: 'That license does not exist for the provided product.' },
            false,
            404
        );

    const manager = new LicenseManager();
    let message = null;
    try {
        await manager.activateLicense('3BXBG-PF2GJ-PYKGG-WTT5D');
    } catch (error) {
        message = error.message;
    }

    check(
        'fake key is rejected with a clear message',
        message === 'This license key is invalid or was not purchased for this product.',
        `got: ${message}`
    );
    check('fake key does not grant pro', store.isPro !== true, `isPro=${store.isPro}`);
}

async function testValidKeyActivates() {
    reset();
    fetchHandler = async () =>
        jsonResponse({ success: true, uses: 1, purchase: { refunded: false, chargebacked: false } });

    const manager = new LicenseManager();
    const result = await manager.activateLicense('  A1B2C3D4-E5F60718-9ABCDEF0-1234ABCD  ');

    check('valid key activates', result.success === true);
    check('valid key is trimmed before storing', store.licenseKey === 'A1B2C3D4-E5F60718-9ABCDEF0-1234ABCD', store.licenseKey);
    check('valid key sets lastVerifiedAt', Boolean(store.lastVerifiedAt));
    check('valid key reports pro', (await manager.isProUser()) === true);
}

async function testRefundedKeyRejected() {
    reset();
    fetchHandler = async () => jsonResponse({ success: true, purchase: { refunded: true } });

    const manager = new LicenseManager();
    let message = null;
    try {
        await manager.activateLicense('REFUNDED-KEY-0000-1111');
    } catch (error) {
        message = error.message;
    }

    check('refunded purchase is rejected', /no longer active/.test(message || ''), `got: ${message}`);
}

async function testNetworkErrorMessage() {
    reset();
    fetchHandler = async () => {
        throw new TypeError('Failed to fetch');
    };

    const manager = new LicenseManager();
    let message = null;
    try {
        await manager.activateLicense('SOME-REAL-LOOKING-KEY-1234');
    } catch (error) {
        message = error.message;
    }

    check(
        'network failure shows a friendly message, not "Failed to fetch"',
        message === 'Could not reach Gumroad. Check your internet connection and try again.',
        `got: ${message}`
    );
}

async function testTrialExpiryDeactivates() {
    reset();
    store = {
        isPro: true,
        licenseKey: 'TRIAL',
        trialUsed: true,
        trialCompletedAt: null,
        expiryDate: daysFromNow(-1),
        dailyDownloads: 0
    };

    const manager = new LicenseManager();
    const license = await manager.getLicenseStatus();

    check('expired trial clears isPro in storage', store.isPro === false, `isPro=${store.isPro}`);
    check('expired trial clears the TRIAL key', store.licenseKey === '', `key=${store.licenseKey}`);
    check('expired trial stamps trialCompletedAt', Boolean(store.trialCompletedAt));
    check('expired trial is not effectively pro', manager.isEffectivelyPro(license) === false);
    check('expired trial reports isTrialExpired', (await manager.isTrialExpired()) === true);
    check('expired trial cannot start again', await (async () => {
        try {
            await manager.startTrial();
            return false;
        } catch (error) {
            return /already been used/.test(error.message);
        }
    })());

    const remaining = await manager.getRemainingDownloads();
    check('expired trial falls back to free quota', remaining.unlimited !== true && remaining.total === 25);

    const batch = await manager.canDownload(10);
    check('expired trial is blocked by batch limit', batch.allowed === false, JSON.stringify(batch));
}

async function testActiveTrial() {
    reset();
    store = {
        isPro: true,
        licenseKey: 'TRIAL',
        trialUsed: true,
        expiryDate: daysFromNow(3),
        dailyDownloads: 0
    };

    const manager = new LicenseManager();
    check('active trial is trial', (await manager.isTrialActive()) === true);
    check('active trial is not "pro user"', (await manager.isProUser()) === false);
    check('active trial has an active license', (await manager.hasActiveLicense()) === true);
    check('active trial reports days remaining', (await manager.getTrialDaysRemaining()) === 3);
    check('active trial allows big batches', (await manager.canDownload(500)).allowed === true);
    check('active trial makes no network calls', fetchCalls === 0, `calls=${fetchCalls}`);
}

async function testExpiredPaidLicenseLosesBenefits() {
    reset();
    store = {
        isPro: true,
        licenseKey: 'PAID-KEY-1234-5678-ABCD',
        expiryDate: daysFromNow(-2),
        lastVerifiedAt: daysFromNow(-40),
        dailyDownloads: 30
    };
    // Gumroad is unreachable, so the stored license must not be trusted OR wiped.
    fetchHandler = async () => {
        throw new TypeError('Failed to fetch');
    };

    const manager = new LicenseManager();
    const license = await manager.getLicenseStatus();

    check('expired paid license is not effectively pro', manager.isEffectivelyPro(license) === false);
    const remaining = await manager.getRemainingDownloads();
    check('expired paid license does not report unlimited', remaining.unlimited !== true, JSON.stringify(remaining));

    const canDownload = await manager.canDownload(1);
    check('expired paid license is subject to the daily cap', canDownload.allowed === false, JSON.stringify(canDownload));
    check('unreachable Gumroad keeps the stored key for later renewal', store.licenseKey === 'PAID-KEY-1234-5678-ABCD', store.licenseKey);
}

async function testTransientApiErrorDoesNotRevoke() {
    reset();
    store = {
        isPro: true,
        licenseKey: 'PAID-KEY-1234-5678-ABCD',
        expiryDate: daysFromNow(10),
        lastVerifiedAt: daysFromNow(-5)
    };
    fetchHandler = async () =>
        jsonResponse(
            { success: false, message: "The 'product_id' parameter is required to verify the license for this product." },
            false,
            500
        );

    const manager = new LicenseManager();
    await manager.hasActiveLicense();

    check(
        'a Gumroad config/server error does not revoke a paying customer',
        store.isPro === true && store.licenseKey === 'PAID-KEY-1234-5678-ABCD',
        `isPro=${store.isPro} key=${store.licenseKey}`
    );
}

async function testCancelledSubscriptionRevoked() {
    reset();
    store = {
        isPro: true,
        licenseKey: 'PAID-KEY-1234-5678-ABCD',
        expiryDate: daysFromNow(10),
        lastVerifiedAt: daysFromNow(-5)
    };
    fetchHandler = async () =>
        jsonResponse({
            success: true,
            purchase: { refunded: false, subscription_ended_at: daysFromNow(-1) }
        });

    const manager = new LicenseManager();
    await manager.hasActiveLicense();

    check('ended subscription is revoked', store.isPro === false, `isPro=${store.isPro}`);
}

async function testRenewalExtendsExpiry() {
    reset();
    store = {
        isPro: true,
        licenseKey: 'PAID-KEY-1234-5678-ABCD',
        expiryDate: daysFromNow(-1),
        lastVerifiedAt: daysFromNow(-32)
    };
    fetchHandler = async () => jsonResponse({ success: true, purchase: { refunded: false } });

    const manager = new LicenseManager();
    const stillPro = await manager.isProUser();

    check('still-subscribed customer renews automatically', stillPro === true, `isPro=${stillPro}`);
    check('renewal pushes expiry into the future', new Date(store.expiryDate) > new Date(), store.expiryDate);
}

async function testSingleNetworkCallPerSession() {
    reset();
    store = {
        isPro: true,
        licenseKey: 'PAID-KEY-1234-5678-ABCD',
        expiryDate: daysFromNow(10),
        lastVerifiedAt: daysFromNow(-20)
    };
    fetchHandler = async () => jsonResponse({ success: true, purchase: { refunded: false } });

    const manager = new LicenseManager();
    await Promise.all([manager.hasActiveLicense(), manager.isProUser(), manager.getUsage()]);
    await manager.getUsage();

    check('re-verification hits the network at most once per session', fetchCalls === 1, `calls=${fetchCalls}`);
}

async function testRecentlyVerifiedSkipsNetwork() {
    reset();
    store = {
        isPro: true,
        licenseKey: 'PAID-KEY-1234-5678-ABCD',
        expiryDate: daysFromNow(20),
        lastVerifiedAt: new Date().toISOString()
    };
    fetchHandler = async () => jsonResponse({ success: true, purchase: { refunded: false } });

    const manager = new LicenseManager();
    await manager.isProUser();

    check('a freshly verified license skips the network', fetchCalls === 0, `calls=${fetchCalls}`);
}

async function testDevLicenseRequiresUnpackedInstall() {
    reset();

    const manager = new LicenseManager();
    manager._devInstallOverride = false;

    let message = '';
    try {
        await manager.activateLicense('DEVTE-STONLY-00000-00001');
    } catch (error) {
        message = error.message;
    }

    check(
        'dev key is rejected outside unpacked installs',
        /unpacked extension/.test(message),
        message
    );
}

async function testDevLicenseActivatesLocally() {
    reset();

    const manager = new LicenseManager();
    manager._devInstallOverride = true;

    const result = await manager.activateLicense('DEVTE-STONLY-00000-00001');

    check('dev key activates locally', result.success === true, JSON.stringify(result));
    check('dev key is stored', store.licenseKey === 'DEVTE-STONLY-00000-00001', store.licenseKey);
    check('dev key unlocks pro', store.isPro === true, `isPro=${store.isPro}`);

    fetchCalls = 0;
    await manager.isProUser();
    check('dev key skips Gumroad re-verification', fetchCalls === 0, `calls=${fetchCalls}`);
}

async function main() {
    await testFakeKeyRejected();
    await testValidKeyActivates();
    await testRefundedKeyRejected();
    await testNetworkErrorMessage();
    await testTrialExpiryDeactivates();
    await testActiveTrial();
    await testExpiredPaidLicenseLosesBenefits();
    await testTransientApiErrorDoesNotRevoke();
    await testCancelledSubscriptionRevoked();
    await testRenewalExtendsExpiry();
    await testSingleNetworkCallPerSession();
    await testRecentlyVerifiedSkipsNetwork();
    await testDevLicenseRequiresUnpackedInstall();
    await testDevLicenseActivatesLocally();

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
