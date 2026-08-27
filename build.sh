#!/bin/bash
# Build script for packaging the Chrome extension.
#
# Firefox is intentionally not packaged here. background.js depends on
# chrome.scripting.executeScript and promise-returning chrome.storage, neither
# of which exist in the Manifest V2 background context Firefox would use, so a
# Firefox build would install but fail on every scan. See manifest_firefox.json.

set -euo pipefail

VERSION=$(node -e "console.log(require('./manifest.json').version)")

echo "Building Webpage Resource Downloader v${VERSION} for Chrome"

rm -rf build
mkdir -p build/chrome

echo "Copying extension files..."
cp -r icons build/chrome/
cp manifest.json build/chrome/
cp popup.html options.html build/chrome/
cp popup.css build/chrome/
cp background.js popup.js options.js license.js browser-compatibility.js build/chrome/
cp PRIVACY_POLICY.md build/chrome/ 2>/dev/null || true

echo "Verifying the package contains every file the manifest references..."
node - <<'NODE'
const fs = require('fs');
const path = require('path');

const dir = path.join('build', 'chrome');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const required = new Set();

const add = (file) => { if (file) required.add(file); };
add(manifest.background?.service_worker);
add(manifest.action?.default_popup);
add(manifest.options_page);
Object.values(manifest.action?.default_icon || {}).forEach(add);
Object.values(manifest.icons || {}).forEach(add);
(manifest.content_scripts || []).forEach((entry) => (entry.js || []).forEach(add));

// Scripts pulled in by HTML pages and by importScripts must ship too.
for (const page of [manifest.action?.default_popup, manifest.options_page].filter(Boolean)) {
    const html = fs.readFileSync(path.join(dir, page), 'utf8');
    for (const match of html.matchAll(/<script src="([^"]+)"/g)) add(match[1]);
    for (const match of html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)) add(match[1]);
}
const worker = fs.readFileSync(path.join(dir, manifest.background.service_worker), 'utf8');
const importMatch = worker.match(/importScripts\(([^)]*)\)/);
if (importMatch) {
    for (const match of importMatch[1].matchAll(/'([^']+)'/g)) add(match[1]);
}

const missing = [...required].filter((file) => !fs.existsSync(path.join(dir, file)));
if (missing.length) {
    console.error('Missing from package: ' + missing.join(', '));
    process.exit(1);
}
console.log(`All ${required.size} referenced files are present.`);
NODE

echo "Creating Chrome Web Store package..."
(cd build/chrome && zip -qr "../chrome-extension-v${VERSION}.zip" .)

cat > build/RELEASE_NOTES.md << EOF
# Webpage Resource Downloader v${VERSION}

## Browser support
- Chrome / Edge / Brave (Manifest V3)
- Firefox is not currently supported

## Tiers
- Free: 25 downloads/day, 3 files per batch
- Pro (\$4.99/month via Gumroad): unlimited downloads and batch size
- 7-day free trial

## Package
- \`chrome-extension-v${VERSION}.zip\` — upload to the Chrome Web Store
EOF

# The store rejects a package with a nested or duplicate manifest, which is what
# you get by zipping the project folder by hand. Fail loudly here instead.
MANIFEST_COUNT=$(unzip -l "build/chrome-extension-v${VERSION}.zip" | grep -c "manifest.json")
if [ "$MANIFEST_COUNT" -ne 1 ]; then
    echo "ERROR: package contains ${MANIFEST_COUNT} manifests, expected exactly 1." >&2
    exit 1
fi
if unzip -l "build/chrome-extension-v${VERSION}.zip" | grep -q " [^ ]*/manifest.json$"; then
    echo "ERROR: manifest.json is nested in a folder; it must sit at the zip root." >&2
    exit 1
fi

ZIP_PATH="$(cd build && pwd)/chrome-extension-v${VERSION}.zip"

echo ""
echo "Build complete ($(du -h "build/chrome-extension-v${VERSION}.zip" | cut -f1)), one manifest at the zip root."
echo ""
echo "UPLOAD THIS FILE — not the project folder, not a zip you make yourself:"
echo ""
echo "    ${ZIP_PATH}"
echo ""
echo "Next steps:"
echo "  1. Load build/chrome unpacked in chrome://extensions to smoke test"
echo "  2. Upload the file above: https://chrome.google.com/webstore/developer/dashboard"
echo "  3. Justify 'downloads' + broad host access in the store listing"
