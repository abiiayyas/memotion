import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Addresses a website capture must never reach: this machine, the local network, link-local and cloud metadata. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, incl. 169.254.169.254 metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      a >= 224 // multicast and reserved
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
  }
  return true; // not an IP at all: refuse
}

export interface GuardedUrl {
  url: string;
  host: string;
}

/**
 * Accept only public http(s) URLs. The host is resolved and every address must be public, so a name that points at
 * 127.0.0.1 or the cloud metadata address is refused too. (A hostile DNS server could still answer differently
 * when the browser asks a moment later; this closes the casual and the prompt-injection cases, not that one.)
 */
export async function assertPublicUrl(raw: string): Promise<GuardedUrl> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That is not a valid URL. Use a full address such as https://example.com.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https addresses can be captured.");
  if (u.username || u.password) throw new Error("Addresses with a username or password are not allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Local addresses cannot be captured.");
  }
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new Error(`Could not find "${host}". Check the address.`);
  if (addresses.some(isPrivateAddress)) throw new Error("That address points to a private or local network and cannot be captured.");
  return { url: u.toString(), host };
}
