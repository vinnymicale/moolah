"use client";

import { useState } from "react";

export function Avatar({ user }: { user: { name?: string | null; email?: string | null; image?: string | null } }) {
  const [failed, setFailed] = useState(false);
  if (user.image && !failed) {
    return (
      // referrerPolicy="no-referrer" is required for Google profile images
      // (lh3.googleusercontent.com), which otherwise often fail to load. Fall
      // back to the initial avatar if the image still can't be fetched.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.image}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-8 w-8 rounded-full object-cover"
      />
    );
  }
  const initial = (user.name ?? user.email ?? "?").charAt(0).toUpperCase();
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/15 text-sm font-semibold text-brand">
      {initial}
    </div>
  );
}
