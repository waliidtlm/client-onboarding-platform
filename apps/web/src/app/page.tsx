const foundationItems = [
  "Next.js App Router",
  "Strict TypeScript",
  "PostgreSQL readiness",
  "Isolated n8n database",
  "Structured logging",
  "Automated verification",
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl items-center px-6 py-16">
      <section className="w-full rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-12">
        <p className="text-sm font-semibold tracking-[0.2em] text-blue-700 uppercase">
          Phase 0 · Project Foundation
        </p>
        <h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
          Client Onboarding Platform
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
          The technical foundation is ready. Business workflows, users, roles, and onboarding
          entities intentionally begin in later phases.
        </p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2" aria-label="Foundation capabilities">
          {foundationItems.map((item) => (
            <li
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700"
              key={item}
            >
              {item}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
