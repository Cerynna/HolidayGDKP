// Vérification de la signature Ed25519 des requêtes Discord.
import nacl from 'tweetnacl';

export function verifyRequest(
  rawBody: Buffer,
  signature: string | undefined,
  timestamp: string | undefined,
  publicKey: string | undefined,
): boolean {
  if (!signature || !timestamp || !publicKey) return false;
  try {
    return nacl.sign.detached.verify(
      Buffer.concat([Buffer.from(timestamp), rawBody]),
      Buffer.from(signature, 'hex'),
      Buffer.from(publicKey, 'hex'),
    );
  } catch {
    return false;
  }
}
