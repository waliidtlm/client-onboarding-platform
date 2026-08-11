import NextAuth from "next-auth";

import { authOptions } from "@/auth/options";
import { enforceStaffSignInRateLimit } from "@/lib/auth/signin-rate-limit";

const handler = NextAuth(authOptions);

export { handler as GET };

export async function POST(
  request: Request,
  context: { params: Promise<{ nextauth: string[] }> },
): Promise<Response> {
  const limited = await enforceStaffSignInRateLimit(request);
  return limited ?? handler(request, context);
}
