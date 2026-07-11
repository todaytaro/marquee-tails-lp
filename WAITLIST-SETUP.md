# Waitlist — ops setup

The waitlist form (`components/WaitlistForm.tsx`) POSTs to `/api/waitlist`
(`app/api/waitlist/route.ts`), which stores signups via `lib/waitlist.ts`
using a two-step provider chain:

1. **Klaviyo** — used automatically when `KLAVIYO_API_KEY` **and**
   `KLAVIYO_LIST_ID` are both set. Subscribes the email to the list with
   `SUBSCRIBED` email-marketing consent via the Klaviyo JSON:API
   (`POST /api/profile-subscription-bulk-create-jobs/`, revision `2024-10-15`).
2. **Local JSONL fallback** — otherwise appends one JSON object per line
   (`{"email": "...", "ts": "...", "ua": "..."}`) to `.waitlist/emails.jsonl`
   at the repo root.

## Configure Klaviyo on Vercel (required before real traffic)

> The JSONL fallback writes to the serverless filesystem, which is
> **ephemeral on Vercel** — files vanish on every cold start, redeploy, and
> across lambda instances. It is a dev convenience only. **Do not send real
> traffic to this page until Klaviyo is configured.**

1. In Klaviyo: **Settings → API keys → Create Private API Key** with
   `Lists: Read/Write` and `Profiles: Write` scopes.
2. In Klaviyo: **Audience → Lists & segments**, open (or create) the waitlist
   list, and copy the **List ID** from the URL or the list's settings.
3. On Vercel: **Project → Settings → Environment Variables**, add for
   Production (and Preview if you want signups tested there):
   - `KLAVIYO_API_KEY` = the private key (`pk_...`)
   - `KLAVIYO_LIST_ID` = the list ID (e.g. `Xyz123`)

   Or via CLI:

   ```sh
   vercel env add KLAVIYO_API_KEY production
   vercel env add KLAVIYO_LIST_ID production
   ```

4. Redeploy. Env changes only take effect on the next deployment.
5. Verify: submit a test email on the deployed page and confirm the profile
   appears in the Klaviyo list (subscription jobs are async — allow a minute).

For local dev with Klaviyo, put the same two variables in `.env.local`
(gitignored). Leave them unset to use the JSONL fallback.

## Exporting emails

- **Klaviyo**: open the list → **Manage list → Export list to CSV**, or pull
  programmatically via `GET /api/lists/{LIST_ID}/profiles/`.
- **Local JSONL** (dev only): the file lives at `.waitlist/emails.jsonl`.
  Quick CSV export:

  ```sh
  echo "email,ts,ua" > waitlist.csv
  jq -r '[.email, .ts, .ua] | @csv' .waitlist/emails.jsonl >> waitlist.csv
  ```

  Keep `.waitlist/` out of git — it contains PII. Add it to `.gitignore` if
  it is not already there.

## Notes

- The API always returns `{ ok: true }` on success; errors return
  `{ ok: false, error }` with 400/429/500. PII travels in the POST body only —
  never in query strings.
- Bot protection: a hidden `company` honeypot field (silently "succeeds"
  without storing) plus a naive in-memory rate limit of 5 requests per IP per
  minute. The rate limit resets on cold start and is per-instance — fine for
  a pre-launch page, not a hard guarantee.
