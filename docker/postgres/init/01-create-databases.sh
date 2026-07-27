#!/bin/sh
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${APP_DB_NAME:?APP_DB_NAME is required}"
: "${APP_DB_USER:?APP_DB_USER is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
: "${N8N_DB_NAME:?N8N_DB_NAME is required}"
: "${N8N_DB_USER:?N8N_DB_USER is required}"
: "${N8N_DB_PASSWORD:?N8N_DB_PASSWORD is required}"

validate_identifier() {
  value="$1"
  label="$2"

  if ! printf '%s' "$value" | grep -Eq '^[a-z_][a-z0-9_]*$'; then
    printf 'Invalid PostgreSQL identifier for %s\n' "$label" >&2
    exit 1
  fi
}

validate_identifier "$APP_DB_NAME" "APP_DB_NAME"
validate_identifier "$APP_DB_USER" "APP_DB_USER"
validate_identifier "$N8N_DB_NAME" "N8N_DB_NAME"
validate_identifier "$N8N_DB_USER" "N8N_DB_USER"

if [ "$APP_DB_NAME" = "$N8N_DB_NAME" ] || [ "$APP_DB_USER" = "$N8N_DB_USER" ]; then
  printf 'Application and n8n database names and users must be different\n' >&2
  exit 1
fi

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=app_db="$APP_DB_NAME" \
  --set=app_user="$APP_DB_USER" \
  --set=app_password="$APP_DB_PASSWORD" \
  --set=n8n_db="$N8N_DB_NAME" \
  --set=n8n_user="$N8N_DB_USER" \
  --set=n8n_password="$N8N_DB_PASSWORD" <<'SQL'
CREATE ROLE :"app_user"
  LOGIN
  PASSWORD :'app_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION;

CREATE ROLE :"n8n_user"
  LOGIN
  PASSWORD :'n8n_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION;

CREATE DATABASE :"app_db" OWNER :"app_user";
CREATE DATABASE :"n8n_db" OWNER :"n8n_user";

REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
REVOKE CONNECT ON DATABASE :"app_db" FROM PUBLIC;
REVOKE CONNECT ON DATABASE :"n8n_db" FROM PUBLIC;

REVOKE ALL PRIVILEGES ON DATABASE :"app_db" FROM :"n8n_user";
REVOKE ALL PRIVILEGES ON DATABASE :"n8n_db" FROM :"app_user";

GRANT CONNECT ON DATABASE :"app_db" TO :"app_user";
GRANT CONNECT ON DATABASE :"n8n_db" TO :"n8n_user";
SQL
