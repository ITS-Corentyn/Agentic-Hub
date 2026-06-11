import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from './config.js';

// Clé dérivée du secret d'environnement (AH_SECRET_KEY). En production, ce secret
// est OBLIGATOIRE et son absence empêche le démarrage (cf. assertSecretsConfigured
// dans server.ts). En développement uniquement, on tolère un repli faible pour ne
// pas bloquer le local.
const KEY = scryptSync(
  config.secretKey || config.ingestToken || 'agentic-hub-dev',
  'agentic-hub-kdf-salt',
  32,
);

/** Chiffre une chaîne (AES-256-GCM). Format: v1:iv:tag:ciphertext (base64). */
export function encrypt(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/** Déchiffre une valeur. Rétrocompatible : renvoie tel quel si non chiffré (legacy). */
export function decrypt(blob: string | null | undefined): string {
  if (!blob) return '';
  if (!blob.startsWith('v1:')) return blob; // valeur en clair (avant chiffrement)
  try {
    const [, ivb, tagb, datab] = blob.split(':');
    const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivb!, 'base64'));
    decipher.setAuthTag(Buffer.from(tagb!, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(datab!, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
