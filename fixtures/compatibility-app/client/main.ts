const app = document.querySelector("#app");

function setResult(id, value) {
	const element = document.querySelector(`#${id}`);
	if (element) element.textContent = value;
}

function renderSpaRoute() {
	const route = `${window.location.pathname}${window.location.search}`;
	const label = window.location.pathname === "/spa/next" ? "next" : "home";
	setResult("spa-result", `${label}:${route}`);
}

function setupSpaNavigation() {
	document.querySelector("#spa-next")?.addEventListener("click", () => {
		history.pushState({ page: "next" }, "", "/spa/next?step=2");
		renderSpaRoute();
	});
	document.querySelector("#spa-back")?.addEventListener("click", () => {
		history.back();
	});
	window.addEventListener("popstate", renderSpaRoute);
	renderSpaRoute();
}

async function readStream() {
	const response = await fetch("/stream");
	if (!response.body) throw new Error("Streaming response has no body");

	const reader = response.body.getReader();
	const chunks = [];
	while (true) {
		const result = await reader.read();
		if (result.done) break;
		chunks.push(new TextDecoder().decode(result.value));
	}
	return chunks;
}

function readBinaryMessage(data) {
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (data instanceof Blob) return data.arrayBuffer().then((value) => new Uint8Array(value));
	if (ArrayBuffer.isView(data)) {
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	}
	throw new Error("Unexpected WebSocket binary message type");
}

async function runWebSocketCheck() {
	const url = new URL("/socket", window.location.href);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		socket.binaryType = "arraybuffer";
		let textReceived = false;
		let binaryReceived = false;
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			socket.close();
			reject(new Error("WebSocket echo timed out"));
		}, 10_000);

		const finish = (callback, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			callback(value);
		};

		socket.addEventListener("open", () => {
			socket.send("browser-text");
			socket.send(new Uint8Array([1, 2, 3, 4]));
		});
		socket.addEventListener("message", async (event) => {
			try {
				if (typeof event.data === "string" && event.data === "browser-text") {
					textReceived = true;
				} else {
					const bytes = await readBinaryMessage(event.data);
					binaryReceived =
						bytes.length === 4 && bytes.every((value, index) => value === index + 1);
				}

				if (textReceived && binaryReceived) {
					socket.close();
					finish(resolve, "text:browser-text|binary:1,2,3,4");
				}
			} catch (error) {
				finish(reject, error instanceof Error ? error : new Error(String(error)));
			}
		});
		socket.addEventListener("error", () => {
			finish(reject, new Error("WebSocket connection failed"));
		});
	});
}

async function runCompatibilityChecks() {
	document.title = "Scramjet-NG Compatibility Fixture";
	if (app) app.textContent = "Fixture loaded";
	setupSpaNavigation();

	const jsonResponse = await fetch("/api/json");
	const json = await jsonResponse.json();
	setResult("relative-result", JSON.stringify(json));

	const chunks = await readStream();
	setResult("stream-result", `${chunks.length}:${chunks.join("")}`);

	const echoResponse = await fetch("/api/echo", {
		method: "POST",
		headers: { "content-type": "text/plain" },
		body: "hello scramjet-ng",
	});
	setResult("echo-result", JSON.stringify(await echoResponse.json()));

	setResult("websocket-result", await runWebSocketCheck());
}

runCompatibilityChecks().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	setResult("error-result", message);
	console.error(error);
});
