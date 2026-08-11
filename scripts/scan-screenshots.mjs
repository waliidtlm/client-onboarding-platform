import { readFileSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const screenshotDirectory = path.join(repositoryRoot, "docs", "screenshots");
const expected = new Map([
  ["dashboard.jpg", { width: 1440, height: 1000 }],
  ["onboarding-completed.jpg", { width: 1440, height: 1000 }],
  ["automation-recovery.jpg", { width: 1440, height: 1000 }],
]);
const forbiddenAscii = [
  /bearer\s/i,
  /token=/i,
  /authorization:/i,
  /c:\\users\\/i,
  /waliid/i,
  /-----begin [a-z ]*private key-----/i,
];

function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null;
    offset += segmentLength + 2;
  }
  return null;
}

for (const [filename, expectedDimensions] of expected) {
  const bytes = readFileSync(path.join(screenshotDirectory, filename));
  const dimensions = jpegDimensions(bytes);
  if (!dimensions) throw new Error(`${filename} is not a supported JPEG`);
  const { width, height } = dimensions;
  if (width !== expectedDimensions.width || height !== expectedDimensions.height) {
    throw new Error(
      `${filename} must be ${expectedDimensions.width}x${expectedDimensions.height} (found ${width}x${height})`,
    );
  }
  const embeddedAscii = bytes.toString("latin1");
  if (forbiddenAscii.some((pattern) => pattern.test(embeddedAscii))) {
    throw new Error(`${filename} contains forbidden embedded credential or local-path text`);
  }
}

process.stdout.write(`Screenshot metadata/redaction scan passed (${expected.size} JPEG files)\n`);
