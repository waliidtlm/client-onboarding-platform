import { createStaffFileDownload } from "@/application/files/download-service";
import { getCurrentStaff } from "@/lib/auth/authorization";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const staff = await getCurrentStaff();
  if (!staff) return new Response(null, { status: 401 });
  const { assetId } = await context.params;
  const result = await createStaffFileDownload(assetId, staff.id);
  if (!result.ok) {
    return Response.json(
      { error: { code: result.error.code, message: result.error.message } },
      { status: result.error.code === "ACCESS_DENIED" ? 403 : 404 },
    );
  }
  return Response.redirect(result.value.url, 303);
}
