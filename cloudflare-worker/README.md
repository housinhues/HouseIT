# HouseIT — Cloudflare Worker Setup

This folder contains the CV generation + PDF rendering Worker.

- `POST /generate` — proxies to NVIDIA NIM, keeps `NVIDIA_API_KEY` server-side,
  returns a fixed JSON schema (candidate/target/experience/education/skills) —
  never free-text prose.
- `POST /render-pdf` — takes that schema and renders a fixed-layout A4 PDF via
  `pdf-lib`. Layout coordinates are fixed; text is wrapped/truncated to fit
  fixed slots, so editing a field (phone number, a duty line, etc.) can never
  shift or break the printed layout.

Run `npm install` inside this folder before `wrangler deploy` so `pdf-lib` is
bundled (Cloudflare's Git integration does this automatically on push).

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
