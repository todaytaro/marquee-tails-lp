"use client";

import { useState } from "react";

/**
 * Permission to show this order on Marquee Tails' own social accounts. Sits
 * directly under DeliveryRating on the premiere page — the moment the customer
 * has just watched their film is both the most likely yes and the most honest
 * time to ask.
 *
 * Two boxes, not one (lib/share-consent.ts): the second only appears once the
 * first is ticked, because publishing someone's own photos is only ever wanted
 * as the "before" half of a before/after, and offering it on its own would
 * invite a permission we'd never act on. Un-ticking the first clears the
 * second, here and on the server.
 *
 * Deliberately quieter than the rating card above it — no border, no heading
 * of its own. This is a request being made of the customer, and dressing it up
 * to look like part of the celebration would be pushing.
 */

type Props = {
  orderId: string;
  approveToken: string;
  petName: string;
  initialFilm: boolean;
  initialPhotos: boolean;
};

export default function ShareConsent({
  orderId,
  approveToken,
  petName,
  initialFilm,
  initialPhotos,
}: Props) {
  const [film, setFilm] = useState(initialFilm);
  const [photos, setPhotos] = useState(initialPhotos);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function save(nextFilm: boolean, nextPhotos: boolean) {
    const prev = { film, photos };
    setFilm(nextFilm); // optimistic
    setPhotos(nextPhotos);
    setSaving(true);
    setError(false);
    try {
      const res = await fetch("/api/orders/share-consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, approveToken, film: nextFilm, photos: nextPhotos }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      setFilm(prev.film);
      setPhotos(prev.photos);
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-md text-left">
      <label className="flex cursor-pointer items-start gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={film}
          disabled={saving}
          // Un-ticking the film box takes the photo permission with it — the
          // server enforces the same rule, this just keeps the UI honest about
          // what is about to be stored.
          onChange={(e) => save(e.target.checked, e.target.checked ? photos : false)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--gold)]"
        />
        <span>
          Marquee Tails may share {petName}&apos;s film on our social accounts.
        </span>
      </label>

      {film && (
        <label className="mt-2 flex cursor-pointer items-start gap-2 pl-6 text-sm text-muted">
          <input
            type="checkbox"
            checked={photos}
            disabled={saving}
            onChange={(e) => save(film, e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--gold)]"
          />
          <span>
            …and the photos I sent in, shown alongside it as a before / after.
          </span>
        </label>
      )}

      <p className="mt-2 text-xs text-muted/80">
        Entirely optional, and you can change your mind any time — just come
        back to this page and untick it.
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-gold-bright">
          That didn&apos;t save — please try again.
        </p>
      )}
    </div>
  );
}
