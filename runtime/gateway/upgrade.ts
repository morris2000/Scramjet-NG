import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

export type GatewayUpgradeHandler = (
	request: IncomingMessage,
	socket: Duplex,
	head: Buffer
) => boolean | void;
