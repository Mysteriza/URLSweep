# NeatURL

NeatURL is a minimalist, privacy-first, zero-overhead Chrome Extension that rigorously removes tracking parameters from URLs. Built with modern Manifest V3 and the `declarativeNetRequest` API, NeatURL intercepts requests before they happen, making it incredibly fast and requiring 0% CPU background overhead.

## Features

- **Zero Overhead**: Uses built-in browser network filtering.
- **Always Up to Date**: Automatically synchronizes with the upstream [ClearURLs](https://github.com/ClearURLs/Addon) tracking catalog.
- **Allowlist & Custom Rules**: Selectively disable filtering for specific websites or strip entirely custom URL trackers manually.
- **Backup & Restore**: Safely save and reload your custom configurations.

## Screenshots
<img width="396" height="638" alt="23-02-2026_19-45" src="https://github.com/user-attachments/assets/6a057f76-fb4f-4fa8-acd3-0ef6f6802617" />
<img width="493" height="836" alt="23-02-2026_19-48" src="https://github.com/user-attachments/assets/834dab13-2e75-439a-90b2-d4c2c6bf6036" />


## Installation

This extension is currently available for manual installation:

### Method 1: Download from Releases (Recommended)

1. Go to the [Releases](https://github.com/Mysteriza/NeatURLs/releases) page.
2. Download the `NeatURL.zip` file attached to the latest release.
3. Extract the ZIP file to a permanent folder on your computer.
4. Open Chrome and navigate to `chrome://extensions/`.
5. Enable **Developer mode** (toggle in the top-right corner).
6. Click on the **Load unpacked** button.
7. Select the extracted folder.

### Method 2: Clone Repository

For developers or advanced users:

1. Clone this repository: `git clone https://github.com/Mysteriza/NeatURLs.git`
2. Follow steps 3-6 from Method 1, selecting the cloned directory.

## How It Works (Examples)

NeatURL instantly strips privacy-invading tracking parameters while keeping the actual destination intact.

**Example 1: Facebook Outbound Link**

- ❌ **Dirty**: `https://www.example.com/article?fbclid=IwAR3...`
- ✅ **Neat**: `https://www.example.com/article`

**Example 2: Google Search Result**

- ❌ **Dirty**: `https://www.example.com/?gclid=EAIaIQob...`
- ✅ **Neat**: `https://www.example.com/`

**Example 3: Newsletter Campaign**

- ❌ **Dirty**: `https://www.example.com/sale?utm_source=newsletter&utm_medium=email&utm_campaign=spring_sale`
- ✅ **Neat**: `https://www.example.com/sale`

**Example 4: Facebook Marketplace**

- ❌ **Dirty**: `https://web.facebook.com/marketplace/item/12345/?referral_code=marketplace_top_picks&referral_story_type=top_picks`
- ✅ **Neat**: `https://web.facebook.com/marketplace/item/12345/`

## Usage

- **Quick Disable**: Click the NeatURL extension icon on any page to open the popup. Click "Disable Filtering" to stop stripping parameters for that specific site. The page will reload instantly without filters.
- **Manage Settings**: Click the settings gear icon in the popup, or navigate to Extension Options to manage your Backup, Allowlist, and manually specify any `Custom Tracker Parameters`.
