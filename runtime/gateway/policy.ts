import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface GatewayPolicy {
  readonly development: boolean;
  readonly allowedHosts: readonly string[];
  readonly allowLoopback: boolean;
  readonly allowPrivateNetworks: boolean;
  readonly maxRequestBodyBytes: number;
	readonly maxResponseBodyBytes: number;
	readonly timeoutMs: number;
	readonly maxRedirects: number;
	readonly maxWispStreamsTotal: number;
	readonly allowUdpStreams: boolean;
	readonly maxWebSocketConnectionBytes: number;
}

export interface GatewayPolicyInput {
  readonly development?: boolean;
  readonly allowedHosts?: readonly string[];
  readonly allowLoopback?: boolean;
  readonly allowPrivateNetworks?: boolean;
  readonly maxRequestBodyBytes?: number;
	readonly maxResponseBodyBytes?: number;
	readonly timeoutMs?: number;
	readonly maxRedirects?: number;
	readonly maxWispStreamsTotal?: number;
	readonly allowUdpStreams?: boolean;
	readonly maxWebSocketConnectionBytes?: number;
}

export interface LookupAddress {
  readonly address: string;
  readonly family: number;
}

export type LookupHost = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;

export class GatewayPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayPolicyError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "169.254.169.254",
  "metadata",
  "metadata.google.internal",
  "instance-data.ec2.internal",
  "kubernetes.default.svc",
]);

const DEFAULT_MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BODY_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_WISP_STREAMS_TOTAL = 64;
const DEFAULT_MAX_WEBSOCKET_CONNECTION_BYTES = 64 * 1024 * 1024;

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

export function createGatewayPolicy(input: GatewayPolicyInput = {}): GatewayPolicy {
  const development = input.development ?? false;
  const allowLoopback = input.allowLoopback ?? false;
  const allowPrivateNetworks = input.allowPrivateNetworks ?? false;

  if (!development && (allowLoopback || allowPrivateNetworks)) {
    throw new TypeError("Loopback and private-network access is development-only");
  }

  const allowedHosts = [...new Set(
    (input.allowedHosts ?? []).map(normalizeHost).filter(Boolean),
  )];

  const maxRequestBodyBytes =
    input.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
  const maxResponseBodyBytes =
    input.maxResponseBodyBytes ?? DEFAULT_MAX_RESPONSE_BODY_BYTES;
	const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxRedirects = input.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	const maxWispStreamsTotal =
		input.maxWispStreamsTotal ?? DEFAULT_MAX_WISP_STREAMS_TOTAL;
	const allowUdpStreams = input.allowUdpStreams ?? false;
	const maxWebSocketConnectionBytes =
		input.maxWebSocketConnectionBytes ?? DEFAULT_MAX_WEBSOCKET_CONNECTION_BYTES;

	assertPositiveInteger("maxRequestBodyBytes", maxRequestBodyBytes);
	assertPositiveInteger("maxResponseBodyBytes", maxResponseBodyBytes);
	assertPositiveInteger("timeoutMs", timeoutMs);
	assertPositiveInteger("maxWispStreamsTotal", maxWispStreamsTotal);
	assertPositiveInteger(
		"maxWebSocketConnectionBytes",
		maxWebSocketConnectionBytes
	);
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new TypeError("maxRedirects must be a non-negative safe integer");
  }

  return {
    development,
    allowedHosts,
    allowLoopback,
    allowPrivateNetworks,
    maxRequestBodyBytes,
		maxResponseBodyBytes,
		timeoutMs,
		maxRedirects,
		maxWispStreamsTotal,
		allowUdpStreams,
		maxWebSocketConnectionBytes,
	};
}

function parseIPv4(address: string): [number, number, number, number] | null {
  if (isIP(address) !== 4) {
    return null;
  }

  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) {
    return null;
  }

  return octets as [number, number, number, number];
}

function parseMappedIPv4(address: string): string | null {
  const normalized = address.toLowerCase();
  if (!normalized.startsWith("::ffff:")) {
    return null;
  }

  const tail = normalized.slice("::ffff:".length);
  if (isIP(tail) === 4) {
    return tail;
  }

  const groups = tail.split(":");
  if (groups.length !== 2 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }

  const high = Number.parseInt(groups[0], 16);
  const low = Number.parseInt(groups[1], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

export function isLoopbackAddress(address: string): boolean {
  const mapped = parseMappedIPv4(address);
  const ipv4 = parseIPv4(mapped ?? address);
  if (ipv4) {
    return ipv4[0] === 127;
  }

  return isIP(address) === 6 && address.toLowerCase() === "::1";
}

export function isRestrictedAddress(address: string): boolean {
  const mapped = parseMappedIPv4(address);
  if (mapped) {
    return isRestrictedAddress(mapped);
  }

  const ipv4 = parseIPv4(address);
  if (ipv4) {
    const [first, second] = ipv4;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51) ||
      (first === 203 && second === 0 && ipv4[2] === 113) ||
      first >= 224
    );
  }

  if (isIP(address) !== 6) {
    return false;
  }

  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function policyError(message: string): Error {
  return new GatewayPolicyError(message);
}

/**
 * Resolve and validate a target immediately before forwarding it. The
 * allowlist is mandatory in practice: an empty allowlist rejects all targets.
 */
export async function validateGatewayTarget(
  targetUrl: URL,
  policy: GatewayPolicy,
  lookup: LookupHost = dnsLookup as unknown as LookupHost,
): Promise<void> {
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    throw policyError("Only http and https upstream targets are allowed");
  }

  if (targetUrl.username || targetUrl.password) {
    throw policyError("Upstream credentials are not allowed");
  }

  const hostname = normalizeHost(targetUrl.hostname);
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname)) {
    throw policyError("Upstream hostname is blocked");
  }

  if (!policy.allowedHosts.some((allowedHost) => allowedHost === hostname)) {
    throw policyError("Upstream hostname is not in the allowlist");
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (!addresses.length) {
    throw policyError("Upstream hostname did not resolve");
  }

  for (const { address } of addresses) {
    if (isLoopbackAddress(address)) {
      if (!policy.development || !policy.allowLoopback) {
        throw policyError("Loopback upstream targets are disabled");
      }
      continue;
    }

    if (isRestrictedAddress(address) && !policy.allowPrivateNetworks) {
      throw policyError("Private, link-local, metadata, or reserved upstream targets are disabled");
    }
  }
}
