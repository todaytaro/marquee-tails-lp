import { put } from "@vercel/blob";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Waitlist storage provider chain:
 *
 * 1. Klaviyo — used when KLAVIYO_API_KEY and KLAVIYO_LIST_ID are both set.
 *    Subscribes the profile to the configured list via the Klaviyo JSON:API
 *    (profile-subscription-bulk-create-jobs). This is the production path.
 *
 * 2. Vercel Blob — used when BLOB_READ_WRITE_TOKEN is set (private store,
 *    one JSON file per signup under waitlist/). Durable interim storage
 *    until Klaviyo is configured. Export: `npx vercel blob list`.
 *
 * 3. Local JSONL fallback — appends one JSON object per line to
 *    .waitlist/emails.jsonl at the repo root. Dev-only convenience:
 *    on serverless hosts (Vercel) the filesystem is EPHEMERAL and writes
 *    are lost on every cold start / redeploy. See WAITLIST-SETUP.md.
 */

const KLAVIYO_REVISION = "2024-10-15";

export interface WaitlistEntry {
  email: string;
  /** ISO-8601 timestamp of the signup. */
  ts: string;
  /** User-agent string of the submitting client. */
  ua: string;
}

export async function addToWaitlist(entry: WaitlistEntry): Promise<void> {
  const apiKey = process.env.KLAVIYO_API_KEY;
  const listId = process.env.KLAVIYO_LIST_ID;

  if (apiKey && listId) {
    await subscribeViaKlaviyo(entry.email, apiKey, listId);
    return;
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await saveToBlob(entry);
    return;
  }

  await appendToLocalJsonl(entry);
}

async function saveToBlob(entry: WaitlistEntry): Promise<void> {
  // One small JSON file per signup; addRandomSuffix avoids collisions when
  // two signups share a timestamp. The store is private, so blobs are only
  // readable with the token (`npx vercel blob list` to export).
  await put(`waitlist/${entry.ts}.json`, JSON.stringify(entry), {
    access: "private",
    addRandomSuffix: true,
    contentType: "application/json",
  });
}

async function subscribeViaKlaviyo(
  email: string,
  apiKey: string,
  listId: string
): Promise<void> {
  const res = await fetch(
    "https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/",
    {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        "Content-Type": "application/vnd.api+json",
        revision: KLAVIYO_REVISION,
      },
      body: JSON.stringify({
        data: {
          type: "profile-subscription-bulk-create-job",
          attributes: {
            custom_source: "Marquee Tails waitlist landing page",
            profiles: {
              data: [
                {
                  type: "profile",
                  attributes: {
                    email,
                    subscriptions: {
                      email: { marketing: { consent: "SUBSCRIBED" } },
                    },
                  },
                },
              ],
            },
          },
          relationships: {
            list: { data: { type: "list", id: listId } },
          },
        },
      }),
    }
  );

  // Klaviyo returns 202 Accepted for queued subscription jobs.
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Klaviyo subscribe failed: ${res.status} ${res.statusText} ${detail}`.trim()
    );
  }
}

async function appendToLocalJsonl(entry: WaitlistEntry): Promise<void> {
  const dir = path.join(process.cwd(), ".waitlist");
  const file = path.join(dir, "emails.jsonl");
  await mkdir(dir, { recursive: true });
  await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
}
