import { createClientFileDownload } from "@/application/files/download-service";
import {
  authorizeClientRequest,
  publicResult,
  publicServiceUnavailable,
} from "@/lib/client-access/public-route";

export async function POST(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  try {
    const authorized = await authorizeClientRequest(request, { mutation: true });
    if (!authorized.ok) return authorized.response;
    const { assetId } = await context.params;
    return publicResult(
      await createClientFileDownload(assetId, {
        onboardingId: authorized.access.onboardingId,
        tokenId: authorized.access.tokenId,
      }),
    );
  } catch {
    return publicServiceUnavailable();
  }
}
