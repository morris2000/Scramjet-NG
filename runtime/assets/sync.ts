import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	DEFAULT_RUNTIME_ASSET_CDN,
	DEFAULT_SCRAMJET_RUNTIME_PINS,
	getPinnedRuntimePackages,
	type PinnedRuntimeFile,
	type PinnedRuntimePackage,
	type ScramjetRuntimePins,
} from "./pins.ts";
import {
	normalizeRuntimeAssetPath,
	type RuntimeAssetManifestOptions,
} from "./manifest.ts";

type FetchLike = (
	input: string,
	init?: RequestInit
) => Promise<Response>;

export interface RuntimeAssetSyncOptions extends RuntimeAssetManifestOptions {
	readonly root: string;
	readonly pins?: ScramjetRuntimePins;
	readonly fetch?: FetchLike;
	readonly timeoutMs?: number;
}

export interface SyncedRuntimeAsset {
	readonly packageName: string;
	readonly version: string;
	readonly packagePath: string;
	readonly runtimePath: string;
	readonly url: string;
	readonly size: number;
	readonly sha256: string;
}

export interface RuntimeAssetSyncResult {
	readonly root: string;
	readonly transport: "libcurl" | "epoxy";
	readonly files: readonly SyncedRuntimeAsset[];
}

const PACKAGE_NAME_PATTERN = /^@mercuryworkshop\/[a-z0-9-]+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function validatePackagePin(packagePin: PinnedRuntimePackage): void {
	if (!PACKAGE_NAME_PATTERN.test(packagePin.packageName)) {
		throw new TypeError(
			`Unsupported runtime package name: ${packagePin.packageName}`
		);
	}
	if (!VERSION_PATTERN.test(packagePin.version)) {
		throw new TypeError(
			`Runtime package version must be exact: ${packagePin.packageName}`
		);
	}
	if (packagePin.license !== "AGPL-3.0-only") {
		throw new TypeError(
			`Unexpected runtime package license: ${packagePin.packageName}`
		);
	}
}

function validatePinnedFile(file: PinnedRuntimeFile): string {
	if (
		!file.packagePath.startsWith("/dist/") ||
		file.packagePath.includes("\\") ||
		file.packagePath.split("/").some((segment) => segment === "..")
	) {
		throw new TypeError(`Invalid upstream package path: ${file.packagePath}`);
	}

	const runtimePath = normalizeRuntimeAssetPath(file.runtimePath);
	if (!Number.isSafeInteger(file.size) || file.size <= 0) {
		throw new TypeError(`Invalid expected asset size: ${runtimePath}`);
	}
	if (!SHA256_PATTERN.test(file.sha256)) {
		throw new TypeError(`Invalid expected asset hash: ${runtimePath}`);
	}
	return runtimePath;
}

function createAssetUrl(
	packagePin: PinnedRuntimePackage,
	file: PinnedRuntimeFile
): string {
	const packageName = packagePin.packageName;
	const packagePath = file.packagePath
		.split("/")
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	return `${DEFAULT_RUNTIME_ASSET_CDN}/${packageName}@${encodeURIComponent(
		packagePin.version
	)}/${packagePath}`;
}

function resolveRuntimeAssetFile(root: string, runtimePath: string): string {
	const absoluteRoot = resolve(root);
	const normalizedPath = normalizeRuntimeAssetPath(runtimePath);
	const candidate = resolve(absoluteRoot, `.${normalizedPath}`);
	const relativePath = relative(absoluteRoot, candidate);
	if (
		candidate === absoluteRoot ||
		isAbsolute(relativePath) ||
		relativePath === ".." ||
		relativePath.startsWith("..\\") ||
		relativePath.startsWith("../")
	) {
		throw new Error(`Runtime asset escapes configured root: ${runtimePath}`);
	}
	return candidate;
}

async function downloadPinnedFile(
	packagePin: PinnedRuntimePackage,
	file: PinnedRuntimeFile,
	fetchImpl: FetchLike,
	timeoutMs: number
): Promise<{ asset: SyncedRuntimeAsset; content: Uint8Array }> {
	const runtimePath = validatePinnedFile(file);
	const url = createAssetUrl(packagePin, file);
	const response = await fetchImpl(url, {
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(
			`Failed to download ${packagePin.packageName}@${packagePin.version}${file.packagePath}: ${response.status}`
		);
	}

	const content = new Uint8Array(await response.arrayBuffer());
	if (content.byteLength !== file.size) {
		throw new Error(
			`Runtime asset size mismatch for ${runtimePath}: expected ${file.size}, got ${content.byteLength}`
		);
	}

	const sha256 = createHash("sha256").update(content).digest("hex");
	if (sha256 !== file.sha256) {
		throw new Error(
			`Runtime asset hash mismatch for ${runtimePath}: expected ${file.sha256}, got ${sha256}`
		);
	}

	return {
		asset: {
			packageName: packagePin.packageName,
			version: packagePin.version,
			packagePath: file.packagePath,
			runtimePath,
			url,
			size: content.byteLength,
			sha256,
		},
		content,
	};
}

/**
 * Download and verify a complete pinned runtime set before writing any file.
 * A failed download, size check, or SHA-256 check leaves the asset root
 * untouched.
 */
export async function syncRuntimeAssets(
	options: RuntimeAssetSyncOptions
): Promise<RuntimeAssetSyncResult> {
	const timeoutMs = options.timeoutMs ?? 120_000;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new TypeError("timeoutMs must be a positive number");
	}

	const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
	if (!fetchImpl) {
		throw new Error("Fetch API is required to sync runtime assets");
	}

	const transport = options.transport ?? "libcurl";
	const packages = getPinnedRuntimePackages(options.pins, transport);
	const seenPaths = new Set<string>();
	const downloads: Array<{
		asset: SyncedRuntimeAsset;
		content: Uint8Array;
	}> = [];

	for (const packagePin of packages) {
		validatePackagePin(packagePin);
		for (const file of packagePin.files) {
			const runtimePath = validatePinnedFile(file);
			if (seenPaths.has(runtimePath)) {
				throw new TypeError(`Runtime asset path is duplicated: ${runtimePath}`);
			}
			seenPaths.add(runtimePath);
			downloads.push(
				await downloadPinnedFile(
					packagePin,
					file,
					fetchImpl,
					timeoutMs
				)
			);
		}
	}

	const root = resolve(options.root);
	for (const download of downloads) {
		const file = resolveRuntimeAssetFile(root, download.asset.runtimePath);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, download.content);
	}

	return {
		root,
		transport,
		files: downloads.map(({ asset }) => asset),
	};
}

async function runCli(): Promise<void> {
	const root = process.env.SCRAMJET_ASSET_ROOT ?? "runtime-assets";
	const transport = process.env.SCRAMJET_TRANSPORT === "epoxy" ? "epoxy" : "libcurl";
	const result = await syncRuntimeAssets({ root, transport });
	console.log(JSON.stringify(result, null, 2));
}

const invokedPath = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: null;
if (invokedPath === import.meta.url) {
	runCli().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
}

