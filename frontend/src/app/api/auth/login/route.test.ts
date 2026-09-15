import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  isSameOrigin: vi.fn(),
  setSessionCookie: vi.fn(),
  parseLogin: vi.fn(),
  allowLoginRequest: vi.fn(),
  loginMember: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  isSameOrigin: mock.isSameOrigin,
  setSessionCookie: mock.setSessionCookie,
}));
vi.mock("@/lib/account-fields", () => ({ parseLogin: mock.parseLogin }));
vi.mock("@/lib/rate-limit", () => ({ allowLoginRequest: mock.allowLoginRequest }));
vi.mock("@/lib/members", () => ({ loginMember: mock.loginMember }));

import { POST } from "./route";

const request = (body: unknown = {}) => new Request("https://docket.example/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://docket.example" },
  body: JSON.stringify(body),
});

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mock.isSameOrigin.mockReturnValue(true);
    mock.allowLoginRequest.mockReturnValue(true);
    mock.parseLogin.mockReturnValue({ ok: true, value: { email: "ada@example.com", password: "password123" } });
  });

  it("rejects a cross-site request before parsing or hashing a password", async () => {
    mock.isSameOrigin.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mock.allowLoginRequest).not.toHaveBeenCalled();
    expect(mock.parseLogin).not.toHaveBeenCalled();
    expect(mock.loginMember).not.toHaveBeenCalled();
  });

  it("enforces the rate limit before doing password work", async () => {
    mock.allowLoginRequest.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "busy" });
    expect(mock.parseLogin).not.toHaveBeenCalled();
    expect(mock.loginMember).not.toHaveBeenCalled();
  });

  it("returns field errors without attempting a database lookup", async () => {
    mock.parseLogin.mockReturnValue({ ok: false, errors: { email: "Enter your email address." } });

    const response = await POST(request({ email: "", password: "password123" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid", fields: { email: "Enter your email address." } });
    expect(mock.loginMember).not.toHaveBeenCalled();
  });

  it("does not reveal whether an account exists when credentials fail", async () => {
    mock.loginMember.mockResolvedValue({ ok: false, error: "wrong_password" });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "wrong_password" });
    expect(mock.setSessionCookie).not.toHaveBeenCalled();
  });

  it("creates a no-store session response after valid credentials", async () => {
    const session = { memberId: "member-1", name: "Ada", email: "ada@example.com", groups: [] };
    mock.loginMember.mockResolvedValue({ ok: true, session });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, name: "Ada" });
    expect(mock.loginMember).toHaveBeenCalledWith("ada@example.com", "password123", null);
    expect(mock.setSessionCookie).toHaveBeenCalledWith(response, session);
  });

  it("returns a retryable error when the account store is unavailable", async () => {
    mock.loginMember.mockRejectedValue(new Error("database unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(console.error).toHaveBeenCalled();
  });
});
