# StudioVault

> **Tagline:** *Music Behind Closed Doors.*  
> **Parent Studio:** THORiii Studio  
> **Live Site:** [https://studiovaults.netlify.app/](https://studiovaults.netlify.app/)

A premium, members-only studio streaming platform for recordings created by **THORiii Studio**.

---

## 🎧 Features

- **Cinematic Experience**: Designed with a sleek black & red identity (`--sv-bg: #08090B`, `--sv-accent: #F20D19`).
- **Responsive Layout**: Mobile-first architecture with persistent bottom player bar, mini-player, and desktop navigation dock.
- **Catalogue & Discovery**:
  - Featured Studio Streaming banner ("Stream. Download. Support the Studio.")
  - Recently Added tracks & releases
  - Artist showcase & Curated Playlists (Chill Vibes, Worship & Praise, Studio Essentials)
- **Interactive Audio**:
  - Global persistent audio player surviving route navigation
  - Track queueing, seeking, volume controls, and play/pause
  - Permission-aware downloads (short-lived access)

---

## 📂 Project Structure

```
StudioVault/
├── assets/          # Application scripts and stylesheet bundles
│   ├── index-BMREgprW.js
│   ├── index-Bw0IuofN.css
│   └── routes-SppZKRk9.js
├── img/             # Brand identity & high-resolution artwork
│   ├── hero.png     # Studio hero banner
│   └── logo.png     # Official StudioVault wordmark & logo
├── index.html       # Application entry point
└── _redirects       # SPA redirect configuration for Netlify/hosting
```

---

## 🚀 Deployment

This application is ready for instant deployment on Netlify or GitHub Pages.

- **Netlify**: Deploy using `netlify deploy --prod` or link directly to this repository.
- **SPA Routing**: Configured via `_redirects` (`/* /index.html 200`).
