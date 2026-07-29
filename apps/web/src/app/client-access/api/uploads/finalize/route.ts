import { finalizeFileUploadIntent } from "@/application/files/upload-service";
import { readLimitedJson } from "@/lib/client-access/public-security";
import {
  authorizeClientRequest,
  publicResult,
  publicServiceUnavailable,
} from "@/lib/client-access/public-route";

export async function POST(request: Request): Promise<Response> {
  try {
    const authorized = await authorizeClientRequest(request, { mutation: true });
    if (!authorized.ok) return authorized.response;
    const body = (await readLimitedJson(request)) as Record<string, unknown>;
    return publicResult(
      await finalizeFileUploadIntent({
        ...body,
        tokenId: authorized.access.tokenId,
        onboardingId: authorized.access.onboardingId,
      }),
    );
  } catch {
    return publicServiceUnavailable();
  }
}
