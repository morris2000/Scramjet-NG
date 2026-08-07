const URL_BASE = "http://scramjet-ng.invalid";
export const DEFAULT_SCRAMJET_PROXY_PREFIX = "/~/sj/";

export interface ScramjetProxyRoute {
  readonly prefix: string;
  readonly controllerId: string;
  readonly frameId: string;
  readonly target: string;
  readonly targetUrl: URL;
  readonly metadata: URLSearchParams;
}

export interface ScramjetProxyRouteIds {
  readonly controllerId: string;
  readonly frameId: string;
}

function normalizePrefix(prefix: string): string {
  if (!prefix.startsWith("/") || !prefix.endsWith("/")) {
    throw new TypeError("Scramjet proxy prefix must start and end with '/'");
  }

  return prefix;
}

function assertHttpTarget(targetUrl: URL): void {
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    throw new TypeError("Scramjet targets must use http or https");
  }

  if (targetUrl.username || targetUrl.password) {
    throw new TypeError("Scramjet targets cannot contain credentials");
  }
}

function decodeSegment(segment: string, label: string): string {
  try {
    const decoded = decodeURIComponent(segment);
    if (!decoded) {
      throw new TypeError(`${label} cannot be empty`);
    }

    return decoded;
  } catch (error) {
    if (error instanceof TypeError && error.message === `${label} cannot be empty`) {
      throw error;
    }

    throw new TypeError(`Invalid encoded ${label}`);
  }
}

/**
 * Build the browser-visible path used by the official Scramjet controller.
 * The target URL is encoded as one path segment; the target fragment remains
 * a browser fragment and is therefore never sent to the gateway server.
 */
export function createScramjetProxyPath(
  target: string | URL,
  ids: ScramjetProxyRouteIds,
  prefix = DEFAULT_SCRAMJET_PROXY_PREFIX,
): string {
  const normalizedPrefix = normalizePrefix(prefix);
  const targetUrl = new URL(target.toString(), URL_BASE);
  assertHttpTarget(targetUrl);

  if (!ids.controllerId || !ids.frameId) {
    throw new TypeError("Scramjet controller and frame IDs are required");
  }

  const fragment = targetUrl.hash;
  targetUrl.hash = "";

  const encodedTarget = encodeURIComponent(targetUrl.href);
  const encodedFragment = fragment
    ? `#${encodeURIComponent(fragment.slice(1))}`
    : "";

  return `${normalizedPrefix}${encodeURIComponent(ids.controllerId)}/${encodeURIComponent(ids.frameId)}/${encodedTarget}${encodedFragment}`;
}

/**
 * Decode an official Scramjet browser URL without forwarding Scramjet's query
 * metadata to the upstream target.
 */
export function parseScramjetProxyUrl(
  input: string | URL,
  options: { prefix?: string } = {},
): ScramjetProxyRoute {
  const prefix = normalizePrefix(
    options.prefix ?? DEFAULT_SCRAMJET_PROXY_PREFIX,
  );
  const requestUrl = new URL(input.toString(), URL_BASE);

  if (!requestUrl.pathname.startsWith(prefix)) {
    throw new TypeError("URL is outside the Scramjet proxy prefix");
  }

  const suffix = requestUrl.pathname.slice(prefix.length);
  const segments = suffix.split("/");
  if (segments.length !== 3 || segments.some((segment) => !segment)) {
    throw new TypeError("Scramjet proxy URL must contain controller, frame, and target segments");
  }

  const controllerId = decodeSegment(segments[0], "controller ID");
  const frameId = decodeSegment(segments[1], "frame ID");
  const encodedTarget = segments[2];

  let decodedTarget: string;
  try {
    decodedTarget = decodeURIComponent(encodedTarget);
  } catch {
    throw new TypeError("Invalid encoded Scramjet target");
  }

  const targetUrl = new URL(decodedTarget);
  assertHttpTarget(targetUrl);

  if (requestUrl.hash) {
    targetUrl.hash = decodeURIComponent(requestUrl.hash.slice(1));
  }

  return {
    prefix,
    controllerId,
    frameId,
    target: targetUrl.href,
    targetUrl,
    metadata: new URLSearchParams(requestUrl.search),
  };
}
