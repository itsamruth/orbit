const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isAllowedBrowserOrigin(
  requestOrigin: string | undefined,
  configuredOrigin: string,
): boolean {
  if (requestOrigin === configuredOrigin) return true;
  if (!requestOrigin || process.env.NODE_ENV === "production") return false;

  try {
    const request = new URL(requestOrigin);
    const configured = new URL(configuredOrigin);
    return (
      request.protocol === "http:" &&
      configured.protocol === "http:" &&
      LOOPBACK_HOSTS.has(request.hostname) &&
      LOOPBACK_HOSTS.has(configured.hostname)
    );
  } catch {
    return false;
  }
}
