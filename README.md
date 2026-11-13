# MyTube

A YouTube-style app for Google TV, using your own YouTube account.

- `web/` – the app itself (React + TypeScript), hosted on Vercel. Pushing to `main` redeploys it, and the TV picks up the change on the next launch.
- `web/api/auth/` – sign-in endpoints (Google "TV & limited input" device flow). Need `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Vercel env vars.
- `android/` – a small Android TV app that opens the website full screen. GitHub Actions builds it on every change under `android/` and publishes `mytube.apk` as the latest release.

## Install on the TV
1. On the TV, install **Downloader** (by AFTVnews) from the Play Store.
2. Allow it to install unknown apps (Settings → Apps → Security & restrictions → Unknown sources → Downloader).
3. In Downloader, open `https://<your-site>.vercel.app/apk` and install.

## Customize
- `web/src/config.ts` – defaults: region, hide Shorts, blocked channels/keywords, feed mix, autoplay.
- `web/src/api.ts` – how each feed is built (YouTube Data API v3; 10,000 units/day; search costs 100).
- `web/src/styles.css` – look and feel. `web/src/tv.ts` – remote/D-pad behaviour.

## Remote controls in the player
OK = play/pause · ◀ ▶ = 10 s · ▼ = details, like, subscribe, up next · Back = leave.

## Limits of the official API
YouTube does not give outside apps your personal recommendations, watch history or Watch Later.
"For you" is built from your subscriptions' latest uploads mixed with Trending.

Note: `android/keystore/mytube.jks` signs the APK so updates install over the old version.
The repo is public, so move it to a GitHub secret if you ever publish this app for others.
