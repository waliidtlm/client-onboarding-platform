# Dependency Risk Exceptions

## GHSA-mh99-v99m-4gvg

- Status: Temporarily accepted
- Package: brace-expansion 1.1.16
- Scope: Development and CI tooling only
- Introduced through: ESLint dependency chain
- Production runtime exposure: None identified
- Production dependency audit: Passing
- Owner: Repository maintainer

### Current mitigation

- Production images exclude development dependencies.
- ESLint runs only against repository-controlled source files.
- CI uses fixed repository-owned commands.
- No untrusted application input is passed to ESLint or glob patterns.

### Remediation limitation

- The current compatible ESLint plugin chain still depends on the affected package.
- Forcing brace-expansion 5 through an override is API-incompatible with minimatch 3.
- Upgrading ESLint currently causes unsupported peer-dependency conflicts.

### Exit condition

Remove this exception when:

- the ESLint and Next.js plugin dependency chain supports a patched version; or
- a compatible maintained backport becomes available.

This exception does not suppress Dependabot or GitHub vulnerability alerts.

### CI enforcement

CI requires:

```text
pnpm audit --prod --audit-level high
```

On Windows, run the equivalent command:

```powershell
pnpm.cmd audit --prod --audit-level high
```

Known development-tooling exception unchanged. Production dependency audit passed.
