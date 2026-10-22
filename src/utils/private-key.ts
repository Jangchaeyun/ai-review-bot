export function normalizePrivateKey(value: string): string {
  return value.trim().replaceAll("\\r\\n", "\n").replaceAll("\\n", "\n");
}

export function isPrivateKeyPem(value: string): boolean {
  return value.includes("-----BEGIN PRIVATE KEY-----") || value.includes("-----BEGIN RSA PRIVATE KEY-----");
}
