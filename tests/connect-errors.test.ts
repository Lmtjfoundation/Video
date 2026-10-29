import { describe, expect, it } from "vitest";
import { connectErrorMessage } from "@/lib/oauth-config";

describe("connect errors", () => {
  it("a cancelled sign-in says so", () => {
    expect(connectErrorMessage("Instagram", new URLSearchParams({ error: "access_denied", error_reason: "user_denied" }))).toBe("Instagram linking was cancelled. Tap Connect to try again.");
  });
  it("any other refusal explains testers and the one-tap service", () => {
    const m = connectErrorMessage("Instagram", new URLSearchParams({ error: "invalid_request", error_description: "Insufficient developer role" }));
    expect(m).toContain("(Insufficient developer role)");
    expect(m).toContain("added as testers");
    expect(m).toContain("Admin → Integrations");
    expect(connectErrorMessage("LinkedIn", new URLSearchParams({ error: "server_error" }))).not.toContain("Meta");
  });
});
