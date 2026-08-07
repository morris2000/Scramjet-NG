import {
	DEFAULT_BROWSER_RUNTIME_ASSETS,
	type BrowserRuntimeAssets,
	type BrowserTransportKind,
} from "../adapter/official.ts";

export interface RuntimeHarnessSourceOptions {
	readonly targetUrl: string;
	readonly transport: BrowserTransportKind;
	readonly assets?: Partial<BrowserRuntimeAssets>;
}

function encodeScriptValue(value: string): string {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

function resolveTargetUrl(value: string): string {
	const target = new URL(value);
	if (target.protocol !== "http:" && target.protocol !== "https:") {
		throw new TypeError("Runtime harness target must use http or https");
	}
	if (target.username || target.password) {
		throw new TypeError("Runtime harness target must not contain credentials");
	}
	return target.href;
}

export function createRuntimeHarnessSource(
	options: RuntimeHarnessSourceOptions
): string {
	const assets = {
		...DEFAULT_BROWSER_RUNTIME_ASSETS,
		...options.assets,
	};
	const targetUrl = resolveTargetUrl(options.targetUrl);
	const transportNamespace =
		options.transport === "epoxy" ? "EpoxyTransport" : "LibcurlTransport";
	const transportConstructor =
		options.transport === "epoxy" ? "EpoxyClient" : "LibcurlClient";

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Scramjet-NG Runtime Harness</title>
</head>
<body>
  <h1>Scramjet-NG Runtime Harness</h1>
  <p id="runtime-status" data-state="booting">Starting runtime…</p>
  <iframe id="scramjet-frame" title="Scramjet fixture" style="width:100%;height:30rem;border:1px solid #ccc"></iframe>
  <script>
    (() => {
      const targetUrl = ${encodeScriptValue(targetUrl)};
      const status = document.querySelector("#runtime-status");
      const frameElement = document.querySelector("#scramjet-frame");
      const scripts = [
        ${encodeScriptValue(assets.scramjetBundlePath)},
        ${encodeScriptValue(assets.controllerApiPath)},
        ${encodeScriptValue(assets.scramjetUtilsBundlePath)},
        ${encodeScriptValue(assets.transportPath)},
      ];

      const setState = (state, message) => {
        status.dataset.state = state;
        status.textContent = message;
      };

      const loadScript = (path) => new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = path;
        script.async = false;
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load runtime asset: " + path));
        document.head.appendChild(script);
      });

      const start = async () => {
        if (!(frameElement instanceof HTMLIFrameElement)) {
          throw new Error("Runtime harness iframe is missing");
        }

        for (const script of scripts) {
          await loadScript(script);
        }

        const registration = await navigator.serviceWorker.register(
          ${encodeScriptValue(assets.serviceWorkerPath)},
          { type: "classic", updateViaCache: "none" },
        );
        const readyRegistration = await navigator.serviceWorker.ready;
        const serviceWorker = readyRegistration.active ?? registration.active;
        if (!serviceWorker) {
          throw new Error("Scramjet Service Worker is not active");
        }

        const transportModule = window[${encodeScriptValue(transportNamespace)}];
        const Transport = transportModule?.[${encodeScriptValue(transportConstructor)}];
        if (!Transport) {
          throw new Error("Scramjet transport constructor is missing");
        }

        const wispUrl = new URL(${encodeScriptValue(assets.wispPath)}, window.location.href);
        wispUrl.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const transport = new Transport({ wisp: wispUrl.href });
        const controllerApi = window.$scramjetController;
        if (!controllerApi?.config || !controllerApi.Controller) {
          throw new Error("Scramjet controller API is missing");
        }
        controllerApi.config.injectPath = ${encodeScriptValue(assets.controllerInjectPath)};
        controllerApi.config.wasmPath = ${encodeScriptValue(assets.scramjetWasmPath)};
        controllerApi.config.scramjetPath = ${encodeScriptValue(assets.scramjetBundlePath)};
        const controller = new controllerApi.Controller({
          serviceworker: serviceWorker,
          transport,
        });
        await controller.wait();

        const frame = controller.createFrame(frameElement);
        await Promise.resolve(frame.go(targetUrl));
        window.__scramjetNgRuntime = {
          registration,
          controller,
          frame,
          targetUrl,
        };
        setState("ready", "Runtime ready");
      };

      start().catch((error) => {
        console.error(error);
        setState("failed", error instanceof Error ? error.message : String(error));
      });
    })();
  </script>
</body>
</html>
`;
}
