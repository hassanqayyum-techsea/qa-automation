import { getUser } from "~/lib/auth";
import { LIVE } from "~/lib/redis";
import { sseFromChannel } from "~/lib/sse";

// Events only say "something changed"; the browser re-renders its page, which re-checks permissions.
export async function GET(req: Request) {
  if (!(await getUser())) return new Response("Sign in first.", { status: 401 });
  return sseFromChannel(req, LIVE);
}
