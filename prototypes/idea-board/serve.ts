// Serves the standalone idea board prototype for `nep preview up`.
// /api/chat streams from Strata, the local model on nika, so nothing leaves the machine.
const page = Bun.file(new URL("./index.html", import.meta.url));
const MODEL_URL = process.env.IDEA_BOARD_MODEL_URL ?? "http://127.0.0.1:8090/v1/chat/completions";

Bun.serve({
  port: Number(process.env.PORT ?? 4780),
  hostname: process.env.HOST ?? "127.0.0.1",
  // The model can take over a minute to load before its first byte.
  idleTimeout: 255,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    // Demo playables for the Grow board (scripts: apps/server/scripts/grow-seed-demo.ts).
    const demo = /^\/demos\/([a-z0-9-]+)$/.exec(pathname);
    if (demo) {
      const file = Bun.file(new URL(`./demos/${demo[1]}.html`, import.meta.url));
      if (await file.exists()) {
        return new Response(file, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return new Response("no such demo", { status: 404 });
    }
    if (pathname === "/api/chat" && request.method === "POST") {
      const { messages } = await request.json();
      const upstream = await fetch(MODEL_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "qwen",
          stream: true,
          max_tokens: 4000,
          temperature: 0.6,
          chat_template_kwargs: { enable_thinking: false },
          messages,
        }),
        signal: request.signal,
      }).catch(() => null);
      if (!upstream?.ok || !upstream.body)
        return new Response("model unavailable", { status: 502 });
      return new Response(upstream.body, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    }
    return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
