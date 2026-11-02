// Run: node --test lib/net.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedHost } from "./net.ts";

test("blocks internal hosts but allows public ones and the app's own host", () => {
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "metadata.google.internal", "[::1]", "fd00::1", "0.0.0.0"]) {
    assert.equal(isBlockedHost(h, "app.aijobexpert.com"), true, h);
  }
  for (const h of ["app.aijobexpert.com", "fonts.googleapis.com", "8.8.8.8", "172.32.0.1"]) {
    assert.equal(isBlockedHost(h, "app.aijobexpert.com"), false, h);
  }
  assert.equal(isBlockedHost("localhost", "localhost"), false, "a local app under test stays reachable");
});
