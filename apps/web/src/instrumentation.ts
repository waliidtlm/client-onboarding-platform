export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateNodeServerEnvironment } = await import("@/instrumentation.node");
    validateNodeServerEnvironment();
  }
}
