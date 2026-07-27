import { redirect } from "next/navigation";

import { SignInForm } from "@/components/sign-in-form";
import { getCurrentStaff } from "@/lib/auth/authorization";

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const staff = await getCurrentStaff();

  if (staff) {
    redirect("/dashboard");
  }

  const parameters = await searchParams;
  const callbackUrl =
    parameters.callbackUrl?.startsWith("/") && !parameters.callbackUrl.startsWith("//")
      ? parameters.callbackUrl
      : "/dashboard";

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">Northstar Growth Agency</p>
        <h1>Staff sign in</h1>
        <p>Use a fictional local staff account to access the onboarding workspace.</p>
        <SignInForm callbackUrl={callbackUrl} />
      </section>
    </main>
  );
}
