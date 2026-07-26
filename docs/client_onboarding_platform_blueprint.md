# Client Onboarding Automation Platform — Project Blueprint

**Version:** 1.0  
**Date:** 2026-07-26  
**Project type:** Production-minded MVP portfolio case study  
**Reference business:** Small-to-medium marketing agency  
**Primary outcome:** Automate the transition from a closed deal to a delivery-ready project without losing control of approvals, client requirements, provisioning, or audit history.

---

## 1. Executive Summary

This project is an internal client onboarding platform supported by n8n automation.

The system begins when Sales submits an approved client handoff. It validates the handoff, tracks contract and payment readiness, activates onboarding only when the Commercial Gate passes, provisions internal resources, collects client requirements, supports Project Manager review, schedules kickoff, and hands the project to the delivery team.

The platform is intentionally not a full CRM, ERP, billing platform, project-management suite, or client portal. It provides the minimum operational interface required for staff to track onboarding, make approvals, correct exceptions, and review history.

### Core architecture decision

```text
Internal UI / Secure Client Form
              │
              ▼
     Next.js Application Layer
              │
              ▼
         PostgreSQL
     Source of business truth
              ▲
              │
             n8n
 External orchestration and integrations
```

PostgreSQL stores the authoritative state. The application backend owns business-state transitions. n8n performs external and background work but does not independently decide or directly overwrite core onboarding states.

---

## 2. Business Context

### Target company

A marketing agency that sells packaged services such as:

- Paid advertising setup
- SEO retainers
- Content-marketing services
- Social-media management
- Website or landing-page projects

### Current operational problem

After a deal closes, information is usually scattered across email, CRM notes, documents, spreadsheets, chat messages, and individual employees.

Common consequences:

- Missing sales handoff information
- Projects starting before contract or payment requirements are satisfied
- Project Managers manually creating the same folders and tasks
- Clients receiving inconsistent instructions
- Client assets arriving through multiple channels
- No clear visibility into who is blocking onboarding
- Duplicate reminders and duplicated setup actions
- Delivery teams receiving incomplete handoffs
- No reliable onboarding history or SLA data

### Proposed solution

Create a controlled onboarding process with:

- Commercial activation rules
- Package-driven onboarding tasks
- Automated resource provisioning
- Secure client requirement submission
- Human approval checkpoints
- Kickoff and delivery handoff
- Reminders, retries, logging, and audit history

---

## 3. Project Goals

### Primary goals

1. Give the agency one place to see every active onboarding.
2. Prevent onboarding from starting before commercial requirements are satisfied.
3. Standardize onboarding according to the purchased service package.
4. Reduce repeated manual setup work.
5. Give clients one secure way to submit required information and assets.
6. Require Project Manager approval before onboarding progresses.
7. Produce an auditable handoff to the delivery team.
8. Demonstrate a production-minded automation architecture in a portfolio.

### Success indicators

The case study should be able to demonstrate:

- Time from valid sales handoff to onboarding activation
- Time from activation to welcome email
- Percentage of requirements approved on first submission
- Number of overdue client requirements
- Number of provisioning retries or manual interventions
- Time from activation to delivery handoff
- Duplicate-action prevention
- Complete audit trail for important decisions

These indicators may be shown on the onboarding detail page or documented as future reporting metrics. A full analytics dashboard is not required for the MVP.

---

## 4. Scope

## 4.1 MVP scope

The MVP includes:

- Internal staff authentication
- Role-based access
- Sales handoff intake and validation
- Contract and payment-status tracking
- Commercial Gate calculation
- Onboarding activation
- Project Manager assignment
- Package-based provisioning tasks
- Sequential provisioning through n8n
- Internal readiness review
- Welcome email
- Secure client submission link
- Client requirement submission
- Project Manager approval or rejection
- Requirement resubmission
- Kickoff tracking
- Delivery handoff
- Reminder and escalation workflow
- Shared error handling
- Audit history
- Idempotency controls
- Health checks
- Docker-based local environment
- Unit, integration, and end-to-end tests

## 4.2 Explicit non-goals

Do not build the following in the MVP:

- Complete CRM
- Full accounting or payment-processing system
- Contract-authoring platform
- Complex document-signature integration
- Multi-tenant SaaS billing
- Client usernames and passwords
- Advanced calendar availability matching
- Chat or messaging inbox
- General project-management platform
- Workflow designer
- AI agent making business approvals
- Generic rules engine
- Kafka, RabbitMQ, Kubernetes, or microservices
- Real-time WebSocket architecture
- Advanced analytics suite
- Parallel provisioning

The architecture should allow later evolution without implementing those features now.

---

## 5. Approved Business Decisions

These decisions override contradictory wording in earlier drafts.

### Decision 1 — Create onboarding early, activate it later

An inactive onboarding record is created when the Sales handoff is submitted.

```text
Sales handoff submitted
        ↓
Inactive onboarding record created
        ↓
Commercial processing
        ↓
Commercial Gate approved
        ↓
Existing onboarding activated
```

The system must not create a second onboarding after Commercial Gate approval.

### Decision 2 — Hybrid activation condition

Onboarding activates only when all conditions are true:

```text
Deal Status = CLOSED_WON
AND Contract Status = SIGNED
AND Activation Requirement = SATISFIED
AND no unresolved blocking commercial review exists
```

`Payment Status = PAID` is not required when the purchased package permits activation after a deposit.

Payment Status and Activation Requirement remain separate.

### Decision 3 — Welcome email follows internal readiness

Commercial Gate approval does not directly send the welcome email.

Commercial Gate approval triggers:

- Onboarding activation
- PM assignment
- Package task generation
- Provisioning
- SLA start

The welcome email is sent only after required internal resources are ready and the PM approves readiness.

### Decision 4 — Project Manager is the MVP onboarding owner

The Project Manager is responsible for:

- Internal readiness review
- Client requirement review
- Kickoff completion
- Delivery handoff preparation

An Account Manager role may be added later but is not required for the MVP.

### Decision 5 — Backend owns state transitions

Neither React components nor n8n workflows may directly invent or bypass status transitions.

All important state changes must call application services that:

1. Load current state.
2. Check authorization.
3. Validate the requested transition.
4. Perform changes in a database transaction.
5. Write an audit event.
6. Create an automation event when external work is required.

### Decision 6 — Sequential provisioning for MVP

Provisioning tasks execute sequentially because it simplifies debugging, retries, and demonstration.

Parallel execution is documented as a future enhancement.

---

## 6. Actors and Responsibilities

| Actor | Main responsibilities |
|---|---|
| Sales | Submit and correct the sales handoff |
| Operations | Track contract preparation and revision |
| Finance | Track invoices, verify payments, resolve discrepancies |
| Project Manager | Own onboarding readiness, requirement review, kickoff, and handoff |
| Delivery Lead | Receive and acknowledge the delivery handoff |
| Administrator | Manage users, packages, assignments, and exceptional corrections |
| Client | Submit requested information and assets through a secure link |
| n8n Service | Execute approved background and integration work |

### MVP roles

```text
ADMIN
SALES
OPERATIONS
FINANCE
PROJECT_MANAGER
DELIVERY
```

Authorization is enforced on the server, not only by hiding interface controls.

---

## 7. End-to-End Business Workflow

```text
Sales Handoff Submitted
        │
        ▼
Create Inactive Onboarding
        │
        ▼
Validate Sales Handoff
        │
        ├── Incomplete
        │      ▼
        │  SALES_HANDOFF_INCOMPLETE
        │      ▼
        │  Notify Sales
        │      ▼
        │  Sales Corrects Handoff
        │      └──────────────► Validate Again
        │
        ▼
Commercial Phase
Contract + Invoice + Payment Tracking
        │
        ▼
Evaluate Commercial Gate
        │
        ├── Blocked → Remain in Commercial Phase
        │
        ▼
COMMERCIAL_GATE_APPROVED
        │
        ▼
Activate Existing Onboarding
        │
        ▼
Assign Project Manager
        │
        ▼
Generate Package Tasks and Requirements
        │
        ▼
Provision Internal Resources Sequentially
        │
        ▼
PM Internal Readiness Review
        │
        ├── Changes Required
        │      ▼
        │  Correct Internal Setup
        │      └──────────────► Review Again
        │
        ▼
Send Welcome Email
        │
        ▼
CLIENT_AWAITING_ACTION
        │
        ▼
Client Submits Requirements
        │
        ▼
PM Reviews Submission
        │
        ├── Rejected
        │      ▼
        │  Notify Client
        │      ▼
        │  Client Corrects and Resubmits
        │      └──────────────► Review Again
        │
        ▼
All Mandatory Requirements Approved
        │
        ▼
CLIENT_REQUIREMENTS_COMPLETE
        │
        ▼
Schedule or Record Kickoff
        │
        ▼
KICKOFF_PENDING
        │
        ▼
Kickoff Meeting Completed
        │
        ▼
PROJECT_READY
        │
        ▼
Create Delivery Handoff
        │
        ▼
Delivery Team Acknowledges Handoff
        │
        ▼
ONBOARDING_COMPLETED
```

---

## 8. Workflow Decomposition

Use four core n8n workflows and two supporting workflows.

## 8.1 Workflow 01 — Sales Handoff and Commercial Gate

### Purpose

Validate the commercial handoff and determine when onboarding may activate.

### Triggers

- New sales handoff submitted
- Corrected sales handoff submitted
- Contract status changed
- Payment recorded or verified
- Commercial exception approved or rejected
- Manual gate recalculation requested

### Main steps

1. Receive event containing `eventId`, `eventType`, and `onboardingId`.
2. Fetch current onboarding and commercial data from the application API.
3. Validate event idempotency.
4. Execute approved external tasks when needed:
   - Send acknowledgment
   - Send signature reminder
   - Send payment reminder
   - Notify internal owner
5. Call the application API to record the automation result.
6. Request Commercial Gate recalculation through the application API.
7. When the gate becomes approved, create an `ONBOARDING_ACTIVATED` event.

### Successful output

```text
commercialGateStatus = APPROVED
onboardingStatus = READY_FOR_ONBOARDING
activatedAt = timestamp
```

### Key exceptions

- Incomplete handoff
- Contract revision
- Signature timeout
- Payment timeout
- Manual payment review
- Amount mismatch
- Commercial exception
- Client cancellation

Commercial exceptions remain a documented advanced path. The case-study demo does not need to exercise every exception.

---

## 8.2 Workflow 02 — Internal Onboarding and Provisioning

### Purpose

Prepare the onboarding internally before the client receives onboarding instructions.

### Trigger

```text
eventType = ONBOARDING_ACTIVATED
```

### Main steps

1. Load current onboarding from the application API.
2. Confirm the activation event has not already completed.
3. Confirm a Project Manager is assigned.
4. Load package-generated provisioning tasks.
5. Execute tasks sequentially.
6. Before each task, check whether it is already completed.
7. Mark the task `IN_PROGRESS` through the application API.
8. Execute the external provisioning action.
9. Report `COMPLETED`, `FAILED`, or `MANUAL_REVIEW_REQUIRED`.
10. Retry transient failures up to the configured limit.
11. Do not repeat successfully completed tasks.
12. Notify the Project Manager if manual intervention is required.
13. When all required tasks are complete or accepted for manual completion, set the onboarding to `INTERNAL_REVIEW`.
14. Wait for the PM to approve internal readiness in the UI.
15. After approval, send the welcome email.
16. Record the message result and transition to `CLIENT_AWAITING_ACTION`.

### Example provisioning tasks

For the case study, use three or four visible tasks:

- Create client folder structure
- Create project workspace or project record
- Create internal kickoff checklist
- Create communication channel or placeholder

External systems may be mocked or represented by local adapters during development. The system must still preserve task statuses and idempotency.

---

## 8.3 Workflow 03 — Client Requirements Management

### Purpose

Collect, review, reject, and approve client-provided requirements.

### Triggers

- Welcome email sent
- Client requirement submitted
- PM approves a requirement
- PM rejects a requirement
- Client resubmits a rejected requirement
- Requirement reminder becomes due

### Main steps

1. The client opens a secure tokenized URL.
2. The client views mandatory and optional requirements.
3. The client submits text, URLs, or files.
4. The application stores the submission and sets the requirement to `SUBMITTED`.
5. An automation event notifies the assigned PM.
6. The PM opens the requirement in the internal dashboard.
7. The PM approves or rejects it.
8. Rejection requires a reason.
9. Rejected requirements return to the client for correction.
10. Approval triggers a completeness check.
11. When every mandatory requirement is approved, transition the onboarding to `CLIENT_REQUIREMENTS_COMPLETE`.

### Requirement lifecycle

```text
PENDING
   ↓
SUBMITTED
   ↓
UNDER_REVIEW
   ├── APPROVED
   └── REJECTED
          ↓
       SUBMITTED
```

Optional requirements never block progress.

---

## 8.4 Workflow 04 — Kickoff and Delivery Handoff

### Purpose

Move an onboarding with complete client requirements into active delivery.

### Trigger

```text
eventType = CLIENT_REQUIREMENTS_COMPLETED
```

### Main steps

1. Create a kickoff scheduling request or allow the PM to record a meeting.
2. Set kickoff status to `PENDING`.
3. Send the kickoff invitation or scheduling link.
4. Allow the PM to record the meeting as completed.
5. Require a brief kickoff outcome note.
6. Set onboarding status to `PROJECT_READY`.
7. Generate a delivery handoff summary.
8. Notify the Delivery Lead.
9. Allow the Delivery Lead or PM to acknowledge the handoff.
10. Set onboarding status to `COMPLETED`.
11. Record completion timestamp and SLA result.

### MVP simplification

Do not build calendar availability matching. Use one of:

- A manually entered meeting date
- A stored external scheduling URL
- A basic calendar event integration

---

## 8.5 Workflow 05 — Reminders and Escalations

### Purpose

Find overdue work without keeping n8n executions open for days.

### Trigger

Scheduled execution every hour or every day.

### Checks

- Sales handoff incomplete beyond 24 hours
- Contract signature overdue
- Payment overdue
- Client requirements overdue
- Requirement review overdue
- Provisioning manual review unresolved
- Kickoff not scheduled
- Delivery handoff not acknowledged

### Rules

- Query overdue items through the application API.
- Send only reminders that have not already been sent for the configured interval.
- Record every reminder in the notification log.
- Escalate only according to configured policy.
- Do not create one long-running workflow with multiple Wait nodes.

---

## 8.6 Workflow 06 — Shared Error Handler

### Purpose

Capture failed n8n executions and expose them to the application.

### Main steps

1. Trigger from n8n Error Trigger.
2. Capture:
   - Workflow name
   - Execution ID
   - Onboarding ID when available
   - Event ID
   - Failed node
   - Error class
   - Error message
   - Timestamp
3. Classify the error as transient or permanent when possible.
4. Report the failure to the application API.
5. Notify the responsible internal role for permanent failures.
6. Avoid including secrets or sensitive client files in error messages.

---

## 9. Status Model

## 9.1 Onboarding status

```text
SALES_HANDOFF_INCOMPLETE
COMMERCIAL_PENDING
READY_FOR_ONBOARDING
INTERNAL_SETUP
INTERNAL_REVIEW
CLIENT_AWAITING_ACTION
CLIENT_REQUIREMENTS_COMPLETE
KICKOFF_PENDING
PROJECT_READY
COMPLETED
CANCELLED
ARCHIVED
```

### Allowed primary transitions

```text
SALES_HANDOFF_INCOMPLETE → COMMERCIAL_PENDING
COMMERCIAL_PENDING → READY_FOR_ONBOARDING
READY_FOR_ONBOARDING → INTERNAL_SETUP
INTERNAL_SETUP → INTERNAL_REVIEW
INTERNAL_REVIEW → CLIENT_AWAITING_ACTION
CLIENT_AWAITING_ACTION → CLIENT_REQUIREMENTS_COMPLETE
CLIENT_REQUIREMENTS_COMPLETE → KICKOFF_PENDING
KICKOFF_PENDING → PROJECT_READY
PROJECT_READY → COMPLETED
Any pre-completion state → CANCELLED
CANCELLED → ARCHIVED
COMPLETED → ARCHIVED
```

Invalid transitions must return a domain error and create no partial updates.

## 9.2 Supporting statuses

### Sales handoff

```text
PENDING_VALIDATION
INCOMPLETE
COMPLETE
```

### Deal

```text
OPEN
CLOSED_WON
CLOSED_LOST
```

### Contract

```text
DRAFT
PENDING_SIGNATURE
REVISION_REQUESTED
SIGNED
CANCELLED
```

### Invoice and payment

```text
InvoiceStatus:
DRAFT
ISSUED
PARTIALLY_PAID
PAID
OVERDUE
CANCELLED

ActivationRequirementStatus:
NOT_SATISFIED
MANUAL_REVIEW_REQUIRED
SATISFIED

PaymentVerificationStatus:
PENDING
VERIFIED
REVIEW_REQUIRED
REJECTED
```

### Commercial Gate

```text
BLOCKED
PENDING_REVIEW
APPROVED
CANCELLED
```

### Provisioning task

```text
PENDING
IN_PROGRESS
COMPLETED
FAILED
MANUAL_REVIEW_REQUIRED
MANUALLY_ACCEPTED
```

### Client requirement

```text
PENDING
SUBMITTED
UNDER_REVIEW
APPROVED
REJECTED
```

### Kickoff

```text
NOT_SCHEDULED
PENDING
SCHEDULED
COMPLETED
CANCELLED
```

### Automation event

```text
PENDING
PROCESSING
COMPLETED
FAILED
DEAD_LETTER
```

---

## 10. Technical Stack

## 10.1 Frontend

- Next.js using App Router
- TypeScript
- Tailwind CSS
- React Server Components for read-heavy pages
- Client Components only for interactive forms and controls

## 10.2 Backend

- Next.js Route Handlers for webhooks, public endpoints, n8n callbacks, and health checks
- Server Actions for authenticated internal UI mutations
- TypeScript
- Zod request and environment validation
- Application services containing business logic

Do not call the application's own HTTP API from Server Components when they can call application services directly.

## 10.3 Database

- PostgreSQL
- Prisma ORM
- Prisma migrations
- Transactions for important state transitions
- PostgreSQL is the source of business truth

## 10.4 Authentication

- Auth.js
- Prisma adapter
- Database-backed staff users and roles
- Secure tokenized client submission links instead of client accounts

## 10.5 Automation

- n8n
- Email orchestration
- Notifications
- Provisioning
- Reminder schedules
- Integration callbacks
- Shared error handling

## 10.6 File storage

- S3-compatible object storage
- MinIO in local Docker development
- Production may use S3, R2, or another compatible service
- PostgreSQL stores file metadata, not file bytes

## 10.7 Infrastructure and development

- Docker Compose
- Persistent PostgreSQL volume
- Separate application and n8n databases/users
- Persistent n8n data
- Persistent MinIO volume
- `.env` and `.env.example`
- Health checks
- pnpm workspace
- ESLint
- Prettier
- Vitest
- Playwright
- Structured logging with Pino
- Mailpit may be used as a development-only email inbox

---

## 11. Application Architecture

```text
Presentation
├── React Server Components
├── Client Components
├── Server Actions
└── Route Handlers

Application
├── OnboardingService
├── CommercialGateService
├── ProvisioningService
├── RequirementService
├── KickoffService
├── HandoffService
├── AuthorizationService
└── AutomationEventService

Domain
├── Status transition rules
├── Commercial Gate calculation
├── Activation amount calculation
├── Requirement completeness rules
├── Readiness rules
└── Domain errors

Infrastructure
├── Prisma repositories
├── Auth.js
├── Object storage adapter
├── n8n client
├── Email adapter where needed
├── Logger
└── Environment configuration
```

### Separation rule

Route Handlers, Server Actions, and React components are transport and presentation layers. They must not contain the authoritative business workflow.

---

## 12. Source-of-Truth and Integration Boundaries

### Application database

Stores:

- Clients
- Packages
- Onboardings
- Contract and payment state
- Provisioning tasks
- Client requirements and submissions
- Kickoff state
- Delivery handoff state
- Audit events
- Automation events
- Notification history
- File metadata

### n8n internal database

Stores only n8n operational data:

- Workflow definitions
- Credentials
- Executions
- Internal n8n configuration

Use the same PostgreSQL server in the MVP if desired, but use:

```text
Database: onboarding_app
User: onboarding_app_user

Database: n8n_internal
User: n8n_user
```

The n8n user must not have direct write access to application business tables.

### n8n write rule

Preferred:

```text
n8n → authenticated application endpoint → application service → PostgreSQL
```

Avoid:

```text
n8n → Postgres node → direct onboarding status update
```

---

## 13. Data Model

The schema should be normalized enough for reliable behavior but kept manageable.

## 13.1 User

```text
id
name
email
role
isActive
createdAt
updatedAt
```

## 13.2 Client

```text
id
companyName
contactName
contactEmail
contactPhone
createdAt
updatedAt
```

## 13.3 ServicePackage

```text
id
name
description
isActive
activationType
activationValue
createdAt
updatedAt
```

`activationType`:

```text
FULL_PAYMENT_PERCENTAGE
DEPOSIT_PERCENTAGE
FIXED_DEPOSIT_AMOUNT
MANUAL_APPROVAL
```

## 13.4 PackageProvisioningTemplate

```text
id
servicePackageId
name
description
sequence
isRequired
automationKey
createdAt
updatedAt
```

## 13.5 PackageRequirementTemplate

```text
id
servicePackageId
name
description
inputType
isRequired
sequence
dueOffsetDays
createdAt
updatedAt
```

Possible `inputType` values:

```text
TEXT
URL
FILE
MULTI_FILE
```

## 13.6 Onboarding

```text
id
clientId
servicePackageId
externalDealId
dealStatus
salesHandoffStatus
commercialGateStatus
status
projectManagerId
submittedById
validatedById
invoiceTotal
currency
activationRequiredAmount
activationRequirementStatus
activatedAt
welcomeEmailSentAt
requirementsCompletedAt
projectReadyAt
completedAt
cancelledAt
cancellationReason
version
createdAt
updatedAt
```

`version` supports optimistic concurrency for conflicting updates.

## 13.7 Contract

```text
id
onboardingId
status
versionNumber
signatureDeadline
signedAt
revisionReason
externalReference
createdAt
updatedAt
```

## 13.8 Invoice

```text
id
onboardingId
status
invoiceNumber
totalAmount
currency
dueAt
overdueAt
externalReference
createdAt
updatedAt
```

## 13.9 Payment

```text
id
invoiceId
originalAmount
verifiedAmount
currency
verificationStatus
discrepancyReason
evidenceFileId
submittedBy
verifiedById
verifiedAt
externalReference
createdAt
updatedAt
```

Never overwrite `originalAmount`.

## 13.10 ProvisioningTask

```text
id
onboardingId
templateId
name
sequence
isRequired
status
attemptCount
lastErrorCode
lastErrorMessage
externalReference
startedAt
completedAt
manuallyAcceptedById
manuallyAcceptedAt
createdAt
updatedAt
```

Unique protection should prevent duplicate generated tasks per onboarding and template.

## 13.11 ClientRequirement

```text
id
onboardingId
templateId
name
description
inputType
isRequired
status
dueAt
approvedById
approvedAt
rejectionReason
createdAt
updatedAt
```

## 13.12 RequirementSubmission

```text
id
requirementId
submissionVersion
textValue
urlValue
submittedAt
reviewedAt
reviewedById
reviewDecision
reviewReason
createdAt
```

Submissions are immutable. A correction creates a new version.

## 13.13 FileAsset

```text
id
onboardingId
requirementSubmissionId
storageKey
originalFilename
mimeType
sizeBytes
checksum
uploadedAt
createdAt
```

## 13.14 ClientAccessToken

```text
id
onboardingId
tokenHash
expiresAt
revokedAt
lastUsedAt
createdAt
```

Store only a hash of the token.

## 13.15 KickoffMeeting

```text
id
onboardingId
status
scheduledAt
completedAt
externalCalendarId
meetingUrl
outcomeNotes
createdAt
updatedAt
```

## 13.16 DeliveryHandoff

```text
id
onboardingId
deliveryLeadId
summary
status
createdById
createdAt
acknowledgedAt
```

## 13.17 AuditEvent

```text
id
onboardingId
actorType
actorId
action
entityType
entityId
previousValue
newValue
metadata
correlationId
createdAt
```

Audit records are append-only.

## 13.18 AutomationEvent

```text
id
eventType
aggregateType
aggregateId
payload
status
attemptCount
availableAt
processedAt
lastError
correlationId
createdAt
updatedAt
```

## 13.19 AutomationRun

```text
id
automationEventId
workflowName
n8nExecutionId
idempotencyKey
status
attemptNumber
startedAt
completedAt
errorCode
errorMessage
createdAt
```

`idempotencyKey` must be unique.

## 13.20 NotificationLog

```text
id
onboardingId
notificationType
recipient
channel
status
idempotencyKey
sentAt
failureReason
createdAt
```

---

## 14. Commercial Gate Calculation

Create one authoritative function:

```ts
calculateCommercialGate(input): CommercialGateResult
```

### Approval logic

```text
approved =
  dealStatus is CLOSED_WON
  AND contractStatus is SIGNED
  AND activationRequirementStatus is SATISFIED
  AND no blocking payment review exists
  AND no pending commercial exception exists
  AND onboarding is not cancelled
```

### Required result

The function returns:

```text
status
blockingReasons[]
evaluatedAt
```

Example blockers:

```text
DEAL_NOT_CLOSED_WON
CONTRACT_NOT_SIGNED
ACTIVATION_AMOUNT_NOT_SATISFIED
PAYMENT_REVIEW_REQUIRED
COMMERCIAL_EXCEPTION_PENDING
ONBOARDING_CANCELLED
```

The function must be deterministic and covered by table-driven unit tests.

---

## 15. Application Services

Minimum services:

```text
createOnboardingFromSalesHandoff
validateSalesHandoff
updateContractStatus
recordPayment
reviewPayment
recalculateCommercialGate
activateOnboarding
assignProjectManager
generatePackageTasks
startProvisioningTask
completeProvisioningTask
failProvisioningTask
acceptManualProvisioning
approveInternalReadiness
recordWelcomeEmailResult
submitClientRequirement
approveClientRequirement
rejectClientRequirement
checkRequirementCompleteness
scheduleKickoff
completeKickoff
createDeliveryHandoff
acknowledgeDeliveryHandoff
cancelOnboarding
recordAutomationCallback
```

Each service must:

1. Validate input with Zod at the boundary.
2. Load the current database state.
3. Check actor authorization.
4. Validate the allowed state transition.
5. Use a database transaction where multiple records change.
6. Write an audit event.
7. Create an automation event when external work is required.
8. Return a typed result or typed domain error.

---

## 16. User Interface

## 16.1 Internal screens

### Sign-in

- Auth.js authentication
- Clear access-denied state

### Onboarding list

Columns:

```text
Client
Package
Project Manager
Onboarding Status
Commercial Gate
Current Blocker
Next Action
Created Date
SLA Indicator
```

Filters:

```text
Status
Project Manager
Commercial Gate
Overdue
```

### Onboarding detail

Recommended sections or tabs:

```text
Overview
Commercial
Provisioning
Client Requirements
Kickoff and Handoff
Activity
```

The detail page should show:

- Current status
- Current blocker
- Next expected action
- Responsible owner
- Important timestamps
- Audit timeline

### Internal readiness review

The PM can:

- Review all required provisioning tasks
- See failures and retries
- Accept a task for manual completion with a required note
- Request correction
- Approve internal readiness

### Requirement review

The PM can:

- View the latest submission
- Review earlier versions
- Open submitted files
- Approve
- Reject with a required reason

### Kickoff and handoff

The PM can:

- Record scheduling details
- Mark kickoff completed
- Add outcome notes
- Generate delivery handoff
- Confirm handoff completion

## 16.2 Secure client form

The client can:

- View agency and onboarding context
- View mandatory and optional requirements
- Submit text, URL, and files
- See whether a requirement is pending, submitted, approved, or rejected
- Read the rejection reason
- Submit a corrected version

The client cannot:

- View internal commercial information
- View other clients
- Change package or contract data
- Approve their own submission
- Access expired or revoked tokens

A complete client dashboard and client account are not required.

---

## 17. API and Server Boundaries

## 17.1 Route Handlers

Use Route Handlers for public or machine-facing requests.

Suggested endpoints:

```text
POST /api/internal/sales-handoffs
POST /api/internal/commercial-events
POST /api/internal/automation/claim
POST /api/internal/automation/callback
POST /api/internal/automation/failure
GET  /api/internal/onboardings/:id/automation-context

GET  /api/public/onboarding/:token
POST /api/public/onboarding/:token/requirements/:requirementId/submissions
POST /api/public/onboarding/:token/files/presign

GET  /api/health
GET  /api/ready
```

Do not create an endpoint for every internal button when a Server Action can call the application service directly.

## 17.2 Server Actions

Suggested internal mutations:

```text
validateSalesHandoffAction
assignProjectManagerAction
approveInternalReadinessAction
acceptManualProvisioningAction
approveRequirementAction
rejectRequirementAction
scheduleKickoffAction
completeKickoffAction
createDeliveryHandoffAction
acknowledgeDeliveryHandoffAction
cancelOnboardingAction
```

Every Server Action must re-check authentication and authorization.

---

## 18. Automation Event Contract

Every event sent to n8n should follow one stable envelope:

```json
{
  "eventId": "evt_123",
  "eventType": "ONBOARDING_ACTIVATED",
  "aggregateType": "ONBOARDING",
  "aggregateId": "onb_123",
  "occurredAt": "2026-07-26T12:00:00Z",
  "correlationId": "corr_123",
  "schemaVersion": 1,
  "payload": {}
}
```

### Rules

- Send identifiers, not stale copies of the whole onboarding.
- n8n loads current data from an authenticated API.
- Callbacks include `eventId` and `idempotencyKey`.
- Duplicate callbacks return success without repeating the action.
- Unknown schema versions are rejected.
- External reference IDs are stored for traceability.

### Authentication

Use:

- Service token for n8n API access
- HMAC request signature
- Timestamp validation
- Constant-time signature comparison
- Secret rotation documented as a future operational procedure

---

## 19. Idempotency and Concurrency

### Idempotency examples

```text
GENERATE_PACKAGE_TASKS:{onboardingId}:{packageVersion}
PROVISION:{provisioningTaskId}
WELCOME_EMAIL:{onboardingId}:v1
REQUIREMENT_REMINDER:{requirementId}:{reminderNumber}
KICKOFF_INVITATION:{kickoffId}:v1
DELIVERY_HANDOFF:{onboardingId}:v1
```

### Required behavior

- Repeated requests with the same key must not repeat completed side effects.
- Successfully provisioned tasks must not be re-executed.
- Welcome emails must not be sent twice.
- Requirement submissions remain versioned.
- Conflicting staff updates should be detected using the onboarding `version` field or transaction-level validation.

---

## 20. Reliability Strategy

### Transactions

Use database transactions for:

- Commercial Gate approval and onboarding activation
- Package task and requirement generation
- Requirement approval and completeness transition
- Kickoff completion and project readiness
- Delivery handoff acknowledgment and onboarding completion

### Retry policy

n8n retries only transient external failures:

- Network timeout
- Temporary API failure
- Rate limit
- Temporary email-provider failure

Do not automatically retry:

- Invalid data
- Unauthorized access
- Invalid status transition
- Rejected payment evidence
- Unsupported file type
- Missing business configuration

### Dead-letter behavior

After the maximum retry count:

- Set the automation event to `DEAD_LETTER`.
- Record the final error.
- Notify the responsible role.
- Allow an authorized manual retry.

---

## 21. Security Requirements

### Authentication and authorization

- Auth.js protects internal pages.
- Roles are stored in PostgreSQL.
- Server-side authorization is mandatory.
- Disabled users lose access immediately according to session strategy.

### Client submission security

- Use high-entropy random tokens.
- Store only token hashes.
- Add expiration and revocation.
- Rate-limit public endpoints.
- Do not reveal whether another onboarding exists.
- Validate every submitted requirement belongs to the token's onboarding.

### File security

- Restrict MIME types.
- Restrict maximum file size.
- Generate random storage keys.
- Never trust original filenames.
- Store checksums.
- Use signed upload and download URLs.
- Prevent public bucket listing.
- Document malware scanning as a production enhancement.

### n8n security

- Never commit credentials in exported workflow JSON.
- Use n8n credential storage.
- Configure a fixed n8n encryption key.
- Do not publicly expose the editor.
- Protect production webhooks.
- Use least-privilege service credentials.
- Redact sensitive values from logs.

### Database security

- Separate application and n8n users.
- Use least privilege.
- Do not expose PostgreSQL publicly in production.
- Keep migrations in version control.
- Backups and restore testing are production deployment requirements.

---

## 22. Observability and Audit

### Structured application logs

Use Pino and include:

```text
timestamp
level
message
requestId
correlationId
userId
onboardingId
eventId
action
errorCode
durationMs
```

Do not log:

- Raw access tokens
- Passwords
- Auth cookies
- Full payment evidence
- Sensitive file contents
- n8n credentials

### Audit timeline

Show human-readable events such as:

```text
Sales handoff submitted
Sales handoff validated
Contract marked signed
Activation requirement satisfied
Commercial Gate approved
Project Manager assigned
Provisioning task completed
Internal readiness approved
Welcome email sent
Client requirement submitted
Requirement rejected
Requirement resubmitted
Requirement approved
Kickoff completed
Delivery handoff acknowledged
Onboarding completed
```

### Health endpoints

```text
/api/health
```

Confirms the web process is running.

```text
/api/ready
```

Confirms required dependencies such as PostgreSQL are reachable.

Docker health checks should use these endpoints.

---

## 23. Testing Strategy

## 23.1 Unit tests with Vitest

Test deterministic domain rules:

- Sales handoff completeness
- Commercial Gate calculation
- Activation amount calculation
- Allowed status transitions
- Provisioning readiness calculation
- Mandatory requirement completeness
- Role authorization rules
- Idempotency-key generation

Use table-driven tests for status combinations.

## 23.2 Integration tests

Run against a real test PostgreSQL database.

Test:

- Prisma repositories
- Transactions
- Unique constraints
- Concurrent approval attempts
- Audit-event creation
- Automation-event creation
- Public token validation
- Requirement submission versioning
- Duplicate callback handling

## 23.3 API tests

Test:

- Zod rejection of malformed input
- Authentication failures
- Authorization failures
- HMAC validation
- Expired callback timestamps
- Duplicate event processing
- Rate limiting
- File metadata validation

## 23.4 Playwright end-to-end tests

Minimum critical scenarios:

### Happy path

1. Sales submits valid handoff.
2. Contract becomes signed.
3. Activation payment threshold is satisfied.
4. Commercial Gate approves.
5. Provisioning completes.
6. PM approves readiness.
7. Welcome email is recorded.
8. Client submits all mandatory requirements.
9. PM approves them.
10. Kickoff is completed.
11. Delivery handoff is acknowledged.
12. Onboarding becomes completed.

### Correction path

1. Sales submits incomplete handoff.
2. System blocks commercial processing.
3. Sales corrects the handoff.
4. Workflow resumes.

### Requirement rejection path

1. Client submits a requirement.
2. PM rejects it with a reason.
3. Client resubmits.
4. PM approves it.
5. Original submission remains in history.

### Reliability path

1. Provisioning task fails transiently.
2. n8n retries.
3. Task succeeds.
4. No duplicate resource is created.

### Idempotency path

1. Repeat welcome-email callback.
2. Verify only one notification log exists.
3. Verify onboarding status remains correct.

## 23.5 n8n verification

- Exported workflow JSON is valid.
- Workflows contain no real credentials.
- Error Trigger is configured.
- Retry settings are documented.
- Workflow is inactive by default in the repository unless deployment requires otherwise.
- A smoke test validates each webhook and callback contract.

---

## 24. Docker Compose Architecture

Recommended services:

```text
web
postgres
n8n
minio
mailpit        # development only
```

### PostgreSQL setup

One server may host two databases:

```text
onboarding_app
n8n_internal
```

Use separate users and permissions.

### Persistent volumes

```text
postgres_data
n8n_data
minio_data
```

### Required health checks

- PostgreSQL readiness
- Next.js `/api/ready`
- n8n health endpoint
- MinIO readiness

### Environment handling

- Commit `.env.example`.
- Never commit `.env`.
- Validate required environment variables at startup with Zod.
- Fail fast when mandatory configuration is missing.

---

## 25. Suggested Repository Structure

```text
client-onboarding-platform/
├── apps/
│   └── web/
│       ├── app/
│       │   ├── (auth)/
│       │   ├── (dashboard)/
│       │   ├── client/
│       │   └── api/
│       ├── components/
│       ├── lib/
│       └── public/
│
├── packages/
│   ├── core/
│   │   ├── domain/
│   │   ├── application/
│   │   ├── authorization/
│   │   └── errors/
│   │
│   ├── database/
│   │   ├── prisma/
│   │   ├── repositories/
│   │   └── seed/
│   │
│   ├── contracts/
│   │   ├── schemas/
│   │   └── events/
│   │
│   └── config/
│       └── environment.ts
│
├── automation/
│   └── n8n/
│       ├── workflows/
│       ├── examples/
│       └── README.md
│
├── tests/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
│
├── docs/
│   ├── architecture.md
│   ├── business-rules.md
│   ├── workflow-overview.md
│   ├── status-model.md
│   ├── security.md
│   ├── testing.md
│   ├── deployment.md
│   ├── demo-script.md
│   └── decisions/
│       ├── ADR-001-postgres-source-of-truth.md
│       ├── ADR-002-backend-owns-transitions.md
│       ├── ADR-003-n8n-orchestration-boundary.md
│       └── ADR-004-sequential-provisioning-mvp.md
│
├── scripts/
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json
├── .env.example
├── .gitignore
├── README.md
└── LICENSE
```

Use one `packages/core` package at first. Split it only if the project genuinely becomes difficult to maintain.

---

## 26. Implementation Phases

GPT or Codex should implement one phase at a time. Each phase must end with tests, documentation updates, and a clean verification report.

## Phase 0 — Project Foundation

### Build

- pnpm monorepo
- Next.js application
- TypeScript strict mode
- Tailwind
- ESLint and Prettier
- Vitest and Playwright
- Docker Compose
- PostgreSQL application and n8n databases
- Environment validation
- Health endpoints
- Pino logger
- Basic CI commands

### Done when

- Application starts locally.
- Docker services are healthy.
- Formatting, linting, type checking, tests, and production build pass.
- No secrets are committed.

---

## Phase 1 — Authentication, Roles, and Core Data

### Build

- Auth.js
- User and role model
- Client
- Service package
- Package provisioning templates
- Package requirement templates
- Onboarding
- Contract
- Invoice
- Payment
- Seed data for a demo marketing agency
- Basic onboarding list and detail pages

### Done when

- Staff can sign in.
- Roles are enforced server-side.
- Demo package configuration can generate expected templates.
- Database migrations and seed are repeatable.

---

## Phase 2 — Sales Handoff and Commercial Gate

### Build

- Sales handoff form
- Handoff validation
- Contract-status update
- Payment recording and verification
- Activation threshold calculation
- Commercial Gate calculation
- Audit events
- Status-transition enforcement
- Commercial dashboard section

### Done when

- Incomplete handoff is blocked.
- Valid handoff enters commercial pending.
- Signed contract plus satisfied activation threshold approves the gate.
- Full invoice payment is not incorrectly required when a deposit is sufficient.
- Duplicate activation cannot occur.

---

## Phase 3 — Automation Event Infrastructure

### Build

- AutomationEvent
- AutomationRun
- NotificationLog
- Outbox-style event creation
- n8n authenticated claim/context/callback endpoints
- HMAC verification
- Idempotency handling
- Shared n8n error workflow
- Example n8n webhook workflow

### Done when

- Application creates a durable event in the same transaction as a business change.
- n8n can process and acknowledge it.
- Duplicate callbacks are safe.
- Failures are visible and retryable.

---

## Phase 4 — Provisioning and Internal Readiness

### Build

- Generate provisioning tasks from package templates
- Sequential provisioning workflow
- Per-task lifecycle
- Retry behavior
- Manual-review path
- PM internal readiness screen
- Welcome-email event after approval
- Transition to `CLIENT_AWAITING_ACTION`

### Done when

- Successfully completed tasks are never repeated.
- Failed tasks are isolated.
- PM cannot approve readiness before required tasks are ready or accepted.
- Welcome email cannot be sent before readiness approval.

---

## Phase 5 — Client Requirements and File Submission

### Build

- Generate client requirements from package templates
- Secure tokenized client page
- Text, URL, and file submission
- MinIO storage
- Submission version history
- PM approval and rejection
- Rejection reason
- Resubmission
- Completeness calculation
- Transition to `CLIENT_REQUIREMENTS_COMPLETE`

### Done when

- Clients see only their onboarding.
- Tokens expire and can be revoked.
- Mandatory requirements block progress until approved.
- Optional requirements do not block progress.
- Rejected submissions remain auditable.

---

## Phase 6 — Kickoff and Delivery Handoff

### Build

- Kickoff record
- Scheduling details
- Invitation notification
- PM completion action
- Outcome notes
- Project-ready transition
- Delivery handoff summary
- Delivery acknowledgment
- Onboarding completion

### Done when

- Kickoff cannot complete before mandatory requirements are approved.
- Project-ready status has a clear timestamp.
- Delivery handoff is auditable.
- Completed onboarding has a terminal state.

---

## Phase 7 — Reminders, Hardening, and Portfolio Documentation

### Build

- Scheduled reminder workflow
- Escalation policy
- Dead-letter handling
- Rate limiting
- Security review
- Full smoke script
- Architecture diagram
- Entity relationship diagram
- Screenshots
- Demo data
- Demo script
- README
- Deployment guide
- Known limitations
- Future enhancements

### Done when

- All quality checks pass.
- The complete happy path can be demonstrated locally.
- Failure and correction paths are documented.
- Repository contains no real credentials or client data.
- Another developer can run the project from the documentation.

---

## 27. Demo Case

Use one consistent fictional scenario.

### Agency

```text
Northstar Growth Agency
```

### Client

```text
Atlas Fitness Studio
```

### Purchased package

```text
Paid Growth Launch
```

### Activation policy

```text
Contract signed
CRM deal marked Closed Won
30% deposit verified
```

### Provisioning templates

1. Create client workspace
2. Create campaign project
3. Create shared asset folder
4. Create internal launch checklist

### Client requirements

Mandatory:

- Brand guidelines
- Advertising account access
- Campaign goals
- Target customer description
- Approved budget
- Existing creative assets

Optional:

- Competitor examples
- Previous campaign reports

### Demo story

1. Sales submits an incomplete handoff.
2. The system blocks progress and notifies Sales.
3. Sales completes the missing information.
4. Contract is signed.
5. A 30% deposit is verified.
6. Commercial Gate approves.
7. Provisioning runs; one task fails once and succeeds on retry.
8. PM approves internal readiness.
9. Client receives one welcome email and secure link.
10. Client submits requirements.
11. PM rejects one asset submission.
12. Client resubmits it.
13. PM approves all mandatory requirements.
14. Kickoff is recorded as completed.
15. Delivery Lead acknowledges the handoff.
16. Onboarding reaches `COMPLETED`.
17. Audit timeline shows every important event.

This scenario demonstrates validation, automation, retry, human approval, client correction, idempotency, and auditability without requiring a large product.

---

## 28. Risks and Trade-offs

### Next.js as frontend and backend

**Why it is appropriate:** One deployable application, shared TypeScript types, simple MVP operations.

**Trade-off:** Background processing and integration orchestration should not run inside request handlers. n8n handles those tasks.

### n8n orchestration

**Why it is appropriate:** Fast integration development and visible workflows.

**Trade-off:** Business rules can become fragmented if placed in Code nodes. Keep authoritative decisions in application services.

### Secure client token instead of client authentication

**Why it is appropriate:** Removes account and password complexity.

**Trade-off:** Token leakage provides temporary access. Use high entropy, expiration, revocation, and narrow permissions.

### Sequential provisioning

**Why it is appropriate:** Easier to debug and demonstrate.

**Trade-off:** Slower than parallel processing. Parallelization is deferred until actual performance requires it.

### Monorepo

**Why it is appropriate:** Shared types, contracts, and configuration.

**Trade-off:** Too many packages can create ceremony. Start with a small number of packages.

### Object storage

**Why it is appropriate:** Correct location for client files.

**Trade-off:** Adds one infrastructure dependency. Keep file upload in Phase 5 rather than the first build phase.

---

## 29. Future Enhancements

Potential future work, not MVP requirements:

- CRM integration such as HubSpot
- E-signature provider
- Payment-provider webhook integration
- Google Drive or SharePoint provisioning
- Slack or Microsoft Teams channel provisioning
- Calendar availability integration
- Client account portal
- Multiple agency organizations
- Configurable SLA policies
- Configurable approval chains
- Parallel provisioning with dependencies
- Malware scanning
- Advanced reporting
- Automatic document summarization
- AI-assisted handoff summaries with mandatory human approval

AI should not approve contracts, payments, client requirements, or onboarding readiness.

---

## 30. Definition of Done

The project is complete when:

### Business behavior

- Every critical state transition is explicit and validated.
- Commercial activation follows the hybrid gate.
- Client requirements separate submission from approval.
- The workflow ends with a completed delivery handoff.
- Important exceptions have clear owners and recovery paths.

### Architecture

- PostgreSQL is the business source of truth.
- Application services own business transitions.
- n8n performs orchestration through authenticated APIs.
- Files are stored outside PostgreSQL.
- Business and n8n databases use separate users.

### Reliability

- External side effects are idempotent.
- Transactions protect multi-record changes.
- Failed automation events are recoverable.
- Completed provisioning tasks are not repeated.
- Audit history is append-only.

### Security

- Internal users are authenticated.
- Roles are enforced server-side.
- Public client links are scoped, expiring, and revocable.
- Secrets are not stored in source control or workflow JSON.
- Public endpoints are rate-limited and validated.

### Quality

- ESLint passes.
- Prettier check passes.
- TypeScript check passes.
- Unit tests pass.
- Integration tests pass.
- Playwright critical paths pass.
- Prisma schema and migrations validate.
- Production build passes.
- Docker Compose services are healthy.
- Secret scan finds no real credentials.
- Documentation matches implementation.

### Portfolio quality

- README explains the business problem before the technology.
- Architecture and workflow diagrams are included.
- Screenshots show the dashboard and client form.
- Demo script proves the happy path and at least two failure paths.
- Known limitations are stated honestly.
- The repository can be run by another developer.

---

## 31. Rules for GPT or Codex During Implementation

When using an AI coding assistant, provide this blueprint and enforce these rules:

1. Implement only the current phase.
2. Do not silently change business rules or statuses.
3. State assumptions before coding.
4. List files to create or modify.
5. Keep domain logic outside UI components and n8n Code nodes.
6. Use strict TypeScript and Zod at trust boundaries.
7. Use Prisma migrations rather than manual schema drift.
8. Add tests for every business rule implemented.
9. Preserve idempotency and audit requirements.
10. Do not add infrastructure not required by the current phase.
11. Do not use placeholders that falsely appear production-ready.
12. Never commit secrets, real emails, tokens, or credentials.
13. Update relevant documentation in the same phase.
14. Run all relevant verification commands.
15. Report:
    - What was implemented
    - Architectural decisions
    - Verification results
    - Known limitations
    - Manual steps still required
16. Stop after the requested phase and wait for the next implementation instruction.

---

## 32. Master Implementation Prompt

```text
You are the senior software engineer responsible for implementing the attached
Client Onboarding Automation Platform blueprint.

The project is a production-minded MVP portfolio case study for a marketing
agency. It must remain understandable and maintainable. Do not turn it into a
large SaaS platform.

Non-negotiable architecture rules:

1. PostgreSQL is the source of business truth.
2. The Next.js application layer owns business-state transitions.
3. n8n handles orchestration and external side effects but must not directly
   overwrite core onboarding states.
4. Every important transition must validate current state, authorization, and
   business rules.
5. Important multi-record changes must be transactional.
6. External side effects must be idempotent.
7. Human approval remains mandatory for payment review, internal readiness,
   client requirements, and delivery handoff.
8. Do not put authoritative business logic in React components, Route Handlers,
   Server Actions, Prisma repositories, or n8n Code nodes.
9. Do not introduce microservices, queues, Kubernetes, or unnecessary abstractions.
10. Do not commit credentials or real client information.

For the requested phase:

- First inspect the existing repository.
- Compare it with the blueprint.
- State assumptions and the implementation plan.
- List files to create or modify.
- Implement only that phase.
- Add unit, integration, and end-to-end tests where applicable.
- Update documentation.
- Run formatting, linting, type checking, tests, Prisma validation, production
  build, Docker validation, health checks, and secret scanning when applicable.
- Fix failures before reporting completion.
- Provide an exact verification report and identify anything not executed.
- Do not claim an external integration was tested unless a real execution occurred.
- Stop after completing the requested phase.
```

---

## 33. Recommended First Instruction to GPT

```text
Read the complete project blueprint and implement Phase 0 only.

Before changing files:

1. Summarize the architecture in plain English.
2. Identify any contradiction or missing prerequisite in Phase 0.
3. Propose the exact repository structure and commands.
4. Keep the design minimal and compatible with later phases.

Then implement Phase 0, add the required tests and documentation, run every
available verification step, fix failures, and provide a final verification
report. Do not begin Phase 1.
```
