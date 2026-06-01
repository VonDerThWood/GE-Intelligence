# GEnius — Build Guide

## Prerequisites

### 1. Install Node.js
Download from https://nodejs.org — get the **LTS** version (20.x or later).
During install, leave all defaults checked (including "Add to PATH").

Verify it worked:
```
node --version   # should show v20.x.x or higher
npm --version    # should show 10.x.x or higher
```

### 2. Python (you already have 3.14)
Make sure `py` or `python` works in your terminal:
```
py --version
```

Install Python dependencies (from repo root):
```
pip install requests beautifulsoup4
```

---

## Running in Development (test before building)

```bash
# 1. Clone the repo (if not already done)
git clone https://github.com/VonDerThWood/GE-Intelligence.git
cd GE-Intelligence

# 2. Install Node dependencies
npm install

# 3. Launch the app
npm start
```

The window opens immediately. It will attempt a background Python fetch after 3 seconds.
If Python isn't found, you'll see a "Fetch failed" toast — prices won't load but the UI still works.

**Dev tools:** Press `Ctrl+Shift+I` to open DevTools if you need to debug.

---

## Building the .exe Installer

```bash
npm run build
```

This produces:
```
dist/
  GEnius Setup 1.0.0.exe   ← installer for friends
  win-unpacked/             ← unpacked version (no install needed, larger)
```

The installer is a single file you can share. It includes:
- The Electron app
- All React UI (no internet needed for the UI)
- The Python scripts bundled as resources

> **Note:** Python must be installed separately on the target machine.
> The app calls `py` (Windows Python launcher) to run scripts.
> Add a note to friends: install Python 3.10+ and `pip install requests beautifulsoup4`.

---

## Troubleshooting

**"Cannot find module 'electron-store'"**
```bash
npm install
```

**Python fetch fails silently**
Open DevTools (`Ctrl+Shift+I`) → Console tab. Look for `[Python]` log lines.
Make sure `py --version` works in a regular terminal.

**App opens but shows no prices**
Click **Fetch Now** manually. First run takes ~10 seconds.
Check `%APPDATA%\GEnius\data\latest.json` exists after fetching.

**Build fails: "electron-builder not found"**
```bash
npm install --save-dev electron-builder
npm run build
```

---

## File Structure

```
GE-Intelligence/
├── package.json          ← Electron + build config
├── src/
│   ├── main.js           ← Electron main process (tray, IPC, scheduler)
│   ├── preload.js        ← Secure renderer bridge
│   ├── index.html        ← Entry point
│   └── renderer.js       ← Full React UI
├── python/
│   ├── run.py            ← Main runner (called by Electron)
│   ├── catalogue.py      ← All RS3 items by category
│   └── news.py           ← News scraper
├── assets/
│   └── icon.ico          ← App icon
├── data/                 ← Auto-created, gitignored
│   └── latest.json       ← Cached price data
└── BUILD.md              ← This file
```

---

## Data Location (after install)

User data (prices, alerts, settings) is stored at:
```
C:\Users\<you>\AppData\Roaming\GEnius\
```

Each user who installs the app gets their own isolated data folder.
