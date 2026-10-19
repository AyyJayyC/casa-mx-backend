import { describe, it, expect, vi, afterEach } from "vitest";

describe("EMAIL_DISABLED", () => {
  afterEach(() => {
    delete process.env.EMAIL_DISABLED;
    vi.doUnmock("resend");
    vi.resetModules();
  });

  it("skips Resend and reports unconfigured when disabled", async () => {
    process.env.EMAIL_DISABLED = "true";
    vi.resetModules();

    const send = vi.fn().mockRejectedValue(new Error("Resend must not be called"));
    vi.doMock("resend", () => ({
      Resend: class {
        emails = { send };
        domains = { list: vi.fn() };
      },
    }));

    const svc = await import("../src/services/email.service.js");

    expect(svc.isConfigured()).toBe(false);
    await expect(
      svc.sendVerificationEmail({
        userEmail: "test@example.com",
        userName: "Test",
        token: "token",
      }),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
