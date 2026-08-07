import {
	DEFAULT_BROWSER_RUNTIME_ASSETS,
	type BrowserTransportKind,
} from "../adapter/official.ts";

export const DEFAULT_RUNTIME_ASSET_CDN =
	"https://cdn.jsdelivr.net/npm";

export interface PinnedRuntimeFile {
	readonly packagePath: string;
	readonly runtimePath: string;
	readonly contentType: string;
	readonly size: number;
	readonly sha256: string;
}

export interface PinnedRuntimePackage {
	readonly packageName: string;
	readonly version: string;
	readonly license: "AGPL-3.0-only";
	readonly files: readonly PinnedRuntimeFile[];
}

export interface ScramjetRuntimePins {
	readonly core: PinnedRuntimePackage;
	readonly controller: PinnedRuntimePackage;
	readonly utils: PinnedRuntimePackage;
	readonly libcurl: PinnedRuntimePackage;
	readonly epoxy: PinnedRuntimePackage;
}

export const DEFAULT_SCRAMJET_RUNTIME_PINS: ScramjetRuntimePins = {
	core: {
		packageName: "@mercuryworkshop/scramjet",
		version: "2.0.67-alpha.2",
		license: "AGPL-3.0-only",
		files: [
			{
				packagePath: "/dist/scramjet.js",
				runtimePath: DEFAULT_BROWSER_RUNTIME_ASSETS.scramjetBundlePath,
				contentType: "application/javascript",
				size: 227109,
				sha256:
					"e116b8adbdae9e9d9bee6abd8370990faa2615796c2e8fc0b7b8942537c0d92e",
			},
			{
				packagePath: "/dist/scramjet.wasm",
				runtimePath: DEFAULT_BROWSER_RUNTIME_ASSETS.scramjetWasmPath,
				contentType: "application/wasm",
				size: 586279,
				sha256:
					"c8740c340a506686d9e46feb82894ab710cf57cd20564d001d0aef04310661e8",
			},
		],
	},
	controller: {
		packageName: "@mercuryworkshop/scramjet-controller",
		version: "0.0.14",
		license: "AGPL-3.0-only",
		files: [
			{
				packagePath: "/dist/controller.api.js",
				runtimePath: DEFAULT_BROWSER_RUNTIME_ASSETS.controllerApiPath,
				contentType: "application/javascript",
				size: 17086,
				sha256:
					"9bc38bc6dce704ebf71fd7c418151bf7192b0a6c10e15f1037c77e146c163c91",
			},
			{
				packagePath: "/dist/controller.inject.js",
				runtimePath: DEFAULT_BROWSER_RUNTIME_ASSETS.controllerInjectPath,
				contentType: "application/javascript",
				size: 6436,
				sha256:
					"4744bb39bcfcdbe2baa43f26c760abc5c6248475da5086b2be0eefcd1724fb87",
			},
			{
				packagePath: "/dist/controller.sw.js",
				runtimePath: DEFAULT_BROWSER_RUNTIME_ASSETS.controllerSwPath,
				contentType: "application/javascript",
				size: 4576,
				sha256:
					"805309725993d31a8e540c20c575dcc176a86e7fdfc6b9d69ccf4ee8f94c736d",
			},
		],
	},
	utils: {
		packageName: "@mercuryworkshop/scramjet-utils",
		version: "0.0.3",
		license: "AGPL-3.0-only",
		files: [
			{
				packagePath: "/dist/scramjet-utils.js",
				runtimePath: DEFAULT_BROWSER_RUNTIME_ASSETS.scramjetUtilsBundlePath,
				contentType: "application/javascript",
				size: 10847,
				sha256:
					"58a134a8781e871436dc7041ef16dd56570c3edd8283da80c3bbdaa90778791a",
			},
		],
	},
	libcurl: {
		packageName: "@mercuryworkshop/libcurl-transport",
		version: "2.0.5",
		license: "AGPL-3.0-only",
		files: [
			{
				packagePath: "/dist/index.js",
				runtimePath: DEFAULT_BROWSER_RUNTIME_ASSETS.transportPath,
				contentType: "application/javascript",
				size: 2112269,
				sha256:
					"bbcc91982ee9e25bea3491500ab2ecba54098b5e08f3aba827b1c775f5654806",
			},
		],
	},
	epoxy: {
		packageName: "@mercuryworkshop/epoxy-transport",
		version: "3.0.1",
		license: "AGPL-3.0-only",
		files: [
			{
				packagePath: "/dist/index.js",
				runtimePath: "/clients/epoxy-client.js",
				contentType: "application/javascript",
				size: 1746810,
				sha256:
					"5a0c9d035fa8eed9fa6b70764fad0b0b03eba50545239ef176e1606373e1ac7c",
			},
		],
	},
};

export function getPinnedRuntimePackages(
	pins: ScramjetRuntimePins = DEFAULT_SCRAMJET_RUNTIME_PINS,
	transport: BrowserTransportKind = "libcurl"
): readonly PinnedRuntimePackage[] {
	return [
		pins.core,
		pins.controller,
		pins.utils,
		transport === "epoxy" ? pins.epoxy : pins.libcurl,
	];
}

