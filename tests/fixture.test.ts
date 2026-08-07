import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { listenCompatibilityFixture } from "../fixtures/compatibility-app/server/index.ts";

test("fixture echoes WebSocket text and binary frames", async () => {
	const fixture = await listenCompatibilityFixture();
	const socket = new WebSocket(
		`${fixture.origin.replace(/^http:/, "ws:")}/socket`
	);

	try {
		const received = await new Promise<{ text: string; binary: Buffer }>(
			(resolve, reject) => {
				let text: string | undefined;
				let binary: Buffer | undefined;
				const timeout = setTimeout(
					() => reject(new Error("Fixture WebSocket echo timed out")),
					5_000
				);

				const settle = () => {
					if (!text || !binary) return;
					clearTimeout(timeout);
					resolve({ text, binary });
				};

				socket.once("error", (error) => {
					clearTimeout(timeout);
					reject(error);
				});
				socket.on("message", (data, isBinary) => {
					if (isBinary) binary = Buffer.from(data as Buffer);
					else text = data.toString();
					settle();
				});
				socket.once("open", () => {
					socket.send("fixture-text");
					socket.send(Buffer.from([4, 3, 2, 1]));
				});
			}
		);

		assert.equal(received.text, "fixture-text");
		assert.deepEqual([...received.binary], [4, 3, 2, 1]);
	} finally {
		socket.close();
		await fixture.close();
	}
});
