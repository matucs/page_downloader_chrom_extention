# Privacy Policy for Webpage Resource Downloader

**Last updated: August 27, 2026**

## Data Collection and Usage

The Webpage Resource Downloader Chrome Extension operates with the following privacy principles:

### Information We DO NOT Collect
- Personal information (name, email, address, etc.)
- Browsing history or website visits
- Downloaded file contents or metadata
- User behavior analytics
- Cookies or tracking data
- Login credentials or passwords

### Information We Access
- **Current Tab Content**: Only when you click "Scan Page" to detect downloadable resources
- **Download API**: To save selected files to your default download folder
- **Active Tab URL**: Only for scanning the currently visible webpage

### How We Use Information
- Scanning webpage content to identify downloadable resources (images, videos, links)
- Facilitating downloads of user-selected resources
- All processing happens locally on your device

### Data Storage
- No data is stored on external servers
- Extension settings may be stored locally in your browser
- No data is transmitted to third parties

### Permissions Explained
- **downloads**: Required to save files to your computer
- **activeTab**: Access current webpage content only when scanning
- **scripting**: Inject scanning scripts into webpages
- **storage**: Store extension preferences locally
- **host permissions**: Access any website for resource scanning

### Third-Party Services
This extension uses no analytics, tracking, or advertising services.

The single third party it contacts is **Gumroad**, and only if you buy a Pro
license. When you activate a license key, and periodically afterwards to confirm
the subscription is still active, the extension sends that license key to
Gumroad's license-verification API (`https://api.gumroad.com/v2/licenses/verify`).
Nothing else is sent: no email address, no browsing data, no list of what you
downloaded. Free and trial users never trigger this request. Purchases made on
Gumroad's own checkout page are covered by
[Gumroad's privacy policy](https://gumroad.com/privacy).

### Data Security
Scanning, filtering, and file naming all happen locally on your device. The only
network requests the extension makes are the downloads themselves, which go
directly to the original resource URLs, and the Gumroad license check described
above.

### Changes to This Policy
We may update this privacy policy from time to time. Any changes will be reflected in the extension listing.

### Contact
For questions about this privacy policy, please contact:
- GitHub: https://github.com/matucs/page_downloader_chrom_extention
- Create an issue on the GitHub repository for support

---

**By using this extension, you acknowledge that you have read and understood this privacy policy.**