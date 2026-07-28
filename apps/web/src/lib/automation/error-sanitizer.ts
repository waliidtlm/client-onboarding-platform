const sensitivePatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b(?:token|secret|password|authorization)\s*[:=]\s*\S+/gi,
];

export function sanitizeAutomationError(message: string): string {
  let sanitized = message.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  for (const pattern of sensitivePatterns) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return sanitized.replace(/\s+/g, " ").trim().slice(0, 1000);
}
