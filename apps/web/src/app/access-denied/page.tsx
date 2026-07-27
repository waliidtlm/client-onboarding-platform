import Link from "next/link";

export default function AccessDeniedPage() {
  return (
    <main className="state-page">
      <section>
        <p className="eyebrow">Access denied</p>
        <h1>You do not have permission to view this information.</h1>
        <Link href="/dashboard">Return to dashboard</Link>
      </section>
    </main>
  );
}
