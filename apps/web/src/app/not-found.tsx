import Link from "next/link";

export default function NotFound() {
  return (
    <main className="state-page">
      <section>
        <p className="eyebrow">Not found</p>
        <h1>The requested onboarding record does not exist.</h1>
        <Link href="/onboardings">Return to onboardings</Link>
      </section>
    </main>
  );
}
