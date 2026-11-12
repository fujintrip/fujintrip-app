// DigitalOcean Spaces upload (S3-compatible) — the media storage for
// travelers' reels. No new dependency: the SigV4 signer is hand-rolled
// on node:crypto and unit-tested against AWS's own published test vector
// (the IAM ListUsers example — see tests/reels.test.mjs).
//
// Honest state: the Spaces credentials (SPACES_KEY / SPACES_SECRET) are
// NOT in this environment, so the live PUT path is code-reviewed and
// signing-verified, but never exercised against the real bucket. Until
// the keys are set in DigitalOcean, the upload route stores media on
// this server instead (lib/serverStore) and says so in the UI — it
// never claims a photo is in Spaces when it is not.
import { createHash, createHmac } from 'crypto';

export function spacesConfigured(): boolean {
  return Boolean(
    process.env.SPACES_KEY && process.env.SPACES_SECRET && process.env.SPACES_BUCKET && process.env.SPACES_ENDPOINT
  );
}

function endpointHost(): string {
  const raw = process.env.SPACES_ENDPOINT ?? '';
  return raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function spacesPublicUrl(key: string): string {
  return `https://${process.env.SPACES_BUCKET}.${endpointHost()}/${key}`;
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

// AWS SigV4 — canonical request for a PUT with a payload hash.
export function canonicalRequest(opts: {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  signedHeaders: string[];
  payloadHash: string;
}): string {
  const lines = [opts.method, opts.path, opts.query];
  for (const name of opts.signedHeaders) {
    lines.push(`${name}:${opts.headers[name].trim().replace(/\s+/g, ' ')}`);
  }
  lines.push('', opts.signedHeaders.join(';'), opts.payloadHash);
  return lines.join('\n');
}

export function computeSignature(opts: {
  secretKey: string;
  dateStamp: string;
  region: string;
  service: string;
  stringToSign: string;
}): string {
  const kDate = hmac(`AWS4${opts.secretKey}`, opts.dateStamp);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, opts.service);
  const kSigning = hmac(kService, 'aws4_request');
  return hmac(kSigning, opts.stringToSign).toString('hex');
}

export function signRequest(opts: {
  method: string;
  url: string;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  accessKey: string;
  secretKey: string;
  amzDate: string; // e.g. 20150830T123600Z
}): { authorization: string; signature: string } {
  const u = new URL(opts.url);
  const dateStamp = opts.amzDate.slice(0, 8);
  const signedHeaders = Object.keys(opts.headers).map((h) => h.toLowerCase()).sort();
  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers)) lowerHeaders[k.toLowerCase()] = v;
  const canonical = canonicalRequest({
    method: opts.method,
    path: u.pathname,
    query: u.search ? u.search.slice(1) : '',
    headers: lowerHeaders,
    signedHeaders,
    payloadHash: opts.payloadHash,
  });
  const scope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', opts.amzDate, scope, sha256Hex(canonical)].join('\n');
  const signature = computeSignature({ ...opts, dateStamp, stringToSign });
  return {
    signature,
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
  };
}

// PUT an object into the Spaces bucket. Returns the public URL on
// success. Never throws — callers turn a failure into an honest
// "not configured / upload failed" state instead of a fake success.
export async function putObject(
  key: string,
  buffer: Buffer,
  mime: string
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  if (!spacesConfigured()) {
    return { ok: false, message: 'Spaces is not configured — SPACES_KEY / SPACES_SECRET are not set.' };
  }
  const bucket = process.env.SPACES_BUCKET as string;
  const region = process.env.SPACES_REGION || 'nyc3';
  const host = endpointHost();
  const url = `https://${host}/${bucket}/${key}`;
  const payloadHash = sha256Hex(buffer);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const headers: Record<string, string> = {
    host,
    'content-type': mime,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const { authorization } = signRequest({
    method: 'PUT',
    url,
    headers,
    payloadHash,
    region,
    service: 's3',
    accessKey: process.env.SPACES_KEY as string,
    secretKey: process.env.SPACES_SECRET as string,
    amzDate,
  });
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, Authorization: authorization, 'Content-Length': String(buffer.length) },
      body: new Uint8Array(buffer),
    });
    if (!res.ok) {
      return { ok: false, message: `Spaces upload failed (${res.status}) — the photo was not stored.` };
    }
    return { ok: true, url: spacesPublicUrl(key) };
  } catch {
    return { ok: false, message: 'Spaces could not be reached — the photo was not stored.' };
  }
}
