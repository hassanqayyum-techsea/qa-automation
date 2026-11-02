import { subscribe } from "./redis";

/**
 * Streams a Redis channel to the browser as Server-Sent Events until the client disconnects.
 * `snapshot` (optional) is read after the subscription is live and sent first; messages that
 * arrive meanwhile are held and sent right after it, so the client never misses an update.
 */
export function sseFromChannel(req: Request, channel: string, snapshot?: () => Promise<unknown>): Response {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup(); // stream already closed
        }
      };
      send(": connected\n\n");
      const held: string[] = [];
      let live = false;
      const sub = subscribe(channel, (msg) => (live ? send(`data: ${msg}\n\n`) : held.push(msg)));
      const ping = setInterval(() => send(": ping\n\n"), 25_000); // keeps proxies from closing idle streams
      cleanup = () => {
        clearInterval(ping);
        sub.close();
        cleanup = () => {};
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      await sub.ready;
      if (snapshot) send(`data: ${JSON.stringify(await snapshot())}\n\n`);
      for (const msg of held) send(`data: ${msg}\n\n`);
      live = true;
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
