# Deployment guide

## Local portfolio stack

Docker Compose, local n8n, Mailpit, MinIO, and the sandbox provisioning adapter are demonstration
components. They are not production integrations or a production deployment architecture.

Use `.env.example` only as a variable reference. Copy it to ignored `.env`, replace every fake
credential, and run:

```powershell
pnpm.cmd docker:up
```

## Production requirements

- Terminate HTTPS at a trusted reverse proxy and set `DEPLOYMENT_PROFILE=production`.
- Configure the public application, Auth.js, and browser object-storage origins as HTTPS.
- Set `TRUSTED_PROXY_HOPS` to the exact number of controlled proxy hops.
- Add HSTS at the HTTPS edge after confirming every subdomain is HTTPS-capable. Local HTTP
  deliberately does not emit HSTS.
- Use managed PostgreSQL, private object storage, a production SMTP provider, and a separately
  credentialed n8n deployment.
- Replace every local credential, encrypt backups, restrict egress, centralize audit logs, and
  configure monitoring and alerting.
- Keep n8n execution-data persistence disabled for these workflows and retain only application
  audit data required by policy.

The application rejects a production profile with HTTP public origins or without an explicitly
trusted proxy hop.
