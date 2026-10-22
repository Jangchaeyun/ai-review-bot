/**
 * .env에 한 줄로 넣은 PEM의 \n 표기를 실제 줄바꿈으로 되돌린다.
 */
export function normalizePrivateKey(value: string): string {
  return value.trim().replaceAll("\\r\\n", "\n").replaceAll("\\n", "\n");
}

/** PKCS#8과 PKCS#1 헤더를 모두 허용한다. GitHub App 키는 둘 중 하나로 내려온다. */
export function isPrivateKeyPem(value: string): boolean {
  return value.includes("-----BEGIN PRIVATE KEY-----") || value.includes("-----BEGIN RSA PRIVATE KEY-----");
}
