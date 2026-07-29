\pset pager off

SELECT
  r."id",
  r."n8nExecutionId" AS "n8nExecutionId",
  e."eventType",
  e."aggregateId" AS "onboardingId",
  r."status"
FROM "AutomationRun" r
JOIN "AutomationEvent" e ON e."id" = r."automationEventId"
WHERE e."eventType" = 'CLIENT_ACCESS_EMAIL_REQUESTED'
ORDER BY r."createdAt" DESC
LIMIT 12;

\connect n8n_internal

SELECT
  id,
  status,
  to_jsonb(execution_entity)->>'workflowId' AS workflow_id,
  to_jsonb(execution_entity)->>'startedAt' AS started_at,
  to_jsonb(execution_entity)->>'stoppedAt' AS stopped_at
FROM execution_entity
WHERE to_jsonb(execution_entity)->>'workflowId' = 'phase5-client-access-email'
ORDER BY id DESC
LIMIT 12;

SELECT count(*) AS bearer_markers
FROM execution_data d
JOIN execution_entity e ON e.id::text = to_jsonb(d)->>'executionId'
WHERE to_jsonb(e)->>'workflowId' = 'phase5-client-access-email'
  AND d.data LIKE '%#token=%';
