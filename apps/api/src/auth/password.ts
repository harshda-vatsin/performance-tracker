import { Algorithm, hash, verify } from '@node-rs/argon2';
import { config } from '../config.js';

const ARGON_OPTS = { algorithm: Algorithm.Argon2id } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Hash used to burn equal time when the login id is unknown, so timing does not reveal valid codes. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  return dummyHash;
}

/** Length-only policy (doc 03 §2): no composition rules. Returns a problem description or null. */
export function passwordPolicyProblem(password: string): string | null {
  if (password.length < config.password.minLength) {
    return `Password must be at least ${config.password.minLength} characters`;
  }
  return null;
}
