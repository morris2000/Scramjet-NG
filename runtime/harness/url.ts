export function createProxyUrl(
  proxyOrigin: string,
  targetUrl: string,
): string {
  const encodedTarget = encodeURIComponent(targetUrl);
  return `${proxyOrigin}/scramjet/${encodedTarget}`;
}

export function getTargetUrl(): string {
  return process.env.FIXTURE_URL ?? "http://127.0.0.1:3000";
}
