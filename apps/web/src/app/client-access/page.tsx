import type { Metadata } from "next";

import { ClientPortal } from "@/components/client-access/client-portal";

export const metadata: Metadata = {
  title: "Secure client access",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ClientAccessPage() {
  return <ClientPortal />;
}
