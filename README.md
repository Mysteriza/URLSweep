# NeatURL

NeatURL is a minimalist, privacy-first, zero-overhead Chrome Extension that rigorously removes tracking parameters from URLs. Built with modern Manifest V3 and the `declarativeNetRequest` API, NeatURL intercepts requests before they happen, making it incredibly fast and requiring 0% CPU background overhead.

## Features

- **Zero Overhead**: Uses built-in browser network filtering.
- **Always Up to Date**: Automatically synchronizes with the upstream ClearURLs tracking catalog.
- **Allowlist & Custom Rules**: Selectively disable filtering for specific websites or strip entirely custom URL trackers manually.
- **Backup & Restore**: Safely save and reload your custom configurations.

## Installation

This extension is not yet published in the Chrome Web Store. You need to install it manually as an "unpacked" extension:

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click on the **Load unpacked** button.
4. Select the directory (`CleanURLs` or your renamed folder) where these extension files reside.
5. The extension is now active!

## Usage

- **Quick Disable**: Click the NeatURL extension icon on any page to open the popup. Click "Disable Filtering" to stop stripping parameters for that specific site. The page will reload instantly without filters.
- **Manage Settings**: Click the settings gear icon in the popup, or navigate to Extension Options to manage your Backup, Allowlist, and manually specify any `Custom Tracker Parameters`.
