const app = document.querySelector("#app");

function setResult(id, value) {
	const element = document.querySelector(`#${id}`);
	if (element) element.textContent = value;
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

async function runCompatibilityChecks() {
	document.title = "Scramjet-NG Compatibility Fixture";
	if (app) app.textContent = "Fixture loaded";

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
}

runCompatibilityChecks().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	setResult("error-result", message);
	console.error(error);
});
