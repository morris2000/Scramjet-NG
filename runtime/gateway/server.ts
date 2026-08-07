import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  createGatewayPolicy,
  GatewayPolicyError,
  validateGatewayTarget,
  type GatewayPolicy,
  type LookupHost,
} from "./policy.ts";
import { createScramjetProxyPath, parseScramjetProxyUrl, type ScramjetProxyRoute } from "./url.ts";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const REQUEST_HEADERS_TO_DROP = new Set([
  ...HOP_BY_HOP_HEADERS,
  "accept-encoding",
  "content-length",
  "forwarded",
  "host",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

const RESPONSE_HEADERS_TO_DROP = new Set([
  ...HOP_BY_HOP_HEADERS,
  "content-encoding",
  "content-length",
]);

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export type GatewayFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpGatewayServerOptions {
  readonly proxyOrigin?: string;
  readonly prefix?: string;
  readonly policy: GatewayPolicy;
  readonly fetch?: GatewayFetch;
  readonly lookup?: LookupHost;
}

export interface ListeningHttpGateway {
  readonly server: Server;
  readonly origin: string;
  close(): Promise<void>;
}

class GatewayRequestError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;

  constructor(statusCode: number, errorCode: string, message: string) {
    super(message);
    this.name = "GatewayRequestError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function getFetch(fetchImpl?: GatewayFetch): GatewayFetch {
  if (fetchImpl) {
    return fetchImpl;
  }

  return fetch as GatewayFetch;
}

function hasRequestBody(request: IncomingMessage): boolean {
  return request.method !== "GET" && request.method !== "HEAD";
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    const normalizedName = name.toLowerCase();
    if (REQUEST_HEADERS_TO_DROP.has(normalizedName) || value === undefined) {
      continue;
    }

    headers.set(normalizedName, Array.isArray(value) ? value.join(", ") : value);
  }

  return headers;
}

async function readRequestBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer | undefined> {
  if (!hasRequestBody(request)) {
    request.resume();
    return undefined;
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new GatewayRequestError(413, "request_body_too_large", "Request body exceeds the configured limit");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, total);
}

function setResponseHeaders(
  response: ServerResponse,
  upstream: Response,
  route: ScramjetProxyRoute,
  targetUrl: URL,
): void {
  const location = upstream.headers.get("location");
  for (const [name, value] of upstream.headers.entries()) {
    const normalizedName = name.toLowerCase();
    if (RESPONSE_HEADERS_TO_DROP.has(normalizedName) || normalizedName === "location") {
      continue;
    }
    response.setHeader(name, value);
  }

  const setCookie = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.();
  if (setCookie?.length) {
    response.setHeader("set-cookie", setCookie);
  }

  if (location) {
    const nextTarget = new URL(location, targetUrl);
    response.setHeader(
      "location",
      createScramjetProxyPath(nextTarget, route, route.prefix),
    );
  }
}

async function pipeResponseBody(
  upstream: Response,
  response: ServerResponse,
  maxBytes: number,
): Promise<void> {
  if (!upstream.body) {
    response.end();
    return;
  }

  const declaredLength = upstream.headers.get("content-length");
  if (declaredLength && Number.parseInt(declaredLength, 10) > maxBytes) {
    await upstream.body.cancel("response body exceeds configured limit");
    throw new GatewayRequestError(502, "response_body_too_large", "Response body exceeds the configured limit");
  }

  const reader = upstream.body.getReader();
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = Buffer.from(value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel("response body exceeds configured limit");
        throw new GatewayRequestError(502, "response_body_too_large", "Response body exceeds the configured limit");
      }

      if (!response.write(chunk)) {
        await once(response, "drain");
      }
    }

    response.end();
  } catch (error) {
    if (response.headersSent && !response.destroyed) {
      response.destroy(error instanceof Error ? error : new Error("Upstream response failed"));
    }
    throw error;
  }
}

function writeError(response: ServerResponse, error: unknown): void {
  if (response.headersSent || response.destroyed) {
    response.destroy(error instanceof Error ? error : undefined);
    return;
  }

  const gatewayError = error instanceof GatewayRequestError
    ? error
    : error instanceof GatewayPolicyError
      ? new GatewayRequestError(403, "target_rejected", "Upstream target rejected by gateway policy")
      : new GatewayRequestError(502, "upstream_error", "Unable to reach upstream target");

  response.statusCode = gatewayError.statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ error: gatewayError.errorCode }));
}

async function handleGatewayRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<Pick<HttpGatewayServerOptions, "proxyOrigin" | "prefix">> & Omit<HttpGatewayServerOptions, "proxyOrigin" | "prefix">,
): Promise<void> {
  if (!request.url) {
    throw new GatewayRequestError(400, "missing_request_url", "Request URL is required");
  }

  let route: ScramjetProxyRoute;
  try {
    route = parseScramjetProxyUrl(
      new URL(request.url, options.proxyOrigin),
      { prefix: options.prefix },
    );
  } catch {
    throw new GatewayRequestError(404, "invalid_proxy_url", "Not a Scramjet proxy URL");
  }

  await validateGatewayTarget(route.targetUrl, options.policy, options.lookup);

  const body = await readRequestBody(request, options.policy.maxRequestBodyBytes);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.policy.timeoutMs);

  try {
    const upstream = await getFetch(options.fetch)(route.targetUrl, {
      method: request.method,
      headers: requestHeaders(request),
      body,
      redirect: "manual",
      signal: controller.signal,
    });

    if (REDIRECT_STATUS_CODES.has(upstream.status)) {
      const location = upstream.headers.get("location");
      if (location) {
        if (options.policy.maxRedirects < 1) {
          throw new GatewayRequestError(502, "redirect_limit", "Upstream redirect limit exceeded");
        }
        const nextTarget = new URL(location, route.targetUrl);
        await validateGatewayTarget(nextTarget, options.policy, options.lookup);
      }
    }

    setResponseHeaders(response, upstream, route, route.targetUrl);
    response.statusCode = upstream.status;

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    await pipeResponseBody(
      upstream,
      response,
      options.policy.maxResponseBodyBytes,
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new GatewayRequestError(504, "upstream_timeout", "Upstream request timed out");
    }
    if (error instanceof GatewayRequestError) {
      throw error;
    }
    if (error instanceof GatewayPolicyError) {
      throw new GatewayRequestError(403, "target_rejected", "Upstream target rejected by gateway policy");
    }
    throw new GatewayRequestError(502, "upstream_error", "Unable to reach upstream target");
  } finally {
    clearTimeout(timeout);
  }
}

export function createHttpGatewayServer(options: HttpGatewayServerOptions): Server {
  const normalizedOptions = {
    ...options,
    proxyOrigin: options.proxyOrigin ?? "http://127.0.0.1:8080",
    prefix: options.prefix ?? "/~/sj/",
    policy: createGatewayPolicy(options.policy),
  } as Required<Pick<HttpGatewayServerOptions, "proxyOrigin" | "prefix">> & Omit<HttpGatewayServerOptions, "proxyOrigin" | "prefix">;

  const listener: RequestListener = (request, response) => {
    void handleGatewayRequest(request, response, normalizedOptions).catch((error) => {
      writeError(response, error);
    });
  };

  return createServer(listener);
}

export async function listenHttpGatewayServer(
  options: HttpGatewayServerOptions & { host?: string; port?: number } ,
): Promise<ListeningHttpGateway> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const server = createHttpGatewayServer({
    ...options,
    proxyOrigin: options.proxyOrigin ?? `http://${host}:${port}`,
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Gateway server did not expose a TCP address");
  }

  return {
    server,
    origin: `http://${host}:${address.port}`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
