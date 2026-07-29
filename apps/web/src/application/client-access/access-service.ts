import { randomUUID } from "node:crypto";

import {
  AuditActorType,
  NotificationChannel,
  NotificationStatus,
  OnboardingStatus,
  Prisma,
  Role,
  type PrismaClient,
} from "@/generated/prisma/client";
import { appendAuditEvent } from "@/application/commercial/audit";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
} from "@/application/commercial/service-support";
import {
  manageClientAccessSchema,
  revokeClientAccessSchema,
} from "@/application/client-access/contracts";
import { createCapabilityToken } from "@/domain/client-access/token";
import {
  clientAccessEmailKey,
  clientAccessMessageKey,
  requestFingerprint,
  requirementGenerationKey,
} from "@/domain/requirements/idempotency";
import type { Result } from "@/domain/errors";
import { prisma } from "@/lib/database";
import { activeClientAccessSigningKey } from "@/lib/client-access/keys";
import { getServerEnvironment } from "@/lib/env";

const ACCESS_EMAIL_TEMPLATE_VERSION = 1;
const ACCESS_LINK_PLACEHOLDER = "{{CLIENT_ACCESS_LINK}}";

export type ClientAccessManagementResult = Readonly<{
  onboardingId: string;
  clientAccessTokenId: string;
  notificationId: string;
  eventId: string;
  expiresAt: string;
  generatedRequirementCount: number;
  idempotent: boolean;
}>;

async function authorize(tx: Prisma.TransactionClient, actorId: string, onboardingId: string) {
  const actor = await requireActor(tx, actorId, [Role.ADMIN, Role.PROJECT_MANAGER]);
  const onboarding = await tx.onboarding.findUnique({
    where: { id: onboardingId },
    include: { client: true, projectManager: true },
  });
  if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");
  if (
    actor.role === Role.PROJECT_MANAGER &&
    (onboarding.projectManagerId !== actor.id || !onboarding.projectManager?.isActive)
  ) {
    reject("ACCESS_DENIED", "Only the assigned active Project Manager may manage client access.");
  }
  return { actor, onboarding };
}

async function replayExistingIssuance(
  tx: Prisma.TransactionClient,
  issuanceKey: string,
  fingerprint: string,
): Promise<ClientAccessManagementResult | null> {
  const token = await tx.clientAccessToken.findUnique({
    where: { issuanceKey },
    include: { notification: true },
  });
  if (!token) return null;
  if (token.requestFingerprint !== fingerprint || !token.notification) {
    reject("CLIENT_ACCESS_CONFLICT", "The issuance key was already used for another request.");
  }
  const event = await tx.automationEvent.findUnique({
    where: { deduplicationKey: clientAccessEmailKey(token.id) },
  });
  if (!event) reject("CONFIGURATION_ERROR", "The access-delivery ledger is incomplete.");
  const requirementCount = await tx.clientRequirement.count({
    where: { onboardingId: token.onboardingId },
  });
  return {
    onboardingId: token.onboardingId,
    clientAccessTokenId: token.id,
    notificationId: token.notification.id,
    eventId: event.id,
    expiresAt: token.expiresAt.toISOString(),
    generatedRequirementCount: requirementCount,
    idempotent: true,
  };
}

async function generateRequirements(
  tx: Prisma.TransactionClient,
  onboarding: {
    id: string;
    servicePackageId: string | null;
    requirementsGeneratedAt: Date | null;
    requirementsGenerationKey: string | null;
  },
  correlationId: string,
  actorId: string,
  now: Date,
) {
  if (onboarding.requirementsGeneratedAt) {
    const requirements = await tx.clientRequirement.findMany({
      where: { onboardingId: onboarding.id },
      orderBy: { sequence: "asc" },
    });
    if (
      requirements.length < 1 ||
      !requirements.some((requirement) => requirement.isRequired) ||
      onboarding.requirementsGenerationKey !== requirementGenerationKey(onboarding.id)
    ) {
      reject("REQUIREMENT_CONFIGURATION_ERROR", "The generated requirement ledger is invalid.");
    }
    return { requirements, generated: false };
  }
  if (!onboarding.servicePackageId) {
    reject("MISSING_BUSINESS_CONFIGURATION", "The purchased package is missing.");
  }
  const templates = await tx.packageRequirementTemplate.findMany({
    where: { servicePackageId: onboarding.servicePackageId },
    orderBy: { sequence: "asc" },
  });
  if (templates.length < 1 || !templates.some((template) => template.isRequired)) {
    reject(
      "REQUIREMENT_CONFIGURATION_ERROR",
      "At least one mandatory client requirement is required.",
    );
  }
  if (
    new Set(templates.map((template) => template.id)).size !== templates.length ||
    new Set(templates.map((template) => template.sequence)).size !== templates.length ||
    templates.some((template) => template.sequence <= 0 || template.dueOffsetDays < 0)
  ) {
    reject("REQUIREMENT_CONFIGURATION_ERROR", "Package requirement templates are invalid.");
  }
  await tx.clientRequirement.createMany({
    data: templates.map((template) => ({
      onboardingId: onboarding.id,
      templateId: template.id,
      name: template.name,
      description: template.description,
      inputType: template.inputType,
      isRequired: template.isRequired,
      sequence: template.sequence,
      dueOffsetDays: template.dueOffsetDays,
      dueAt: null,
    })),
  });
  await tx.onboarding.update({
    where: { id: onboarding.id },
    data: {
      requirementsGenerationKey: requirementGenerationKey(onboarding.id),
      requirementsGeneratedAt: now,
    },
  });
  await appendAuditEvent(tx, {
    onboardingId: onboarding.id,
    actorType: AuditActorType.STAFF,
    actorId,
    action: "CLIENT_REQUIREMENTS_GENERATED",
    entityType: "ONBOARDING",
    entityId: onboarding.id,
    newValue: {
      requirementCount: templates.length,
      mandatoryCount: templates.filter((template) => template.isRequired).length,
    },
    metadata: { generationVersion: 1 },
    correlationId,
  });
  return {
    requirements: await tx.clientRequirement.findMany({
      where: { onboardingId: onboarding.id },
      orderBy: { sequence: "asc" },
    }),
    generated: true,
  };
}

export async function manageClientAccess(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<ClientAccessManagementResult>> {
  return executeService(async () => {
    const input = parseInput(manageClientAccessSchema.safeParse(rawInput));
    const fingerprint = requestFingerprint({
      onboardingId: input.onboardingId,
      expectedVersion: input.expectedVersion,
      operation: input.operation,
    });
    const environment = getServerEnvironment();
    const activeKey = activeClientAccessSigningKey();
    return database.$transaction(
      async (tx) => {
        const replay = await replayExistingIssuance(tx, input.issuanceKey, fingerprint);
        if (replay) return replay;
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Onboarding"
          WHERE "id" = ${input.onboardingId}::uuid
          FOR UPDATE
        `);
        const { actor, onboarding } = await authorize(tx, input.actorId, input.onboardingId);
        if (
          onboarding.status !== OnboardingStatus.CLIENT_AWAITING_ACTION ||
          !onboarding.welcomeEmailSentAt ||
          onboarding.cancelledAt
        ) {
          reject("INVALID_TRANSITION", "The onboarding is not eligible for secure client access.");
        }
        if (onboarding.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and try again.");
        }
        const generation = await generateRequirements(
          tx,
          onboarding,
          input.correlationId,
          actor.id,
          new Date(),
        );
        const [activeToken, latestToken] = await Promise.all([
          tx.clientAccessToken.findFirst({
            where: { onboardingId: onboarding.id, revokedAt: null },
            orderBy: { issueSequence: "desc" },
            include: {
              notification: {
                select: { status: true },
              },
            },
          }),
          tx.clientAccessToken.findFirst({
            where: { onboardingId: onboarding.id },
            orderBy: { issueSequence: "desc" },
            select: { issueSequence: true },
          }),
        ]);
        if (input.operation === "ISSUE" && activeToken) {
          reject("CLIENT_ACCESS_CONFLICT", "Secure client access has already been issued.");
        }
        if (input.operation === "REISSUE" && !activeToken) {
          reject("CLIENT_ACCESS_CONFLICT", "There is no active client access to replace.");
        }
        if (
          input.operation === "REISSUE" &&
          (activeToken?.notification?.status === NotificationStatus.SENDING ||
            activeToken?.notification?.status === NotificationStatus.DELIVERY_UNCERTAIN)
        ) {
          reject(
            "EMAIL_DELIVERY_CONFLICT",
            "Resolve the current access-email delivery before reissuing secure access.",
          );
        }
        const now = new Date();
        const tokenId = randomUUID();
        const issueSequence = (latestToken?.issueSequence ?? 0) + 1;
        const expiresAt = new Date(
          now.getTime() + environment.CLIENT_ACCESS_TOKEN_DAYS * 24 * 60 * 60 * 1_000,
        );
        const capability = createCapabilityToken({
          tokenId,
          expiresAt,
          signingKeyVersion: activeKey.version,
          signingKey: activeKey.key,
        });
        if (activeToken) {
          await tx.clientAccessToken.update({
            where: { id: activeToken.id },
            data: {
              revokedAt: now,
              revocationReason: "Replaced by an explicit staff reissue.",
              replacedById: tokenId,
            },
          });
          await appendAuditEvent(tx, {
            onboardingId: onboarding.id,
            actorType: AuditActorType.STAFF,
            actorId: actor.id,
            action: "CLIENT_ACCESS_REVOKED",
            entityType: "CLIENT_ACCESS_TOKEN",
            entityId: activeToken.id,
            previousValue: { active: true },
            newValue: { active: false, reasonCode: "REISSUED" },
            correlationId: input.correlationId,
          });
        }
        const token = await tx.clientAccessToken.create({
          data: {
            id: tokenId,
            onboardingId: onboarding.id,
            tokenHash: capability.tokenHash,
            tokenNonce: capability.tokenNonce,
            tokenVersion: capability.tokenVersion,
            signingKeyVersion: capability.signingKeyVersion,
            issueSequence,
            issuanceKey: input.issuanceKey,
            requestFingerprint: fingerprint,
            expiresAt,
          },
        });
        const accessLinkPlaceholder = `${environment.CLIENT_ACCESS_PUBLIC_BASE_URL}#token={token}`;
        const textContent = [
          `Hello ${onboarding.client?.contactName ?? "client"},`,
          "",
          `${environment.AGENCY_NAME} has prepared the onboarding requirements for ${onboarding.client?.companyName}.`,
          "",
          `Secure access: ${ACCESS_LINK_PLACEHOLDER}`,
          "",
          `This link expires on ${expiresAt.toISOString()}.`,
          `Support: ${environment.CLIENT_SUPPORT_CONTACT}`,
        ].join("\n");
        const notification = await tx.notificationLog.create({
          data: {
            onboardingId: onboarding.id,
            clientAccessTokenId: token.id,
            notificationType: "CLIENT_ACCESS_EMAIL",
            recipient: onboarding.client!.contactEmail,
            channel: NotificationChannel.EMAIL,
            status: NotificationStatus.PENDING,
            idempotencyKey: clientAccessEmailKey(token.id),
            senderKey: "NORTHSTAR_CLIENT_ACCESS_V1",
            senderName: environment.AGENCY_NAME,
            senderAddress: environment.CLIENT_SUPPORT_CONTACT,
            subject: `Secure onboarding access from ${environment.AGENCY_NAME}`,
            textContent,
            htmlContent: null,
            templateVersion: ACCESS_EMAIL_TEMPLATE_VERSION,
            messageKey: clientAccessMessageKey(token.id),
            clientCompanySnapshot: onboarding.client!.companyName,
            agencyNameSnapshot: environment.AGENCY_NAME,
            supportContactSnapshot: environment.CLIENT_SUPPORT_CONTACT,
            publicBaseUrlSnapshot: environment.CLIENT_ACCESS_PUBLIC_BASE_URL,
            fragmentFormatSnapshot: "#token={token}",
            tokenExpiresAtSnapshot: token.expiresAt,
            tokenSigningKeyVersionSnapshot: token.signingKeyVersion,
          },
        });
        const event = await tx.automationEvent.create({
          data: {
            eventType: "CLIENT_ACCESS_EMAIL_REQUESTED",
            aggregateType: "ONBOARDING",
            aggregateId: onboarding.id,
            payload: { notificationId: notification.id },
            schemaVersion: 1,
            maxAttempts: environment.AUTOMATION_MAX_ATTEMPTS,
            availableAt: now,
            occurredAt: now,
            correlationId: input.correlationId,
            deduplicationKey: clientAccessEmailKey(token.id),
          },
        });
        await tx.onboarding.update({
          where: { id: onboarding.id },
          data: { version: { increment: 1 } },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: actor.id,
          action: input.operation === "ISSUE" ? "CLIENT_ACCESS_ISSUED" : "CLIENT_ACCESS_REISSUED",
          entityType: "CLIENT_ACCESS_TOKEN",
          entityId: token.id,
          newValue: {
            issueSequence,
            expiresAt: expiresAt.toISOString(),
          },
          metadata: {
            notificationId: notification.id,
            eventId: event.id,
            accessLinkFormat: accessLinkPlaceholder,
          },
          correlationId: input.correlationId,
        });
        return {
          onboardingId: onboarding.id,
          clientAccessTokenId: token.id,
          notificationId: notification.id,
          eventId: event.id,
          expiresAt: expiresAt.toISOString(),
          generatedRequirementCount: generation.requirements.length,
          idempotent: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

export async function revokeClientAccess(rawInput: unknown, database: PrismaClient = prisma) {
  return executeService(async () => {
    const input = parseInput(revokeClientAccessSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Onboarding"
          WHERE "id" = ${input.onboardingId}::uuid
          FOR UPDATE
        `);
        const { actor, onboarding } = await authorize(tx, input.actorId, input.onboardingId);
        if (onboarding.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and try again.");
        }
        const active = await tx.clientAccessToken.findMany({
          where: { onboardingId: onboarding.id, revokedAt: null },
        });
        if (active.length === 0)
          return { onboardingId: onboarding.id, revoked: 0, idempotent: true };
        const now = new Date();
        for (const token of active) {
          await tx.clientAccessToken.update({
            where: { id: token.id },
            data: { revokedAt: now, revocationReason: input.reason },
          });
          await appendAuditEvent(tx, {
            onboardingId: onboarding.id,
            actorType: AuditActorType.STAFF,
            actorId: actor.id,
            action: "CLIENT_ACCESS_REVOKED",
            entityType: "CLIENT_ACCESS_TOKEN",
            entityId: token.id,
            previousValue: { active: true },
            newValue: { active: false },
            metadata: { reasonProvided: true },
            correlationId: input.correlationId,
          });
        }
        await tx.onboarding.update({
          where: { id: onboarding.id },
          data: { version: { increment: 1 } },
        });
        return { onboardingId: onboarding.id, revoked: active.length, idempotent: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}
