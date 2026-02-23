# URLSweep

URLSweep is a minimalist, privacy-first, zero-overhead Chrome Extension that rigorously removes tracking parameters from URLs. Built with modern Manifest V3 and the `declarativeNetRequest` API, URLSweep intercepts requests before they happen, making it incredibly fast and requiring 0% CPU background overhead.

## Features

- **Zero Overhead**: Uses built-in browser network filtering.
- **Always Up to Date**: Automatically synchronizes with the upstream [ClearURLs](https://github.com/ClearURLs/Addon) tracking catalog.
- **Allowlist & Custom Rules**: Selectively disable filtering for specific websites or strip entirely custom URL trackers manually.
- **Backup & Restore**: Safely save and reload your custom configurations.

## Screenshots

## Installation

This extension is currently available for manual installation:

### Method 1: Download from Releases (Recommended)

1. Go to the [Releases](https://github.com/Mysteriza/URLSweeps/releases) page.
2. Download the `URLSweep.zip` file attached to the latest release.
3. Extract the ZIP file to a permanent folder on your computer.
4. Open Chrome and navigate to `chrome://extensions/`.
5. Enable **Developer mode** (toggle in the top-right corner).
6. Click on the **Load unpacked** button.
7. Select the extracted folder.

### Method 2: Clone Repository

For developers or advanced users:

1. Clone this repository: `git clone https://github.com/Mysteriza/URLSweeps.git`
2. Follow steps 3-6 from Method 1, selecting the cloned directory.

## How It Works (Examples)

URLSweep instantly strips privacy-invading tracking parameters while keeping the actual destination intact.

**Example 1: Facebook Outbound Link**

- ❌ **Dirty**: `https://www.example.com/article?fbclid=IwAR3...`
- ✅ **Clean**: `https://www.example.com/article`

**Example 2: Google Search Result**

- ❌ **Dirty**: `https://www.example.com/?gclid=EAIaIQob...`
- ✅ **Clean**: `https://www.example.com/`

**Example 3: Newsletter Campaign**

- ❌ **Dirty**: `https://www.example.com/sale?utm_source=newsletter&utm_medium=email&utm_campaign=spring_sale`
- ✅ **Clean**: `https://www.example.com/sale`

**Example 4: Facebook Marketplace**

- ❌ **Dirty**: `https://web.facebook.com/marketplace/item/12345/?referral_code=marketplace_top_picks&referral_story_type=top_picks`
- ✅ **Clean**: `https://web.facebook.com/marketplace/item/12345/`

## Usage

- **Quick Disable**: Click the URLSweep extension icon on any page to open the popup. Click "Disable Filtering" to stop stripping parameters for that specific site. The page will reload instantly without filters.
- **Manage Settings**: Click the settings gear icon in the popup, or navigate to Extension Options to manage your Backup, Allowlist, and manually specify any `Custom Tracker Parameters`.

## Changelog

### v1.0.3

- **Project Renamed**: Fully transitioned project identity from 'NeatURL' (which was already in use by another extension) to **URLSweep**.
- **Dashboard Makeover**: Extracted the "Filter Rules/Data Source" link into a dedicated header section mimicking the classic ClearURLs format for improved readability.
- **UI & Layout Fix**: Rebuilt the underlying CSS for the `.stats-grid` to ensure the dashboard correctly spans a 3-column layout (Total Blocked, Today, Past 7 Days) on widescreen monitors.
- **Metrics Restored**: Resolved a logic crash in the Options JS that caused all dashboard values to artificially reset to `0` due to a DOM mismatch. Metrics are now fully accurate and reactive again.
