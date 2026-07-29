#!/bin/sh
set -eu

mc alias set local "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc ready local
mc mb --ignore-existing "local/$MINIO_BUCKET"
mc anonymous set none "local/$MINIO_BUCKET"

cat >/tmp/onboarding-app-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::$MINIO_BUCKET"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::$MINIO_BUCKET/temporary/*",
        "arn:aws:s3:::$MINIO_BUCKET/final/*"
      ]
    }
  ]
}
EOF

mc admin user add local "$MINIO_APP_ACCESS_KEY" "$MINIO_APP_SECRET_KEY" || true
mc admin policy create local onboarding-app /tmp/onboarding-app-policy.json || true
mc admin policy attach local onboarding-app --user "$MINIO_APP_ACCESS_KEY"

mc ilm rule add --expire-days 1 --prefix "temporary/" "local/$MINIO_BUCKET" || true
