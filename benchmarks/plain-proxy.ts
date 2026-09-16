const port = Number(process.env.BENCH_PROXY_PORT);
const providerUrl = process.env.BENCH_PROXY_PROVIDER_URL;
const tenantToken = process.env.BENCH_PROXY_TENANT_TOKEN;
const providerToken = process.env.BENCH_PROXY_PROVIDER_TOKEN;

if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new Error("BENCH_PROXY_PORT must be a valid port");
}
if (!providerUrl || !tenantToken || !providerToken) {
  throw new Error("plain proxy URL and tokens are required");
}

Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 60,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    if (request.headers.get("authorization") !== `Bearer ${tenantToken}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    try {
      const upstream = await fetch(providerUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${providerToken}`,
          "content-type": request.headers.get("content-type") ?? "application/json",
        },
        body: request.body,
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers,
      });
    } catch {
      return Response.json({ error: "provider unavailable" }, { status: 502 });
    }
  },
});
