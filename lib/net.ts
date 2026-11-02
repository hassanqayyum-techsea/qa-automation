// Pure module (no imports) so `node --test lib/net.test.ts` can check it directly.

/**
 * Tests drive a real browser on our server, so keep them away from internal addresses (Redis, Mongo,
 * cloud metadata). The app under test's own host is always allowed, even if it's private.
 * ponytail: checks the literal hostname only; a public name that resolves to a private IP (DNS rebinding)
 * gets through. Run the worker in a network-isolated container if tests come from people you don't trust.
 */
export function isBlockedHost(hostname: string, allowed: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === allowed.toLowerCase()) return false;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h === "::1" || h === "0.0.0.0") return true;
  const ip = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!ip) return /^(fc|fd|fe80)/.test(h) && h.includes(":"); // IPv6 private / link-local
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
