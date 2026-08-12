# BOM Tracker

A lightweight, local-first Bill of Materials (BOM) Tracker for managing components, tracking prices across suppliers, and validating technical specifications. 

## Features
- **Local-First & Offline Ready:** Everything runs in your browser. Data is persistently stored using `IndexedDB`, meaning your BOMs are fast and completely private.
- **Full JSON Backup & Restore:** Easily export your entire database for safekeeping and restore it seamlessly on another device.
- **Currency Conversion:** Pulls live currency conversion rates, allowing you to quickly compare component prices across different regions (Amazon, AliExpress, Lazada, etc.). You can also inject manual exchange rates when working offline.
- **Responsive UI & Themes:** A mobile-friendly user interface with a built-in Light/Dark mode toggle based on your system preferences.
- **Status & Progress Tracking:** Visual progress bars track the percentage of items that are `In stock` and `Ordered`.

## Development & Hosting

BOM Tracker is built with vanilla HTML, CSS, and modern JavaScript (ES6 Modules). 

### Running Locally
Because it utilizes `<script type="module">`, you cannot simply open `index.html` via a `file://` URI due to browser CORS restrictions. You must serve it over HTTP. 

Using Python 3, you can easily spin up a local server:
```bash
python3 -m http.server 8000
```
Then navigate to [http://localhost:8000](http://localhost:8000).

### Deployment
No build step is required! Because it relies strictly on native browser technologies (ES Modules and CSS Variables), you can deploy this repository directly to **GitHub Pages**, Netlify, or Vercel simply by pointing them at the root directory.

## Code Architecture
- `js/main.js`: The application entry point.
- `js/data.js`: Manages IndexedDB storage, application state, and JSON data migrations.
- `js/currency.js`: Fetches and caches exchange rates.
- `js/ui/*.js`: Specialized modules containing logic for modals, DOM rendering, and graph views. 
