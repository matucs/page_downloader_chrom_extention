#!/bin/bash
# Build script for cross-browser extension packaging

echo "🚀 Building Webpage Resource Downloader for Chrome and Firefox"

# Create build directories
mkdir -p build/chrome
mkdir -p build/firefox

# Copy common files
echo "📁 Copying common files..."
cp -r icons build/chrome/
cp -r icons build/firefox/
cp *.html build/chrome/
cp *.html build/firefox/
cp *.css build/chrome/
cp *.css build/firefox/
cp *.js build/chrome/
cp *.js build/firefox/
cp *.md build/chrome/
cp *.md build/firefox/

# Copy browser-specific manifests
echo "📄 Setting up browser-specific manifests..."
cp manifest.json build/chrome/
cp manifest_firefox.json build/firefox/manifest.json

# Create Chrome package
echo "📦 Creating Chrome extension package..."
cd build/chrome
zip -r ../chrome-extension.zip .
cd ../..

# Create Firefox package
echo "📦 Creating Firefox extension package..."
cd build/firefox
zip -r ../firefox-extension.xpi .
cd ../..

# Create release notes
echo "📋 Creating release documentation..."
cat > build/RELEASE_NOTES.md << 'EOF'
# Webpage Resource Downloader v1.0.0

## 🌐 Cross-Browser Support
- ✅ Chrome Web Store ready (Manifest V3)
- ✅ Firefox Add-ons ready (Manifest V2)
- ✅ Cross-browser API compatibility layer

## 🎯 Features
- **Free Tier**: 25 downloads/day, 3 files per batch
- **Pro Tier**: Unlimited downloads, unlimited batch size
- **7-Day Free Trial**
- **Progress Tracking**: Daily/weekly/total statistics
- **Smart Organization**: Auto-categorization by file type
- **Custom Folders**: Save to organized subfolders
- **Payment Integration**: Gumroad, Stripe, PayPal support

## 📦 Installation Files
- `chrome-extension.zip` - For Chrome Web Store
- `firefox-extension.xpi` - For Firefox Add-ons

## 🔧 Browser Differences Handled
- Service worker vs background scripts
- Storage API promise vs callback patterns
- Download API differences
- Manifest format variations
- Browser-specific restrictions

## 💰 Monetization Ready
- Freemium model implemented
- Payment processing integrated
- License key validation
- User engagement tracking
EOF

echo "✅ Build complete!"
echo ""
echo "📊 Package Details:"
echo "Chrome: $(du -h build/chrome-extension.zip | cut -f1)"
echo "Firefox: $(du -h build/firefox-extension.xpi | cut -f1)"
echo ""
echo "📁 Files created in build/ directory:"
echo "  - chrome-extension.zip (Chrome Web Store)"
echo "  - firefox-extension.xpi (Firefox Add-ons)"
echo "  - RELEASE_NOTES.md"
echo ""
echo "🎯 Next Steps:"
echo "1. Test both packages in developer mode"
echo "2. Set up payment provider (Gumroad recommended)"
echo "3. Submit to Chrome Web Store: https://chrome.google.com/webstore/developer/dashboard"
echo "4. Submit to Firefox Add-ons: https://addons.mozilla.org/developers/"