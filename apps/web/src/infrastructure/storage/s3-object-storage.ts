import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { DOWNLOAD_URL_SECONDS, UPLOAD_URL_SECONDS } from "@/domain/requirements/file-policy";
import { getServerEnvironment } from "@/lib/env";

function client(endpoint: string): S3Client {
  const environment = getServerEnvironment();
  return new S3Client({
    endpoint,
    region: environment.OBJECT_STORAGE_REGION,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: environment.OBJECT_STORAGE_ACCESS_KEY,
      secretAccessKey: environment.OBJECT_STORAGE_SECRET_KEY,
    },
  });
}

let internalClient: S3Client | undefined;
let browserSigningClient: S3Client | undefined;

function internal(): S3Client {
  internalClient ??= client(getServerEnvironment().OBJECT_STORAGE_INTERNAL_ENDPOINT);
  return internalClient;
}

function browserSigner(): S3Client {
  browserSigningClient ??= client(getServerEnvironment().OBJECT_STORAGE_BROWSER_ENDPOINT);
  return browserSigningClient;
}

function bucket(): string {
  return getServerEnvironment().OBJECT_STORAGE_BUCKET;
}

export async function checkObjectStorageConnection(): Promise<void> {
  await internal().send(new HeadBucketCommand({ Bucket: bucket() }));
}

export async function presignUpload(input: {
  storageKey: string;
  contentType: string;
  checksum: string;
}): Promise<Readonly<{ url: string; requiredHeaders: Readonly<Record<string, string>> }>> {
  const requiredHeaders = {
    "content-type": input.contentType,
  };
  const url = await getSignedUrl(
    browserSigner(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: input.storageKey,
      ContentType: input.contentType,
      Metadata: { sha256: input.checksum },
    }),
    { expiresIn: UPLOAD_URL_SECONDS },
  );
  return { url, requiredHeaders };
}

export async function headStoredObject(storageKey: string) {
  return internal().send(new HeadObjectCommand({ Bucket: bucket(), Key: storageKey }));
}

export async function readStoredObject(storageKey: string): Promise<Buffer> {
  const response = await internal().send(
    new GetObjectCommand({ Bucket: bucket(), Key: storageKey }),
  );
  if (!response.Body) throw new Error("STORAGE_OBJECT_BODY_MISSING");
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function copyStoredObject(sourceKey: string, destinationKey: string): Promise<void> {
  await internal().send(
    new CopyObjectCommand({
      Bucket: bucket(),
      Key: destinationKey,
      CopySource: `${bucket()}/${encodeURIComponent(sourceKey).replaceAll("%2F", "/")}`,
      MetadataDirective: "COPY",
    }),
  );
}

export async function deleteStoredObject(storageKey: string): Promise<void> {
  await internal().send(new DeleteObjectCommand({ Bucket: bucket(), Key: storageKey }));
}

export async function presignDownload(
  storageKey: string,
  contentDisposition: string,
): Promise<string> {
  return getSignedUrl(
    browserSigner(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: storageKey,
      ResponseContentDisposition: contentDisposition,
      ResponseContentType: "application/octet-stream",
    }),
    { expiresIn: DOWNLOAD_URL_SECONDS },
  );
}

export async function listTemporaryObjects(
  prefix: string,
  continuationToken?: string,
): Promise<
  Readonly<{
    objects: readonly Readonly<{ key: string; lastModified: Date | null }>[];
    continuationToken?: string;
  }>
> {
  const response = await internal().send(
    new ListObjectsV2Command({
      Bucket: bucket(),
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 100,
    }),
  );
  return {
    objects: (response.Contents ?? [])
      .filter((object): object is typeof object & { Key: string } => Boolean(object.Key))
      .map((object) => ({ key: object.Key, lastModified: object.LastModified ?? null })),
    ...(response.NextContinuationToken
      ? { continuationToken: response.NextContinuationToken }
      : {}),
  };
}
