-- Protect the immutable welcome-email snapshot and confirmed delivery identity.

CREATE OR REPLACE FUNCTION protect_notification_delivery_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."onboardingId" IS DISTINCT FROM OLD."onboardingId"
    OR NEW."notificationType" IS DISTINCT FROM OLD."notificationType"
    OR NEW."recipient" IS DISTINCT FROM OLD."recipient"
    OR NEW."channel" IS DISTINCT FROM OLD."channel"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."senderKey" IS DISTINCT FROM OLD."senderKey"
    OR NEW."senderName" IS DISTINCT FROM OLD."senderName"
    OR NEW."senderAddress" IS DISTINCT FROM OLD."senderAddress"
    OR NEW."subject" IS DISTINCT FROM OLD."subject"
    OR NEW."textContent" IS DISTINCT FROM OLD."textContent"
    OR NEW."htmlContent" IS DISTINCT FROM OLD."htmlContent"
    OR NEW."templateVersion" IS DISTINCT FROM OLD."templateVersion"
    OR NEW."messageKey" IS DISTINCT FROM OLD."messageKey"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Notification delivery snapshot fields are immutable';
  END IF;

  IF OLD."status" = 'SENT'
    AND (
      NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."providerReference" IS DISTINCT FROM OLD."providerReference"
      OR NEW."sentAt" IS DISTINCT FROM OLD."sentAt"
    )
  THEN
    RAISE EXCEPTION 'Confirmed notification delivery is immutable';
  END IF;

  IF NEW."attemptCount" < OLD."attemptCount" THEN
    RAISE EXCEPTION 'Notification delivery attempt count cannot decrease';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "NotificationLog_delivery_snapshot_protection"
BEFORE UPDATE ON "NotificationLog"
FOR EACH ROW EXECUTE FUNCTION protect_notification_delivery_snapshot();
