# HouseIT — Cloudflare Worker Setup

This folder contains the CV generation Worker that proxies requests to NVIDIA NIM,
keeping the NVIDIA_API_KEY server-side (never exposed to the browser).

## One manual step required (Cloudflare dashboard — cannot be done via GitHub API)

1. Go to Cloudflare dashboard → Workers & Pages → Create → **Connect to Git**
2. Select repo: `housinhues/HouseIt`
3. Set root directory to `cloudflare-worker/`
4. Build/deploy command: Cloudflare will detect `wrangler.toml` automatically
5. In the Worker's Settings → Variables → add an **encrypted** environment variable:
   - Name: `NVIDIA_API_KEY`
   - Value: (your NVIDIA NIM key)
6. Deploy. Every push to `main` will auto-redeploy after this.

## Frontend integration

Once deployed, you'll get a URL like `houseit-cv-gen.<subdomain>.workers.dev`.
The frontend's `generateCV()` function in `index.html` needs its fake `setTimeout`
block replaced with a real `fetch()` call to `https://<your-worker-url>/generate`.
