"use client";

import { signOut } from "next-auth/react";

export function SignOutControl() {
  return (
    <button
      className="button-secondary"
      onClick={() => signOut({ callbackUrl: "/signin" })}
      type="button"
    >
      Sign out
    </button>
  );
}
