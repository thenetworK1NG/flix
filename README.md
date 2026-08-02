# Stremio Web

A Stremio-style web app (PWA) to search and stream torrents from The Pirate Bay.

## What it does

- Searches The Pirate Bay (via the apibay.org API) with a Netflix/Stremio-style dark UI.
- Home shows the top 100 torrents; Movies and TV Show tabs filter them by category.
- Click any torrent to see its file list, copy/open a magnet link, or **play it directly** in the browser.
- Playback is streamed through a local WebTorrent engine (the same approach Stremio uses) with HTTP range requests, so you can seek without downloading the whole file.
- Installable as a PWA: open the app, click the install icon in your browser's address bar.

## Run it

```
npm install
npm start
```

Then open http://localhost:8000

On Windows you can just double-click `start.bat`.

## Files

- `server.js` - serves the app, proxies Pirate Bay search, streams torrents (WebTorrent)
- `index.html` / `styles.css` / `app.js` - the PWA frontend
- `manifest.json` / `sw.js` - PWA manifest + service worker
- `icons/` - app icons (regenerate with `npm run install-icons`)
- `tools/make-icons.js` - icon generator

## Notes

- Streaming speed depends on peers for each torrent. Well-seeded releases start within seconds; fresh/rare releases may buffer or fail.
- `MKV` files play in modern browsers (Chrome/Edge/Firefox). For maximum compatibility pick an `MP4` release.
- Some browser install options require HTTPS; installing from `http://localhost` works without it.
- Only stream content you are legally allowed to access.
