import { createGatewayPolicy } from "../../runtime/gateway/index.ts";
import {
	listenCompatibilityFixture,
	type ListeningCompatibilityFixture,
} from "../../fixtures/compatibility-app/server/index.ts";
import {
	listenRuntimeCompositionServer,
	type ListeningRuntimeCompositionServer,
} from "../../runtime/composition/index.ts";

export default async function globalSetup(): Promise<() => Promise<void>> {
	const fixture: ListeningCompatibilityFixture = await listenCompatibilityFixture({
		host: "127.0.0.1",
		port: 3000,
	});

	try {
		const runtime: ListeningRuntimeCompositionServer =
			await listenRuntimeCompositionServer({
				root: process.env.SCRAMJET_ASSET_ROOT ?? "runtime-assets",
				targetOrigin: fixture.origin,
				host: "127.0.0.1",
				port: 8080,
				policy: createGatewayPolicy({
					development: true,
					allowedHosts: ["127.0.0.1"],
					allowLoopback: true,
				}),
			});

		return async () => {
			await runtime.close();
			await fixture.close();
		};
	} catch (error) {
		await fixture.close();
		throw error;
	}
}
