# Webpage Resource Downloader Chrome Extension

A powerful Chrome extension that scans web pages for all downloadable resources and allows bulk downloading with an intuitive interface.

## Features

✅ **Comprehensive Resource Detection:**
- `<a>` tags (href attributes)
- Images (`<img>` src attributes)
- Videos and audio (`<video>` and `<audio>` tags with sources)
- **YouTube videos** (embedded iframes and player divs)
- **Vimeo videos** (embedded content)
- **Twitch streams** (embedded players)
- **Blob URLs** (dynamically generated media)
- **Streaming manifests** (HLS .m3u8 and DASH .mpd files)
- **Generic video players** (common data attributes)
- Picture sources (`<source>` tags inside `<picture>`)
- CSS background images (inline styles)
- Lazy-loaded images (`data-src`, `data-lazy`, `data-original`)
- **All major video/audio formats** (MP4, WebM, OGG, MP3, WAV, etc.)

✅ **Smart Processing:**
- Automatic URL deduplication
- URL normalization and resolution
- Safe filename generation
- File type detection and categorization

✅ **User-Friendly Interface:**
- Modern, responsive popup design
- Filter resources by type (Images, Videos, Audio, Links)
- Bulk selection controls (Select All/None)
- Real-time download progress
- Keyboard shortcuts support

✅ **Bulk Download:**
- Chrome downloads API integration
- Automatic file conflict resolution
- Download progress tracking
- Error handling and reporting

## Installation Instructions

### Method 1: Load as Unpacked Extension (Recommended for Development)

1. **Download/Clone the Extension:**
   ```bash
   git clone <repository-url>
   # OR download and extract the ZIP file
   ```

2. **Open Chrome Extensions Page:**
   - Open Chrome browser
   - Navigate to `chrome://extensions/`
   - OR click the three-dot menu → More Tools → Extensions

3. **Enable Developer Mode:**
   - Toggle the "Developer mode" switch in the top right corner

4. **Load the Extension:**
   - Click "Load unpacked" button
   - Select the `downloader` folder containing the extension files
   - The extension should now appear in your extensions list

5. **Pin the Extension (Optional):**
   - Click the puzzle piece icon in the toolbar
   - Find "Webpage Resource Downloader" and click the pin icon
   - The extension icon will now appear in your toolbar

### Method 2: Create Extension Icons (Optional)

The extension references icon files that you can create:

1. Create the following PNG files in the `icons/` folder:
   - `icon16.png` (16x16 pixels)
   - `icon32.png` (32x32 pixels) 
   - `icon48.png` (48x48 pixels)
   - `icon128.png` (128x128 pixels)

2. Or use any existing 16x16, 32x32, 48x48, and 128x128 PNG images

## How to Use

1. **Navigate to any webpage** you want to scan for resources

2. **Click the extension icon** in the toolbar to open the popup

3. **Click "Scan Page"** to detect all downloadable resources

4. **Filter resources** by type using the filter buttons:
   - All: Show all detected resources
   - Images: Show only image files
   - Videos: Show only video files
   - Audio: Show only audio files
   - Links: Show all other linked files

5. **Select resources** to download:
   - Click individual checkboxes to select specific resources
   - Use "Select All" to select all visible resources
   - Use "None" to deselect all resources
   - Click on resource items to toggle selection

6. **Download selected resources:**
   - Click "Download Selected (X)" button
   - Files will be downloaded to your default download folder
   - Progress will be shown in the popup

## Keyboard Shortcuts

- **Ctrl/Cmd + A**: Select all visible resources
- **Ctrl/Cmd + D**: Download selected resources
- **Escape**: Deselect all resources

## File Structure

```
downloader/
├── manifest.json          # Extension configuration (Manifest V3)
├── background.js          # Service worker for downloads and communication
├── content.js             # Content script for page interaction
├── popup.html             # Popup interface HTML
├── popup.css              # Popup styling
├── popup.js               # Popup functionality
├── icons/                 # Extension icons (create your own)
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md              # This file
```

## Technical Details

### Manifest V3 Compliance
- Uses service worker instead of background pages
- Implements proper permissions model
- Uses chrome.action API for popup
- Follows modern Chrome extension best practices

### Permissions Required
- `downloads`: For downloading files
- `activeTab`: For accessing current tab content
- `scripting`: For injecting content scripts
- `storage`: For storing extension data
- `<all_urls>`: For accessing any website content

### Browser Compatibility
- Chrome 88+ (Manifest V3 support)
- Chromium-based browsers (Edge, Brave, etc.)

## Troubleshooting

### Extension Not Loading
- Ensure all files are in the correct directory
- Check that Developer mode is enabled
- Look for errors in `chrome://extensions/`

### No Resources Found
- Ensure the webpage has finished loading
- Check that the page contains downloadable resources
- Try refreshing the page and scanning again

### Download Issues
- Check Chrome's download permissions
- Ensure popup blockers aren't interfering
- Verify your default download folder is accessible

### Performance Issues
- Large pages with many resources may take time to scan
- Consider filtering by resource type to reduce load
- Close and reopen the popup if it becomes unresponsive

## Development Notes

### Code Organization
- **manifest.json**: Extension configuration and permissions
- **background.js**: Handles downloads and inter-script communication
- **content.js**: Minimal content script for page access
- **popup.js**: Main UI logic and resource management
- **popup.css**: Responsive styling with modern design

### Key Features Implementation
- **Resource Detection**: Comprehensive DOM scanning in background.js
- **URL Processing**: Smart URL resolution and deduplication
- **Download Management**: Chrome downloads API with error handling
- **UI/UX**: Modern interface with filtering and bulk operations

### Extending the Extension
- Add new resource types by modifying the scanning function
- Implement custom download locations
- Add resource preview capabilities
- Include file size detection
- Add download scheduling features

## License

This extension is provided as-is for educational and practical use. Feel free to modify and distribute according to your needs.

## Publishing the Extension

### Option 1: Chrome Web Store (Recommended for Public Distribution)

#### Prerequisites
1. **Google Developer Account** - $5 one-time registration fee
2. **Extension Icons** - Required for store submission
3. **Privacy Policy** - Required for extensions requesting permissions

#### Step-by-Step Publishing Process

1. **Prepare Extension Icons**
   ```bash
   # Create these PNG files in the icons/ folder:
   # - icon16.png (16x16 pixels)
   # - icon32.png (32x32 pixels) 
   # - icon48.png (48x48 pixels)
   # - icon128.png (128x128 pixels)
   ```

2. **Update manifest.json** to include icons:
   ```json
   "action": {
     "default_popup": "popup.html",
     "default_title": "Resource Downloader",
     "default_icon": {
       "16": "icons/icon16.png",
       "32": "icons/icon32.png",
       "48": "icons/icon48.png",
       "128": "icons/icon128.png"
     }
   },
   "icons": {
     "16": "icons/icon16.png",
     "32": "icons/icon32.png",
     "48": "icons/icon48.png",
     "128": "icons/icon128.png"
   }
   ```

3. **Create a ZIP package**:
   ```bash
   cd ~/Desktop/test/downloader
   zip -r webpage-resource-downloader.zip . -x "*.git*" "README.md"
   ```

4. **Register as Chrome Web Store Developer**:
   - Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
   - Sign in with Google account
   - Pay $5 registration fee
   - Complete developer verification

5. **Submit Extension**:
   - Click "Add new item" in developer dashboard
   - Upload your ZIP file
   - Fill out store listing information:
     - **Name**: "Webpage Resource Downloader"
     - **Summary**: "Scan and download all resources from any webpage"
     - **Description**: Use the features list from this README
     - **Category**: "Productivity"
     - **Screenshots**: Take screenshots of the extension in action
     - **Privacy Policy**: Create and link to privacy policy

6. **Complete Store Listing**:
   - Upload promotional images (440x280, 920x680, 1400x560)
   - Add detailed description
   - Set pricing (free recommended)
   - Select target countries/regions

7. **Submit for Review**:
   - Click "Submit for review"
   - Review process typically takes 1-7 days
   - Google will review for policy compliance and security

#### Privacy Policy Template
```
Privacy Policy for Webpage Resource Downloader

This extension:
- Only accesses the current active tab when you click "Scan Page"
- Does not collect, store, or transmit any personal data
- Does not track user behavior
- Only downloads files you explicitly select
- Operates entirely locally on your device

For questions: [your-email@domain.com]
Last updated: [current-date]
```

### Option 2: GitHub Releases (For Open Source Distribution)

1. **Create GitHub Repository**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/webpage-resource-downloader.git
   git push -u origin main
   ```

2. **Create Release**:
   - Go to GitHub repository
   - Click "Releases" → "Create a new release"
   - Tag version: `v1.0.0`
   - Upload the ZIP file as release asset
   - Include installation instructions

### Option 3: Direct Distribution

1. **Create Installation Package**:
   ```bash
   # Create a distribution folder
   mkdir webpage-resource-downloader-v1.0.0
   cp -r . webpage-resource-downloader-v1.0.0/
   zip -r webpage-resource-downloader-v1.0.0.zip webpage-resource-downloader-v1.0.0/
   ```

2. **Distribute via**:
   - Personal website
   - Cloud storage (Google Drive, Dropbox)
   - Email to users
   - Social media

### Option 4: Enterprise Distribution

For internal company use:
1. **Create Enterprise Package**
2. **Use Chrome Enterprise Policy** to auto-install
3. **Host on internal servers**

## Pre-Publication Checklist

- [ ] Extension works on multiple websites
- [ ] All features tested thoroughly
- [ ] Icons created and properly sized
- [ ] Privacy policy written
- [ ] Screenshots taken for store listing
- [ ] Version number updated in manifest.json
- [ ] Code cleaned and commented
- [ ] No debug console.log statements in production
- [ ] Extension description finalized
- [ ] Keywords for discoverability chosen

## Marketing Tips

1. **Optimize Store Listing**:
   - Use relevant keywords in title and description
   - Include clear, high-quality screenshots
   - Write compelling description highlighting unique features

2. **Promote Extension**:
   - Share on social media (Reddit, Twitter, LinkedIn)
   - Write blog posts about the extension
   - Submit to extension directories
   - Ask friends/colleagues to review

3. **Monitor Performance**:
   - Check Chrome Web Store analytics
   - Respond to user reviews
   - Track download/usage statistics
   - Gather user feedback for improvements

## Monetization Options

1. **Free with Donations**: Add donation links
2. **Freemium Model**: Basic free, premium features paid
3. **One-time Purchase**: Charge upfront fee
4. **Subscription**: Monthly/yearly premium features

## Support

For issues, improvements, or questions:
1. Check the browser console for error messages
2. Verify all required files are present
3. Ensure proper Chrome extension permissions
4. Test on different websites to isolate issues

---

**Note:** This extension requires Chrome 88+ for full Manifest V3 support. For Chrome Web Store publication, you must create the required icon files and privacy policy.# page_downloader_chrom_extention
