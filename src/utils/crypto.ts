import * as crypto from 'node:crypto';

/**
 * Calcule un hash HMAC-SHA256 sécurisé
 */
export function computeHmacSha256(data: string | Buffer, secret: string, encoding: 'hex' | 'base64' = 'hex'): string {
  return crypto.createHmac('sha256', secret).update(data).digest(encoding);
}

/**
 * Calcule un hash HMAC-SHA512
 */
export function computeHmacSha512(data: string | Buffer, secret: string, encoding: 'hex' | 'base64' = 'hex'): string {
  return crypto.createHmac('sha512', secret).update(data).digest(encoding);
}

/**
 * Comparaison à temps constant contre les attaques temporelles (timing attacks)
 */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
