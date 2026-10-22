# EEERP Netlify frontend deployment

For the new Railway backend and persistent-login update, follow
[RAILWAY_DEPLOYMENT.md](RAILWAY_DEPLOYMENT.md). The Render URLs below describe
the old setup and must only be replaced after the new Railway service is ready.

## Architecture

Netlify publishes `public/`, which contains the ERP frontend (`index.html`,
`login.html`, styles, and images). The `public/_redirects` rewrite proxies
browser requests from `/api/*` to `https://eeerp-wc5k.onrender.com/api/*`. The
address in the browser remains `https://eerp.netlify.app`, so the existing
relative API requests and cookie-based admin session do not need any code
changes.

The Eternal Essence storefront must continue posting directly to the Express
backend endpoint:

```text
https://eeerp-wc5k.onrender.com/api/integrations/ecommerce/sales
```

Keep its existing `x-integration-key`; do not expose that key in Netlify or in
the browser.

## Netlify project settings

For the GitHub repository containing the `EEERP-main` folder:

- Base directory: `EEERP-main` (only if it is a subfolder of the repository)
- Publish directory: `public`
- Build command: leave empty
- Production branch: the branch that contains this configuration, normally
  `main`

No Netlify environment variable is required for the current proxy. The backend
origin is intentionally in `public/_redirects`, because it is a public URL and
Netlify redirect targets cannot directly interpolate environment variables.

## Render backend environment variables

```text
NODE_ENV=production
MONGO_URI=<existing MongoDB connection string>
SESSION_SECRET=<existing long random secret>
ADMIN_USER=<existing admin username>
ADMIN_PASS=<existing admin password>
INTEGRATION_API_KEY=<existing storefront shared key>
FRONTEND_URLS=https://eerp.netlify.app,https://eternalessence.in,https://www.eternalessence.in
```

Do not set `PORT`; Render supplies it. If you attach a custom Netlify domain,
append that HTTPS origin to `FRONTEND_URLS` too.

## Deploy and verify

1. Commit and push `netlify.toml` and the other changes to the production
   branch, then trigger a Netlify deploy.
2. Update Render's `FRONTEND_URLS`, save it, and let the backend redeploy.
3. Visit `https://eerp.netlify.app/login.html`, sign in, and confirm the
   dashboard, stock, sales, and logout work.
4. Check `https://eerp.netlify.app/api/health`; it should return the backend's
   JSON health response through Netlify.

The Netlify proxy has a 26-second request limit. A Render Free backend can take
about a minute to wake after idling, so use a paid Render instance to eliminate
the failed/slow first request.
