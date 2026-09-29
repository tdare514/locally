export function compareVersions(a: string, b: string): number;
export function assertPublishable(next: string, current: string | null): void;
export function buildEnvelope(
  manifestObj: unknown,
  privateKeyPem: string,
): { manifest: string; signature: string };
export function parseEnvFile(text: string): Record<string, string>;
