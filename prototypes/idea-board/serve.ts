// Serves the standalone idea board prototype for `nep preview up`.
const page = Bun.file(new URL("./index.html", import.meta.url));

Bun.serve({
  port: Number(process.env.PORT ?? 4780),
  hostname: process.env.HOST ?? "127.0.0.1",
  fetch: () => new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } }),
});
