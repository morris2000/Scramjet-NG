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

async function runEventSourceCheck() {
	return new Promise((resolve, reject) => {
		const source = new EventSource("/events");
		let opened = false;
		let messageData;
		let namedData;
		let namedId;
		let done = false;
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			source.close();
			reject(new Error("EventSource stream timed out"));
		}, 10_000);

		const finish = (callback, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			callback(value);
		};

		source.addEventListener("open", () => {
			opened = true;
		});
		source.addEventListener("message", (event) => {
			messageData = event.data;
		});
		source.addEventListener("named", (event) => {
			namedData = event.data;
			namedId = event.lastEventId;
		});
		source.addEventListener("done", (event) => {
			done = event.data === "complete";
		});
		source.addEventListener("error", () => {
			if (!opened || !done || messageData !== "hello from fixture" || namedData !== "world from fixture") {
				source.close();
				finish(reject, new Error("Unexpected EventSource lifecycle"));
				return;
			}

			source.close();
			finish(
				resolve,
				`open:1|message:${messageData}|named:${namedData}|id:${namedId}|closed:${source.readyState}`,
			);
		});
	});
}

function hasCookie(cookieString, name, value) {
	return cookieString
		.split(";")
		.some((cookie) => cookie.trim() === `${name}=${value}`);
}

async function runCookieCheck() {
	document.cookie = "fixture_document=from-document; Path=/; SameSite=Lax";
	await new Promise((resolve) => setTimeout(resolve, 50));
	const beforeRequest = document.cookie;
	const firstResponse = await fetch("/api/cookie", { credentials: "include" });
	const first = await firstResponse.json();
	const afterFirstResponse = document.cookie;
	const secondResponse = await fetch("/api/cookie", { credentials: "include" });
	const second = await secondResponse.json();

	const documentCookie = hasCookie(beforeRequest, "fixture_document", "from-document");
	const firstRequestCookie = hasCookie(
		first.requestCookie,
		"fixture_document",
		"from-document"
	);
	const serverResponseCookie = hasCookie(
		afterFirstResponse,
		"fixture_server",
		"from-server"
	);
	const secondRequestCookies =
		hasCookie(second.requestCookie, "fixture_document", "from-document") &&
		hasCookie(second.requestCookie, "fixture_server", "from-server");

	if (!documentCookie || !firstRequestCookie || !serverResponseCookie || !secondRequestCookies) {
		throw new Error("Cookie virtualization contract failed");
	}

	return "document:1|request1:1|response:1|request2:2";
}

function runStorageCheck() {
	localStorage.removeItem("fixture-local");
	sessionStorage.removeItem("fixture-session");
	localStorage.setItem("fixture-local", "local-value");
	sessionStorage.setItem("fixture-session", "session-value");

	const localValue = localStorage.getItem("fixture-local");
	const sessionValue = sessionStorage.getItem("fixture-session");
	if (localValue !== "local-value" || sessionValue !== "session-value") {
		throw new Error("Storage virtualization contract failed");
	}

	return `local:${localValue}|session:${sessionValue}`;
}

async function runDynamicImportCheck() {
	const loadedModule = await import("./dynamic-module.js");
	if (
		loadedModule.dynamicValue !== "dynamic-value" ||
		loadedModule.describeDynamicModule() !== "module-loaded"
	) {
		throw new Error("Dynamic import contract failed");
	}

	return `value:${loadedModule.dynamicValue}|describe:${loadedModule.describeDynamicModule()}`;
}

function runWorkerCheck() {
	return new Promise((resolve, reject) => {
		const worker = new Worker("/worker.js");
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			worker.terminate();
			reject(new Error("Worker message timed out"));
		}, 10_000);

		const finish = (callback, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			worker.terminate();
			callback(value);
		};

		worker.addEventListener("message", (event) => {
			if (event.data !== "worker:ping") {
				finish(reject, new Error("Unexpected Worker message"));
				return;
			}

			finish(resolve, "message:worker:ping");
		});
		worker.addEventListener("error", () => {
			finish(reject, new Error("Worker failed"));
		});
		worker.postMessage("ping");
	});
}

function runIframeCheck() {
	return new Promise((resolve, reject) => {
		const frame = document.querySelector("#nested-frame");
		if (!(frame instanceof HTMLIFrameElement)) {
			reject(new Error("Nested iframe is missing"));
			return;
		}

		let settled = false;
		let sent = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			window.removeEventListener("message", onMessage);
			frame.removeEventListener("load", sendMessage);
			reject(new Error("Nested iframe message timed out"));
		}, 10_000);

		const finish = (callback, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			window.removeEventListener("message", onMessage);
			frame.removeEventListener("load", sendMessage);
			callback(value);
		};

		const sendMessage = () => {
			if (sent || !frame.contentWindow) return;
			sent = true;
			frame.contentWindow.postMessage("parent-ping", "*");
		};

		const onMessage = (event) => {
			if (event.data?.type !== "nested-iframe-reply") return;

			const sameVirtualOrigin =
				event.origin === event.data.childOrigin &&
				event.data.receivedOrigin === event.data.childOrigin;
			if (!sameVirtualOrigin) {
				finish(reject, new Error("Nested iframe origin virtualization failed"));
				return;
			}

			finish(resolve, `same-origin:1|origin:${event.origin}`);
		};

		window.addEventListener("message", onMessage);
		frame.addEventListener("load", sendMessage, { once: true });
		try {
			if (frame.contentDocument?.readyState === "complete") sendMessage();
		} catch {
			// Wait for the load event if the browser keeps the nested document opaque.
		}
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
	setResult("sse-result", await runEventSourceCheck());
	setResult("cookie-result", await runCookieCheck());
	setResult("storage-result", runStorageCheck());
	setResult("dynamic-result", await runDynamicImportCheck());
	setResult("worker-result", await runWorkerCheck());
	setResult("iframe-result", await runIframeCheck());
}

runCompatibilityChecks().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	setResult("error-result", message);
	console.error(error);
});
