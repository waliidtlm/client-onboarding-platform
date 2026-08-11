# Isolated portfolio demo

The demo uses the Compose project `client-onboarding-phase7-demo`, database
`onboarding_phase7_demo`, separate named volumes, and non-default loopback ports. It refuses to
run if the database name or exact fixture marker differs.

## Evaluator walkthrough

This scenario is intended to answer four questions quickly:

1. Can the platform carry one client through the complete onboarding lifecycle?
2. Are failures, retries, and manual decisions visible and auditable?
3. Are client access, uploaded files, and automation credentials handled safely?
4. Can the result be reproduced without touching another local database or Docker project?

After the automated run, review:

| Evidence                 | What it demonstrates                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| Workflow overview        | Ownership, commercial state, blockers, next actions, and terminal status in one view                   |
| Completed onboarding     | Commercial, provisioning, requirements, kickoff, handoff, completion, and audit evidence on one record |
| Automation recovery      | Bounded attempts, safe failure presentation, role restriction, and explicit recovery guidance          |
| Mailpit and MinIO checks | Fictional email delivery and private-object evidence without external services                         |
| Final fixture summary    | `COMPLETED` state, client-access revocation, reminder count, versions, tasks, and audit history        |

The first run can take longer while Docker images and Chromium are downloaded. Later runs use the
same isolated identifiers but recreate only demo-owned state.

## Commands

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

## Automated evidence

The scenario uses only `.test` recipients and verifies:

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

## Screenshot safety

Screenshots are generated from this fixture only. Browser state is stored in a temporary
in-memory context and discarded after capture. The capture uses a fixed 1440 x 1000 viewport,
disables animations, rejects visible credentials, hashes, bearer fragments, and local paths, and
then overwrites the three stable portfolio filenames.
