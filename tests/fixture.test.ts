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

test("fixture exposes the cookie contract used by the browser slice", async () => {
	const fixture = await listenCompatibilityFixture();

	try {
		const response = await fetch(`${fixture.origin}/api/cookie`, {
			headers: { cookie: "fixture_direct=1" },
		});
		assert.equal(response.status, 200);
		assert.equal(
			response.headers.get("set-cookie"),
			"fixture_server=from-server; Path=/; SameSite=Lax"
		);
		assert.deepEqual(await response.json(), {
			requestCookie: "fixture_direct=1",
		});
	} finally {
		await fixture.close();
	}
});

test("fixture serves dynamic module and Worker script contracts", async () => {
	const fixture = await listenCompatibilityFixture();

	try {
		const [moduleResponse, workerResponse] = await Promise.all([
			fetch(`${fixture.origin}/dynamic-module.js`),
			fetch(`${fixture.origin}/worker.js`),
		]);
		assert.equal(moduleResponse.status, 200);
		assert.equal(workerResponse.status, 200);
		assert.match(moduleResponse.headers.get("content-type") ?? "", /javascript/);
		assert.match(workerResponse.headers.get("content-type") ?? "", /javascript/);
		assert.match(await moduleResponse.text(), /dynamicValue = "dynamic-value"/);
		assert.match(await workerResponse.text(), /self\.addEventListener\("message"/);
	} finally {
		await fixture.close();
	}
});

test("fixture serves the app-facing abort compatibility contract", async () => {
	const fixture = await listenCompatibilityFixture();

	try {
		const response = await fetch(`${fixture.origin}/runtime-compat.js`);
		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type") ?? "", /javascript/);
		assert.match(await response.text(), /AbortError/);
	} finally {
		await fixture.close();
	}
});

test("fixture serves the nested iframe document contract", async () => {
	const fixture = await listenCompatibilityFixture();

	try {
		const response = await fetch(`${fixture.origin}/nested-frame.html`);
		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type") ?? "", /text\/html/);
		const body = await response.text();
		assert.match(body, /id="nested-app"/);
		assert.match(body, /nested-iframe-reply/);
	} finally {
		await fixture.close();
	}
});

test("fixture accepts multipart file uploads", async () => {
	const fixture = await listenCompatibilityFixture();

	try {
		const form = new FormData();
		form.set("description", "direct upload");
		form.set("file", new File(["direct file"], "direct.txt", { type: "text/plain" }));
		const response = await fetch(`${fixture.origin}/api/upload`, {
			method: "POST",
			body: form,
		});

		assert.equal(response.status, 200);
		assert.deepEqual(await response.json(), {
			description: "direct upload",
			fileName: "direct.txt",
			fileType: "text/plain",
			fileBytes: 11,
			fileBody: "direct file",
			fileSha256: "2c735545895a65a94dd6f3b3fc3624280771fa64a263d6ed182a602ee7c04d6c",
		});
	} finally {
		await fixture.close();
	}
});

test("fixture exposes a cancellable slow response", async () => {
	const fixture = await listenCompatibilityFixture();

	try {
		const controller = new AbortController();
		const pending = fetch(`${fixture.origin}/api/slow`, { signal: controller.signal });
		controller.abort();
		await assert.rejects(pending, (error: unknown) =>
			error instanceof DOMException && error.name === "AbortError"
		);
	} finally {
		await fixture.close();
	}
});
