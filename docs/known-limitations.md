# Known limitations

- Provisioning creates local `sandbox://` resources only; it does not call real SaaS providers.
- Mailpit captures local email and MinIO provides local private object storage.
- Local n8n imports are manual and workflow activation is an operator step.
- Docker Compose is a local portfolio environment, not a high-availability deployment.
- Staff authentication uses local credentials. Production SSO, MFA, recovery, and account
  administration remain outside Phase 7.
- CSP is environment-aware but not nonce-based. Local development permits the script/style
  behavior required by Next.js.
- Reminder delivery is email-only and limited to the four documented policies.
- Manual recovery intentionally exposes retry only for the existing eligible activation event.
  Other failures route to their event-specific onboarding controls.
- The audit timeline is capped at the latest 200 safe events.
