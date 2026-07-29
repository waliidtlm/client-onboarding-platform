import { loadClientPortal } from "@/application/client-access/portal-query";
import { authorizeClientRequest, publicServiceUnavailable } from "@/lib/client-access/public-route";
import { genericAccessDenied, publicJson } from "@/lib/client-access/public-security";

export async function GET(request: Request): Promise<Response> {
  try {
    const authorized = await authorizeClientRequest(request, { mutation: false });
    if (!authorized.ok) return authorized.response;
    const portal = await loadClientPortal(
      authorized.access.onboardingId,
      authorized.access.tokenId,
    );
    return portal ? publicJson(portal) : genericAccessDenied();
  } catch {
    return publicServiceUnavailable();
  }
}
