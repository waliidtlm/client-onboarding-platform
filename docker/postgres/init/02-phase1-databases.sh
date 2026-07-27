#!/bin/sh
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${APP_DB_NAME:?APP_DB_NAME is required}"
: "${APP_DB_USER:?APP_DB_USER is required}"
: "${MIGRATION_DB_USER:?MIGRATION_DB_USER is required}"
: "${MIGRATION_DB_PASSWORD:?MIGRATION_DB_PASSWORD is required}"
: "${TEST_DB_NAME:?TEST_DB_NAME is required}"
: "${TEST_DB_USER:?TEST_DB_USER is required}"
: "${TEST_DB_PASSWORD:?TEST_DB_PASSWORD is required}"
: "${SHADOW_DB_NAME:?SHADOW_DB_NAME is required}"
: "${N8N_DB_NAME:?N8N_DB_NAME is required}"
: "${N8N_DB_USER:?N8N_DB_USER is required}"

validate_identifier() {
  value="$1"
  label="$2"

  if ! printf '%s' "$value" | grep -Eq '^[a-z_][a-z0-9_]*$'; then
    printf 'Invalid PostgreSQL identifier for %s\n' "$label" >&2
    exit 1
  fi
}

for pair in \
  "$APP_DB_NAME APP_DB_NAME" \
  "$APP_DB_USER APP_DB_USER" \
  "$MIGRATION_DB_USER MIGRATION_DB_USER" \
  "$TEST_DB_NAME TEST_DB_NAME" \
  "$TEST_DB_USER TEST_DB_USER" \
  "$SHADOW_DB_NAME SHADOW_DB_NAME" \
  "$N8N_DB_NAME N8N_DB_NAME" \
  "$N8N_DB_USER N8N_DB_USER"
do
  set -- $pair
  validate_identifier "$1" "$2"
done

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=migration_user="$MIGRATION_DB_USER" \
  --set=migration_password="$MIGRATION_DB_PASSWORD" \
  --set=test_user="$TEST_DB_USER" \
  --set=test_password="$TEST_DB_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
  :'migration_user',
  :'migration_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migration_user') \gexec

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION',
  :'test_user',
  :'test_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'test_user') \gexec

ALTER ROLE :"migration_user" WITH LOGIN PASSWORD :'migration_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
ALTER ROLE :"test_user" WITH LOGIN PASSWORD :'test_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
SQL

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=test_db="$TEST_DB_NAME" \
  --set=shadow_db="$SHADOW_DB_NAME" \
  --set=migration_user="$MIGRATION_DB_USER" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'test_db', :'migration_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'test_db') \gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'shadow_db', :'migration_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'shadow_db') \gexec
SQL

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=app_db="$APP_DB_NAME" \
  --set=app_user="$APP_DB_USER" \
  --set=migration_user="$MIGRATION_DB_USER" \
  --set=test_db="$TEST_DB_NAME" \
  --set=test_user="$TEST_DB_USER" \
  --set=shadow_db="$SHADOW_DB_NAME" \
  --set=n8n_db="$N8N_DB_NAME" \
  --set=n8n_user="$N8N_DB_USER" <<'SQL'
ALTER DATABASE :"app_db" OWNER TO :"migration_user";
ALTER DATABASE :"test_db" OWNER TO :"migration_user";
ALTER DATABASE :"shadow_db" OWNER TO :"migration_user";

REVOKE CONNECT ON DATABASE :"app_db" FROM PUBLIC, :"test_user", :"n8n_user";
REVOKE CONNECT ON DATABASE :"test_db" FROM PUBLIC, :"app_user", :"n8n_user";
REVOKE CONNECT ON DATABASE :"shadow_db" FROM PUBLIC, :"app_user", :"test_user", :"n8n_user";
REVOKE CONNECT ON DATABASE :"n8n_db" FROM :"app_user", :"migration_user", :"test_user";

GRANT CONNECT ON DATABASE :"app_db" TO :"app_user", :"migration_user";
GRANT CONNECT ON DATABASE :"test_db" TO :"test_user", :"migration_user";
GRANT CONNECT ON DATABASE :"shadow_db" TO :"migration_user";
SQL

configure_business_database() {
  database_name="$1"
  runtime_user="$2"

  psql \
    --username "$POSTGRES_USER" \
    --dbname "$database_name" \
    --set=ON_ERROR_STOP=1 \
    --set=migration_user="$MIGRATION_DB_USER" \
    --set=runtime_user="$runtime_user" <<'SQL'
ALTER SCHEMA public OWNER TO :"migration_user";
REVOKE CREATE ON SCHEMA public FROM PUBLIC, :"runtime_user";
GRANT USAGE ON SCHEMA public TO :"runtime_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"runtime_user";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"runtime_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_user";

SELECT format(
  'REVOKE UPDATE, DELETE ON TABLE public."AuditEvent" FROM %I',
  :'runtime_user'
)
WHERE to_regclass('public."AuditEvent"') IS NOT NULL \gexec
SQL
}

configure_business_database "$APP_DB_NAME" "$APP_DB_USER"
configure_business_database "$TEST_DB_NAME" "$TEST_DB_USER"

printf 'Phase 1 PostgreSQL roles and databases are ready\n'
