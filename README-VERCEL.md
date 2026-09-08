# Vercel Deploy (Backend API + Cron)

You can deploy this backend to Vercel even without a custom domain. Vercel will give you a URL like `https://<project>.vercel.app`.

## What you get
- API routes served at `https://<project>.vercel.app/api/...`
- Automated generation via **Vercel Cron** calling `/api/cron-generate` at:
  - 10:00 AM IST
  - 05:00 PM IST

## Required Vercel Environment Variables
Set these in the **backend** Vercel project:

- `MONGODB_URI`
- `GNEWS_API_KEY`
- `GROK_API_KEY`
- `GROK_API_URL` (default: `https://api.x.ai/v1/chat/completions`)
- `GROK_MODEL` (set the exact model name allowed by your key)
- `LINKEDIN_ACCESS_TOKEN`
- `LINKEDIN_USER_ID`

Optional:
- `UNSPLASH_API_KEY`
- `PEXELS_API_KEY`

Scheduler config:
- `SCHEDULER_TEST_MODE` (set `false` in prod)
- `SCHEDULER_MORNING_TIME` (default `10:00`)
- `SCHEDULER_EVENING_TIME` (default `17:00`)
- `DEDUP_WINDOW_HOURS` (default `48`)

Security (recommended):
- `CRON_SECRET` and send it as `x-cron-secret` header when calling `/api/cron-generate`.

## Notes
- On Vercel, do **not** rely on `node-cron` (no persistent server). Use Vercel Cron instead.
- Local dev still works with `node src/index.js`.
