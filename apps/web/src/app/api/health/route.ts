export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    {
      status: "ok",
      service: "client-onboarding-web",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
