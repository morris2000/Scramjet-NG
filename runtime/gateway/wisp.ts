import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { GatewayPolicy } from "./policy.ts";
import type { GatewayUpgradeHandler } from "./upgrade.ts";

export const DEFAULT_WISP_PATH = "/wisp/";

export interface WispServerOptions {
	hostname_whitelist?: RegExp[] | null;
	allow_direct_ip?: boolean;
	allow_private_ips?: boolean;
	allow_loopback_ips?: boolean;
	allow_udp_streams?: boolean;
	allow_tcp_streams?: boolean;
	stream_limit_per_host?: number;
	stream_limit_total?: number;
	parse_real_ip?: boolean;
	[key: string]: unknown;
}

export interface WispServerLike {
	readonly options: WispServerOptions;
	routeRequest(request: IncomingMessage, socket: Duplex, head: Buffer): void;
}

export interface WispUpgradeHandlerOptions {
	readonly wisp: WispServerLike;
	readonly policy: GatewayPolicy;
	readonly path?: string;
	readonly maxConnectionBytes?: number;
}

function normalizeWispPath(path: string): string {
	if (!path.startsWith("/") || !path.endsWith("/")) {
		throw new TypeError("Wisp path must start and end with '/'");
	}
	return path;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedHost(value: string): string {
	return value.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Apply Scramjet-NG's explicit target policy to the official Wisp server.
 * Wisp destinations are carried inside binary protocol packets, so the
 * Wisp-side hostname/IP filters are the enforcement point for those targets.
 */
export function configureWispServer(
	wisp: WispServerLike,
	policy: GatewayPolicy
): void {
	wisp.options.hostname_whitelist = policy.allowedHosts.map(
		(host) => new RegExp(`^${escapeRegExp(normalizedHost(host))}$`, "i")
	);
	wisp.options.allow_direct_ip = policy.allowedHosts.some(
		(host) => isIP(normalizedHost(host)) !== 0
	);
	wisp.options.allow_private_ips = policy.allowPrivateNetworks;
	wisp.options.allow_loopback_ips =
		policy.development && policy.allowLoopback;
	wisp.options.allow_udp_streams = policy.allowUdpStreams;
	wisp.options.allow_tcp_streams = true;
	// @mercuryworkshop/wisp-js@0.4.1 iterates its streams object when this
	// option is enabled. Keep the upstream setting disabled until that bug is
	// fixed; the total per-connection limit below remains active.
	wisp.options.stream_limit_per_host = -1;
	wisp.options.stream_limit_total = policy.maxWispStreamsTotal;
	wisp.options.parse_real_ip = false;
}

/**
 * Create an upgrade handler for the Scramjet Wisp endpoint. Only the exact
 * `/wisp/` endpoint is accepted; direct Wisp wsproxy paths are intentionally
 * outside this first compatibility slice.
 */
export function createWispUpgradeHandler(
	options: WispUpgradeHandlerOptions
): GatewayUpgradeHandler {
	const path = normalizeWispPath(options.path ?? DEFAULT_WISP_PATH);
	const maxConnectionBytes =
		options.maxConnectionBytes ?? options.policy.maxWebSocketConnectionBytes;

	if (!Number.isSafeInteger(maxConnectionBytes) || maxConnectionBytes <= 0) {
		throw new TypeError("maxConnectionBytes must be a positive safe integer");
	}

	configureWispServer(options.wisp, options.policy);

	return (request, socket, head) => {
		let pathname: string;
		try {
			pathname = new URL(
				request.url ?? "",
				"http://scramjet-ng.invalid"
			).pathname;
		} catch {
			socket.destroy();
			return true;
		}

		if (pathname !== path) {
			return false;
		}

		if (
			request.method !== "GET" ||
			request.headers.upgrade?.toLowerCase() !== "websocket"
		) {
			socket.destroy();
			return true;
		}

		let totalBytes = head.byteLength;
		if (totalBytes > maxConnectionBytes) {
			socket.destroy();
			return true;
		}

		const onData = (chunk: Buffer) => {
			totalBytes += chunk.byteLength;
			if (totalBytes > maxConnectionBytes) {
				socket.destroy();
			}
		};
		const cleanup = () => {
			socket.off("data", onData);
			socket.off("close", cleanup);
			socket.off("error", cleanup);
		};

		socket.on("data", onData);
		socket.once("close", cleanup);
		socket.once("error", cleanup);

		try {
			options.wisp.routeRequest(request, socket, head);
		} catch {
			cleanup();
			socket.destroy();
		}

		return true;
	};
}

export async function loadOfficialWispServer(): Promise<WispServerLike> {
	const module = (await import(
		"@mercuryworkshop/wisp-js/server"
	)) as unknown as { server?: WispServerLike };
	if (!module.server) {
		throw new Error("Official Wisp server module did not expose server");
	}
	return module.server;
}

export async function createOfficialWispUpgradeHandler(
	options: Omit<WispUpgradeHandlerOptions, "wisp">
): Promise<GatewayUpgradeHandler> {
	const wisp = await loadOfficialWispServer();
	return createWispUpgradeHandler({ ...options, wisp });
}
