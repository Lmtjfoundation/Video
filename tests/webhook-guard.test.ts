import { describe, expect, it } from "vitest";
import { isPrivateAddress, webhookUrlProblem } from "@/lib/platforms/webhook-guard";
import { postWebhook } from "@/lib/platforms/webhook-send";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.5", "[::1]",
  ])("blocks %s", (a) => expect(isPrivateAddress(a)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111"])("allows %s", (a) => expect(isPrivateAddress(a)).toBe(false));
});

describe("webhookUrlProblem", () => {
  it.each([
    "https://hooks.zapier.com/hooks/catch/123/abc/",
    "https://hook.eu1.make.com/abcdef",
    "https://discord.com/api/webhooks/1/abc",
    "https://example.com/path?token=1",
  ])("accepts %s", (u) => expect(webhookUrlProblem(u)).toBeNull());

  it.each([
    ["http://example.com/hook", "https"],
    ["ftp://example.com", "https"],
    ["not a url", "web address"],
    ["https://localhost/hook", "Internal"],
    ["https://foo.localhost/hook", "Internal"],
    ["https://127.0.0.1/hook", "Internal"],
    ["https://169.254.169.254/latest/meta-data", "Internal"],
    ["https://[::1]/hook", "Internal"],
    ["https://10.0.0.8/hook", "Internal"],
    ["https://metadata.google.internal/computeMetadata", "Internal"],
    ["https://printer.local/hook", "Internal"],
    ["https://user:pass@example.com/hook", "username"],
    ["https://example.com:8443/hook", "443"],
    ["https://intranet/hook", "full public domain"],
  ])("rejects %s", (u, why) => expect(webhookUrlProblem(u)).toContain(why));
});

describe("postWebhook", () => {
  it("refuses an internal address before opening any connection", async () => {
    await expect(postWebhook("https://127.0.0.1/hook", { a: 1 })).rejects.toThrow(/rejected/);
    await expect(postWebhook("http://example.com/hook", { a: 1 })).rejects.toThrow(/https/);
  });
});
