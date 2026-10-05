import { afterEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
    domains = { list: vi.fn().mockResolvedValue({ data: { data: [] } }) };
  },
}));

import {
  esc,
  maskEmail,
  sendOfferAcceptedEmail,
  sendVerificationEmail,
} from "../src/services/email.service.js";

describe("email service privacy (A6)", () => {
  afterEach(() => {
    sendMock.mockReset();
  });

  it("esc() escapes HTML special characters", () => {
    expect(esc("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;");
    expect(esc('a & "b"')).toBe("a &amp; &quot;b&quot;");
  });

  it("maskEmail() hides the local part of an address", () => {
    const masked = maskEmail("secret.person@example.com");
    expect(masked).not.toBe("secret.person@example.com");
    expect(masked).not.toContain("secret.person");
    expect(masked).toContain("@example.com");
  });

  it("escapes user-controlled fields in HTML email bodies", async () => {
    sendMock.mockResolvedValue({ data: { id: "id-1" }, error: null });
    await sendOfferAcceptedEmail({
      buyerEmail: "buyer@example.com",
      buyerName: "<b>x</b>",
      propertyTitle: "<script>alert(1)</script>",
      offeredAmount: 1000,
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [args] = sendMock.mock.calls[0];
    expect(args.html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(args.html).not.toContain("<b>x</b>");
    expect(args.html).not.toContain("<script>alert(1)</script>");
    expect(args.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("does not leak the full recipient email in error logs", async () => {
    sendMock.mockRejectedValueOnce(new Error("smtp failure"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      sendVerificationEmail({
        userEmail: "secret.person@example.com",
        userName: "Ana",
        token: "tok",
      }),
    ).rejects.toThrow();

    const logged = [...errorSpy.mock.calls, ...logSpy.mock.calls]
      .flat()
      .join(" ");
    expect(logged).not.toContain("secret.person@example.com");

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});
