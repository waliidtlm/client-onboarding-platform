# Isolated Phase 7 portfolio demo

The demo uses the Compose project `client-onboarding-phase7-demo`, database
`onboarding_phase7_demo`, separate named volumes, and non-default loopback ports. It refuses to
run if the database name or exact fixture marker differs.

Run the complete final gate:

```powershell
pnpm.cmd verify:final
```

Run only the isolated demo:

```powershell
pnpm.cmd demo:phase7
```

Clean only demo-owned containers, volumes, messages, objects, and the isolated database:

```powershell
pnpm.cmd demo:phase7:cleanup
```

The automated scenario uses only `.test` recipients and verifies:

1. commercial correction and activation;
2. one transient provisioning failure followed by a successful retry;
3. internal approval and client access;
4. one rejected requirement and a corrected immutable version;
5. requirements completion, kickoff, Delivery handoff, acknowledgment, and `COMPLETED`;
6. client-access revocation;
7. a recoverable dead-letter or uncertain-delivery path;
8. reminder materialization and Mailpit evidence;
9. private MinIO object evidence;
10. terminal audit history and service health.

Screenshots are generated from this fixture only. Browser state is stored in a temporary
in-memory context and discarded after capture. The capture uses a fixed 1440 x 1000 viewport,
disables animations, rejects visible credentials, hashes, bearer fragments, and local paths, and
then overwrites the three stable portfolio filenames.
