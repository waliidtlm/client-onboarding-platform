"use client";

import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";

export function SignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const result = await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      callbackUrl,
      redirect: false,
    });

    if (!result?.ok) {
      setError("The email or password is invalid, or this account is unavailable.");
      setIsSubmitting(false);
      return;
    }

    window.location.assign(result.url ?? callbackUrl);
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>
        Staff email
        <input autoComplete="username" name="email" required type="email" />
      </label>
      <label>
        Password
        <input autoComplete="current-password" name="password" required type="password" />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button disabled={isSubmitting} type="submit">
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
