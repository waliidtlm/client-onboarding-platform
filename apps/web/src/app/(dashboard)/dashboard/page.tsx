import Link from "next/link";

export default function DashboardPage() {
  return (
    <section>
      <p className="eyebrow">Phase 1 · Trusted staff access</p>
      <h1>Onboarding workspace</h1>
      <p className="lead">
        Review authoritative client, package, contract, invoice, and payment records. Phase 1 is
        read-only and does not change onboarding state.
      </p>
      <Link className="button-link" href="/onboardings">
        View onboardings
      </Link>
    </section>
  );
}
