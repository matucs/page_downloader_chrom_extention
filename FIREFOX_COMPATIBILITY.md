# Firefox Compatibility Guide

## 🦊 Firefox-Specific Features

### 1. **Manifest V2 vs V3**
- Chrome uses Manifest V3 (service worker)
- Firefox uses Manifest V2 (background scripts)
- Our compatibility layer handles both

### 2. **API Differences**
- **Storage**: Firefox uses promises, Chrome uses callbacks
- **Downloads**: Firefox has stricter filename restrictions
- **Runtime**: Different message handling patterns

### 3. **Browser Detection**
```javascript
// Automatic detection in browser-compatibility.js
const browserCompat = new BrowserCompat();
console.log(browserCompat.getBrowserName()); // "Firefox" or "Chrome"
```

### 4. **Testing in Firefox**

#### Load Extension:
1. Open Firefox
2. Type `about:debugging` in address bar
3. Click "This Firefox"
4. Click "Load Temporary Add-on"
5. Select `manifest.json` from the extension folder

#### Firefox Developer Edition (Recommended):
- Better debugging tools
- More lenient security policies
- Extension development features

### 5. **Key Compatibility Features**

#### Storage API:
```javascript
// Works in both browsers
await browserCompat.getStorage(defaults);
await browserCompat.setStorage(data);
```

#### Downloads API:
```javascript
// Handles browser differences
await browserCompat.downloadFile(options);
```

#### Messaging:
```javascript
// Cross-browser messaging
browserCompat.sendMessage(message);
browserCompat.onMessage(callback);
```

### 6. **Firefox-Specific Considerations**

#### File Naming:
- Stricter restrictions on special characters
- Shorter path length limits
- Auto-sanitization included

#### Permissions:
- Same permissions model as Chrome
- `<all_urls>` permission required for downloads

#### Security:
- Content Security Policy (CSP) restrictions
- No `eval()` or inline scripts
- All handled by our implementation

### 7. **Build Process**

#### For Firefox:
```bash
./build.sh
# Creates firefox-extension.xpi
```

#### Manual Firefox Package:
```bash
cd build/firefox
zip -r ../firefox-extension.xpi .
```

### 8. **Firefox Add-ons Submission**

1. **Create Account**: https://addons.mozilla.org/developers/
2. **Submit Extension**: Upload `.xpi` file
3. **Review Process**: Usually 1-3 days
4. **Distribution**: Auto-updates through Firefox

### 9. **Testing Checklist**

- [ ] Extension loads without errors
- [ ] Resource scanning works
- [ ] Downloads save correctly
- [ ] License system functions
- [ ] Settings page accessible
- [ ] Payment flow works
- [ ] Cross-origin requests work
- [ ] File naming sanitization works

### 10. **Firefox Users Benefits**

- **Privacy-focused**: Firefox users value privacy
- **Technical users**: Often willing to pay for quality tools
- **Less saturated**: Fewer extensions competing
- **Better revenue**: Higher conversion rates typically

### 11. **Revenue Potential**

Firefox represents ~15-20% of extension users but often:
- Higher conversion rates (2-4% vs 1-2% Chrome)
- Less competition
- More engaged user base
- Better retention rates

### 12. **Troubleshooting**

#### Common Issues:
1. **Manifest errors**: Check Firefox console
2. **API differences**: Use browser compatibility layer
3. **CSP violations**: No eval, inline scripts
4. **File downloads**: Check filename sanitization

#### Debug Tools:
- Firefox Developer Tools
- `about:debugging`
- Browser Console (`Ctrl+Shift+J`)
- Extension Console in debugging page

Your extension is now fully Firefox compatible! 🎉