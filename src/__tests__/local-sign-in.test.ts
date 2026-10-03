import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(), listUsers: vi.fn(), generateLink: vi.fn(), verifyOtp: vi.fn(), exchange: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  adminConfigured: mocks.configured,
  supabaseAdmin: () => ({ auth: { admin: { listUsers: mocks.listUsers, generateLink: mocks.generateLink } } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { verifyOtp: mocks.verifyOtp, exchangeCodeForSession: mocks.exchange } }),
}));
import { POST } from "@/app/api/dev/sign-in/route";
import { GET } from "@/app/auth/callback/route";
import { signInError } from "@/lib/auth/sign-in";

const EMAIL = "owner@example.com";
function request(origin = "http://localhost:3000", email = EMAIL, url = "http://localhost:3000/api/dev/sign-in") {
  return new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DEV_SIGN_IN_EMAIL", EMAIL);
  mocks.configured.mockReturnValue(true);
  mocks.listUsers.mockResolvedValue({ data: { users: [{ email: EMAIL }] }, error: null });
  mocks.generateLink.mockResolvedValue({ data: { properties: { hashed_token: "private-token" } }, error: null });
  mocks.verifyOtp.mockResolvedValue({ error: null });
  mocks.exchange.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("local sign-in boundaries", () => {
  it.each(["production", "test"])("is unavailable in %s, without reaching the admin client", async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    expect((await POST(request())).status).toBe(404);
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });
  it("is disabled unless one account is explicitly configured", async () => {
    vi.stubEnv("DEV_SIGN_IN_EMAIL", "");
    expect((await POST(request())).status).toBe(404);
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });
  it.each([
    ["https://other.example", "http://localhost:3000/api/dev/sign-in"],
    ["http://192.168.1.2:3000", "http://192.168.1.2:3000/api/dev/sign-in"],
    ["", "http://localhost:3000/api/dev/sign-in"],
  ])("rejects nonlocal or cross-origin requests", async (origin, url) => {
    expect((await POST(request(origin, EMAIL, url))).status).toBe(403);
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });
  it("cannot impersonate another email or create a missing account", async () => {
    expect((await POST(request(undefined, "someone@example.com"))).status).toBe(403);
    mocks.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
    expect((await POST(request())).status).toBe(404);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });
  it("verifies the one-time token on the cookie-bound client without returning it", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "private-token" });
  });
  it("does not report success when verification fails", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: new Error("Token expired") });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Token expired" });
  });
  it("explains an unavailable auth server", () => {
    expect(signInError(new Error("Failed to fetch"))).toContain("Supabase project is running");
  });
});

describe("email-link return destinations", () => {
  it.each(["//evil.example", "/\\evil.example", "/\n/evil.example"])("rejects external destination %j", async (next) => {
    const response = await GET(new Request(`http://localhost:3000/auth/callback?code=valid&next=${encodeURIComponent(next)}`));
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });
  it("preserves a safe return path and flags unusable email links", async () => {
    expect((await GET(new Request("http://localhost:3000/auth/callback?code=valid&next=/recommend"))).headers.get("location")).toBe("http://localhost:3000/recommend");
    mocks.exchange.mockResolvedValue({ error: new Error("Expired") });
    expect((await GET(new Request("http://localhost:3000/auth/callback?code=expired"))).headers.get("location")).toBe("http://localhost:3000/auth/sign-in?error=link");
  });
});
