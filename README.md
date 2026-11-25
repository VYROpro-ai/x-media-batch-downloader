# X Media Batch Downloader (TwitterDL)

**Live demo:** https://vyropro-ai.github.io/x-media-batch-downloader/

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/VYROpro-ai/x-media-batch-downloader)

## GitHub Pages vs Vercel

- **GitHub Pages** (`docs/index.html`) is the static demo: tweet links work live in the browser (via the public FxTwitter API), and the Demo button shows the sample flow. Full profile timelines do **not** work there — a browser on github.io cannot call `api.x.com` (it sends no CORS headers), so profile timeline media needs a server.
- **Vercel** is the full version: deploy the same repo with the button above and profile fetching works (username / profile URL fetches the whole timeline via the server routes), with no license key or auth token needed.

A Next.js 16, TypeScript, and Tailwind CSS v4 single-page web application for inspecting and downloading media from public X (Twitter) usernames, profile URLs, or single tweet URLs, packaging selected items into a `.zip` archive in the browser, and converting videos to animated GIFs locally using `ffmpeg.wasm`.

## Setup & Local Development

1. Install dependencies:

```bash
npm install
```

2. Build the production bundle:

```bash
npm run build
```

3. Start the development server (or npm start after building):

```bash
npm run dev
```

## Optional Environment Variables

Guest-token access is handled automatically on the server without requiring a license key, auth token, or user login. Optionally, you can set X_AUTH_TOKEN and X_CT0 in your environment if you want cookie-authenticated GraphQL requests instead of guest tokens.

## Vercel Deployment Note

This project uses standard Next.js App Router Route Handlers (/api/fetch and /api/download) and client-side jszip / @ffmpeg/ffmpeg execution. Push the repository to GitHub or import it directly into Vercel and deploy with the default Next.js build settings. Because timeline pagination and media downloads run against live external endpoints, be mindful of serverless function execution timeouts on large batches (a 200-media safety cap is enforced per fetch).

## Disclaimer

TwitterDL is an independent platform and is not affiliated with, sponsored by, or endorsed by X Corp. This tool is intended for personal use only. Users are solely responsible for complying with applicable copyright laws and X's Terms of Service. No user accounts, search logs, or downloaded media files are stored on our servers; preferences and history are stored locally in your browser's localStorage.
