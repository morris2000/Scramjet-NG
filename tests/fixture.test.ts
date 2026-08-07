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

test("fixture streams standards-shaped SSE events", async () => {
	const fixture = await listenCompatibilityFixture();

	try {
		const response = await fetch(`${fixture.origin}/events`, {
			headers: { accept: "text/event-stream" },
			signal: AbortSignal.timeout(5_000),
		});
		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
		assert.ok(response.body);

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		const first = await reader.read();
		assert.equal(first.done, false);
		const chunks = [decoder.decode(first.value, { stream: true })];
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			chunks.push(decoder.decode(next.value, { stream: true }));
		}
		chunks.push(decoder.decode());

		const body = chunks.join("");
		assert.match(body, /id: 1\ndata: hello from fixture\n\n/);
		assert.match(body, /event: named\nid: 2\ndata: world from fixture\n\n/);
		assert.match(body, /event: done\nid: 3\ndata: complete\n\n/);
	} finally {
		await fixture.close();
	}
});
