import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as request } from 'undici';
import type { SourceConfig } from '../shared.js';

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function encryptionKey(directory: string) {
  const path = join(directory, 'secrets.key');
  if (!existsSync(path)) writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' });
  chmodSync(path, 0o600);
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error('Invalid secrets.key: expected 32 bytes.');
  return key;
}
export function encrypt(value: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
}
export function decrypt(value: string, key: Buffer) {
  const bytes = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
}
export function validateBase(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a complete http:// or https:// server URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Server URL must use HTTP(S), without credentials, query, or fragment.');
  if (
    url.pathname.split('/').some((segment) => {
      try {
        return /[\\/?#]/.test(decodeURIComponent(segment));
      } catch {
        return true;
      }
    })
  )
    throw new Error('Server URL contains an unsafe path.');
  return url.toString().replace(/\/$/, '');
}
export function addressAllowed(
  address: string,
  allowPrivate: boolean,
  allowLoopback = false,
): boolean {
  const raw = address.toLowerCase().replace(/^\[|\]$/g, '');
  const ip = isIP(raw) === 6 ? new URL('http://[' + raw + ']').hostname.slice(1, -1) : raw;
  if (ip.startsWith('::ffff:')) return addressAllowed(ip.slice(7), allowPrivate, allowLoopback);
  if (!isIP(ip)) return false;
  if (['168.63.129.16', '100.100.100.200', 'fd00:ec2::254'].includes(ip)) return false;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a >= 224 || (a === 169 && b === 254)) return false;
    if (a === 127) return allowLoopback;
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
      return allowPrivate;
    return true;
  }
  if (ip === '::') return false;
  if (ip === '::1') return allowLoopback;
  // Only ordinary global-unicast or explicitly approved unique-local IPv6.
  if (/^f[cd]/.test(ip)) return allowPrivate;
  return /^[23][0-9a-f]{3}:/.test(ip);
}
export interface Transport {
  json<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  image(path: string): Promise<{ bytes: Uint8Array; mime: string }>;
}
export function sourceTransport(
  source: SourceConfig,
  headers: Record<string, string>,
  allowLoopback = false,
): Transport {
  const base = validateBase(source.url);
  async function send(
    path: string,
    init?: { method?: string; body?: unknown },
    limit = 8 * 1024 * 1024,
  ) {
    if (!path.startsWith('/') || path.startsWith('//') || /[\\]/.test(path))
      throw new Error('Adapter requested an invalid path.');
    const url = new URL(base + path);
    if (url.origin !== new URL(base).origin)
      throw new Error('Cross-origin source request blocked.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true });
    if (
      !addresses.length ||
      addresses.some((a) => !addressAllowed(a.address, source.allowPrivate, allowLoopback))
    )
      throw new Error(
        'Endpoint blocked: approve private LAN access, or use a permitted server. Loopback, link-local and metadata endpoints are blocked by default.',
      );
    // Pin the checked addresses to the socket to prevent DNS rebinding.
    const agent = new Agent({
      connect: {
        lookup: (_host, options, callback) => {
          const chosen =
            addresses.find((a) => !options.family || a.family === options.family) || addresses[0];
          if (options.all) callback(null, addresses as never);
          else callback(null, chosen.address, chosen.family as 4 | 6);
        },
        timeout: 5000,
      },
    });
    try {
      const response = await request(url, {
        dispatcher: agent,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
        method: init?.method || 'GET',
        headers: {
          ...headers,
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init?.body ? JSON.stringify(init.body) : undefined,
      });
      if (response.status >= 300 && response.status < 400)
        throw new Error('Source redirected. Configure its final URL; redirects are not followed.');
      if (response.status === 401 || response.status === 403)
        throw new Error(
          'Authentication failed. Check credentials and account library permissions.',
        );
      if (!response.ok)
        throw new Error(
          `Source returned HTTP ${response.status}. Check server URL and API compatibility.`,
        );
      if (Number(response.headers.get('content-length')) > limit)
        throw new Error('Source response exceeds the size limit.');
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > limit) {
          await reader.cancel();
          throw new Error('Source response exceeds the size limit.');
        }
        chunks.push(part.value);
      }
      return {
        bytes: Buffer.concat(chunks),
        mime: (response.headers.get('content-type') || '').split(';')[0],
      };
    } catch (error) {
      if (
        error instanceof Error &&
        /^(Source |Authentication |Endpoint |Adapter |Cross-origin)/.test(error.message)
      )
        throw error;
      throw new Error(
        'Source could not be reached within 10 seconds. Check DNS, firewall, URL, and TLS certificate.',
      );
    } finally {
      await agent.destroy();
    }
  }
  return {
    async json<T>(path: string, init?: { method?: string; body?: unknown }) {
      const r = await send(path, init);
      try {
        return JSON.parse(r.bytes.toString()) as T;
      } catch {
        throw new Error('Source returned invalid JSON. Check the API base URL.');
      }
    },
    async image(path: string) {
      const r = await send(path, undefined, 512 * 1024);
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(r.mime))
        throw new Error('Source artwork format is unsupported.');
      return r;
    },
  };
}
