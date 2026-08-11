# Security hardening checkpoint

This checkpoint records the controls carried through Phase 7.

## Dependency advisory analysis

The source report is stored locally at `docs/security-audit.local.json` and is intentionally ignored.
The table is historical evidence from the Phase 7 remediation checkpoint; its dependency paths
record the graph before remediation rather than claiming to be the current manifest.

| Package and installed version | Advisory                                                                                      | Severity and affected range             | Complete production-audit path                                                                                           | Exposure in this application                                                                                                                                                                                                                   | Remediation and compatibility risk                                                                                                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sharp 0.34.5`                | `GHSA-f88m-g3jw-g9cj`; `CVE-2026-33327`, `CVE-2026-33328`, `CVE-2026-35590`, `CVE-2026-35591` | High; `<0.35.0`; patched `>=0.35.0`     | `@client-onboarding/web > next 16.2.12 > sharp`; `@client-onboarding/web > next-auth 4.24.15 > next 16.2.12 > sharp`     | Optional runtime dependency introduced by direct dependency `next`. The application has no image upload or attacker-controlled image-processing path, which limits current reachability, but production still contains the vulnerable library. | Next `16.2.12` was the current release and constrained Sharp to `^0.34.5`, so `next>sharp` is overridden to registry-current `0.35.3`. Compatibility risk is medium because this crosses a pre-1.0 minor boundary; production build and browser tests are mandatory. |
| `postcss 8.4.31`              | `GHSA-qx2v-qp2m-jg93`                                                                         | Moderate; `<8.5.10`; patched `>=8.5.10` | `@client-onboarding/web > next 16.2.12 > postcss`; `@client-onboarding/web > next-auth 4.24.15 > next 16.2.12 > postcss` | Runtime audit scope through direct dependency `next`, but the affected stringify behavior is used primarily during trusted application builds. The application does not accept attacker-controlled CSS.                                        | Covered by the scoped `next>postcss` override to `8.5.23`. Compatibility risk is low-to-medium and is controlled by formatting, build, and browser verification.                                                                                                     |
| `postcss 8.4.31`              | `GHSA-6g55-p6wh-862q`                                                                         | High; `<=8.5.11`; patched `>=8.5.12`    | `@client-onboarding/web > next 16.2.12 > postcss`; `@client-onboarding/web > next-auth 4.24.15 > next 16.2.12 > postcss` | The vulnerable source-map behavior is not exposed to untrusted CSS in the current product, but the production dependency graph remains affected.                                                                                               | Same scoped PostCSS override to `8.5.23`; low-to-medium compatibility risk.                                                                                                                                                                                          |
| `postcss 8.4.31`              | `GHSA-r28c-9q8g-f849`                                                                         | High; `<=8.5.17`; patched `>=8.5.18`    | `@client-onboarding/web > next 16.2.12 > postcss`; `@client-onboarding/web > next-auth 4.24.15 > next 16.2.12 > postcss` | The current application does not process attacker-controlled source maps. A patched production graph is still required.                                                                                                                        | Same scoped PostCSS override to registry-current `8.5.23`; low-to-medium compatibility risk.                                                                                                                                                                         |
| `find-my-way 9.6.0`           | `GHSA-c96f-x56v-gq3h`                                                                         | High; `<=9.6.0`; patched `>=9.6.1`      | `@client-onboarding/web > @prisma/client 7.9.0 > prisma 7.9.0 > @prisma/dev 0.24.14 > find-my-way`                       | Marked production by the peer dependency path, but `@prisma/dev` is migration/development tooling and is not copied into the standalone web runtime. The vulnerable HTTP/2 router is not used by application routes.                           | Upgrade the direct Prisma family to patch release `7.9.1`, which selects `@prisma/dev 0.24.17` and `find-my-way 9.7.0`. Compatibility risk is low because the Prisma version change is patch-only.                                                                   |
| `valibot 1.2.0`               | `GHSA-5qjj-4xww-7phc`                                                                         | Moderate; `<=1.4.1`; patched `>=1.4.2`  | `@client-onboarding/web > @prisma/client 7.9.0 > prisma 7.9.0 > @prisma/dev 0.24.14 > valibot`                           | Marked production by the same Prisma peer path, but it is used by Prisma development tooling rather than application request validation.                                                                                                       | Prisma `7.9.1` selects `@prisma/dev 0.24.17` and patched `valibot 1.4.2`. Compatibility risk is low.                                                                                                                                                                 |

At the checkpoint, the remediated graph contained Sharp `0.35.3`, PostCSS `8.5.23`, find-my-way
`9.7.0`, Valibot `1.4.2`, and Prisma `7.9.1`. The current manifest has since advanced to Next.js
`16.3.0`, direct PostCSS `8.5.26`, and the other reviewed Dependabot updates while retaining the
scoped transitive overrides below. CI requires `pnpm audit --prod` to report no known
vulnerabilities.

### Override policy

The original Next.js overrides remain intentionally scoped to dependencies of `next`:

- `next>sharp: 0.35.3`
- `next>postcss: 8.5.23`

Two additional child-specific overrides keep newly disclosed high-severity transitive advisories
out of the production graph without changing application APIs:

- `ajv>fast-uri: 3.1.5`
- `postcss>nanoid: 3.3.17`

At the checkpoint, Next.js `16.2.12` was registry-current but still declared the vulnerable
versions, so upgrading the direct parent was not possible. The direct parent is now `16.3.0`, but
the scoped overrides remain until their transitive paths can be removed through a reviewed lockfile
change. The overrides are not global and are not security suppressions. Dependabot continues to
monitor the parent packages.

pnpm added exact `minimumReleaseAgeExclude` entries for the Prisma `7.9.1` patch family because the
security patch was newer than the workspace supply-chain quarantine window. These entries do not
allow a floating version or suppress advisories. Remove them after the pinned releases have aged
past the quarantine window.

## Continuous verification

CI uses stable major GitHub Action tags (`actions/checkout@v7`, `pnpm/action-setup@v6`, and
`actions/setup-node@v7`). This policy receives vendor security patches within a reviewed major
version. Dependabot monitors GitHub Actions so major upgrades remain explicit.

CI uses fictional, isolated PostgreSQL and staff credentials. It runs the existing database bootstrap
and destructive reset only against `onboarding_test`.

## Deployment security requirements

- Staff login limiting uses PostgreSQL-backed hashed IP and account subjects. Production must set
  the exact trusted reverse-proxy hop count.
- `N8N_SECURE_COOKIE` must be `true` behind production HTTPS.
- The n8n editor must not be publicly exposed.
- Production credentials must never use `.env.example` values.
- HTTPS is required for production authentication cookies.
- The tested CSP restricts the required resource classes and becomes HTTPS-only in the production
  profile. It is not nonce-based. Add HSTS at the production HTTPS proxy, never to local HTTP.
- Localhost bindings protect local development only; they are not production access controls.

Rate-limit database failure denies staff login and public writes. Do not replace this with an
in-memory limiter.

## GitHub repository settings

Source files cannot enable repository security settings. In the GitHub repository:

1. Open **Settings → Security → Code security and analysis**.
2. Enable the **Dependency graph**.
3. Enable **Dependabot alerts**. This is also GitHub's vulnerability-alert feed.
4. Enable **Dependabot security updates**.
5. Enable **Secret scanning** and then **Push protection**, if the repository plan supports private
   repository secret protection.
6. Open **Security → Code scanning**, choose **Set up code scanning**, and select **Default setup**
   for CodeQL, or add an equivalent reviewed code-scanning workflow.
7. Confirm the Security tab shows dependency, secret-scanning, and code-scanning results.

After this CI workflow appears on the pull request:

1. Open **Settings → Rules → Rulesets → New ruleset → New branch ruleset**.
2. Name it `main protection`, set enforcement to **Active**, and target the `main` branch.
3. Enable **Restrict deletions** and **Block force pushes**.
4. Enable **Require status checks to pass** and select the CI `verify` check.
5. Do not require an additional approving reviewer while this remains a solo project.

GitHub may require a paid plan for rulesets or security features on a private repository. Do not make
the repository public merely to unlock a setting.
