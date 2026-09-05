import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

// Hand-rolled rather than promisify(scrypt): promisify collapses to the
// 3-argument overload and drops the options parameter, which is where the cost
// factors live.
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// scrypt ships with Node, so there is no native build step and nothing to
// install — which matters because a password hash that fails to compile in CI
// or in a slim container is a password hash nobody ships.
//
// N=2^15 with r=8 costs ~32MB and ~100ms per hash on current hardware: slow
// enough to make offline cracking expensive, fast enough that a login request
// does not feel stalled. The parameters are stored alongside each hash so they
// can be raised later without invalidating existing accounts.
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// scrypt needs maxmem >= 128 * N * r, and Node's default (32MB) is exactly at
// the boundary for these parameters — give it headroom or it throws.
const MAX_MEM = 128 * SCRYPT_N * SCRYPT_R * 2;

const PREFIX = "scrypt";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  });

  return [
    PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing for malformed hashes: a corrupt row
 * should fail the login, not 500 the endpoint.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  let expected: Buffer;
  let salt: Buffer;
  try {
    expected = Buffer.from(hashB64!, "base64");
    salt = Buffer.from(saltB64!, "base64");
  } catch {
    return false;
  }
  if (expected.length === 0 || salt.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: Math.max(128 * N * r * 2, MAX_MEM),
    });
  } catch {
    // Absurd stored parameters (e.g. an N that exceeds maxmem) — treat as a
    // failed login rather than crashing the request.
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Constant-ish-time dummy verification.
 *
 * Login must take about the same time whether or not the email exists,
 * otherwise the timing difference enumerates registered users.
 */
export async function fakeVerify(password: string): Promise<void> {
  await scryptAsync(password.normalize("NFKC"), randomBytes(SALT_LENGTH), KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEM,
  });
}
