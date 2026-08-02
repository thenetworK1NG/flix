# FLIX (Stremio Web)

A Stremio-style web app (PWA) to search and stream torrents from The Pirate Bay. Runs entirely in the browser and deploys to **GitHub Pages** — no server required.

## What it does

- Searches The Pirate Bay (via the `apibay.org` API) with a Netflix/Stremio-style dark UI.
- Home shows the top 100 torrents; Movies and TV Show tabs filter them by category.
- Click any torrent to see its file list, copy/open a magnet link, or **play it directly** in the browser.
- Playback uses **client-side WebTorrent** (WebRTC/WebSocket peers), so you don't need a backend server.
- Installable as a PWA: open the app, click the install icon in your browser's address bar.

## Live site

https://thenetwork1ng.github.io/flix/

## Run it locally

You can serve the static files with any static server:

```
npx serve .
```

Or run the old Node-based server (streaming via server-side WebTorrent + ffmpeg):

```
npm install
npm start
```

Then open http://localhost:8000

## Deploy to GitHub Pages

1. Push this repo to GitHub (currently `thenetworK1NG/flix`, branch `main`).
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the workflow manually via **Actions → Deploy to GitHub Pages → Run workflow**). The workflow stages only the static files and deploys them.
4. Your site is live at `https://<user>.github.io/flix/`.

The workflow file is `.github/workflows/pages.yml`.

## Files

- `index.html` / `styles.css` / `app.js` - the PWA frontend (fully static)
- `manifest.json` / `sw.js` - PWA manifest + service worker
- `icons/` - app icons (regenerate with `npm run install-icons`)
- `tools/make-icons.js` - icon generator
- `server.js` - optional legacy Node server (server-side streaming + MKV transcode)
- `.github/workflows/pages.yml` - GitHub Pages deploy

## Notes

- Browsers talk to `apibay.org` directly (allows CORS). Posters load from `images.metahub.space`.
- Playback depends on peers and on **WebRTC/WebSocket trackers**. Well-seeded releases start quickly; the browser can only reach peers that speak WebTorrent, so some torrents may not start — use the magnet link with a desktop app (e.g. VLC) for those.
- Browsers can only play `MP4`/`WebM`/`OGV` video and `MP3`/`M4A`/`AAC`/`OGG`/`Opus`/`FLAC`/`WAV` audio. When you open a torrent, the file list only shows browser-playable files; non-playable formats (mostly MKV/AVI) are hidden, and if a release has none the app says so and offers the magnet link for VLC.
- Only stream content you are legally allowed to access.
