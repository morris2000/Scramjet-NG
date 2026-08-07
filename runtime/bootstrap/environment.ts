export interface RuntimeEnvironment {
  proxyOrigin: string;
  targetOrigin: string;
  development: boolean;
}

export function loadRuntimeEnvironment(): RuntimeEnvironment {
  return {
    proxyOrigin:
      process.env.SCRAMJET_PROXY_ORIGIN ?? "http://127.0.0.1:8080",
    targetOrigin:
      process.env.FIXTURE_URL ?? "http://127.0.0.1:3000",
    development: true,
  };
}
