import { subscribe } from "./redis";

/**
 * Streams a Redis channel to the browser as Server-Sent Events until the client disconnects.
 * `snapshot` (optional) is read after the subscription is live and sent first; messages that
 * arrive meanwhile are held and sent right after it, so the client never misses an update.
 */
export function sseFromChannel(
  req: Request,
  channel: string,
  snapshot?: () => Promise<unknown>,
  /**
   * Ends the stream after the message it returns true for. Proxies and tunnels (e.g. Cloudflare) can hold
   * the last small chunks of an open stream; closing it flushes them, so the final status always arrives.
   */
  isLast?: (raw: string) => boolean,
): Response {
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
      let ended = false;
      const end = () => {
        ended = true;
        cleanup();
        try {
          controller.close();
        } catch {}
      };
      const emit = (msg: string) => {
        if (ended) return;
        send(`data: ${msg}\n\n`);
        if (isLast?.(msg)) end();
      };
      const sub = subscribe(channel, (msg) => (live ? emit(msg) : held.push(msg)));
      const ping = setInterval(() => send(": ping\n\n"), 25_000); // keeps proxies from closing idle streams
      cleanup = () => {
        clearInterval(ping);
        sub.close();
        cleanup = () => {};
      };
      req.signal.addEventListener("abort", end);
      await sub.ready;
      if (snapshot) emit(JSON.stringify(await snapshot()));
      for (const msg of held) emit(msg);
      live = true;
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // nginx-style proxies: don't buffer the stream
    },
  });
}
