import { describe, expect, it, vi } from "vitest";
import { signOutAndRedirect } from "./navigation";

describe("signOutAndRedirect", () => {
  it("leaves for the sign-in page after a successful sign-out", async () => {
    const navigate = vi.fn();
    const signOut = vi.fn().mockResolvedValue({ data: { success: true }, error: null });

    expect(await signOutAndRedirect(signOut, { navigate })).toBe(true);
    expect(signOut).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/sign-in");
    expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]);
  });

  it("uses a safe custom destination and rejects unsafe ones", async () => {
    const navigate = vi.fn();
    const signOut = () => Promise.resolve({ error: null });

    await signOutAndRedirect(signOut, { navigate, to: "/sign-in?next=%2Finvite%2Ftrainer%2Fabc" });
    await signOutAndRedirect(signOut, { navigate, to: "https://evil.example" });

    expect(navigate.mock.calls).toEqual([["/sign-in?next=%2Finvite%2Ftrainer%2Fabc"], ["/sign-in"]]);
  });

  it("stays on the page when sign-out fails or throws", async () => {
    const navigate = vi.fn();

    expect(await signOutAndRedirect(() => Promise.resolve({ error: { status: 500 } }), { navigate })).toBe(false);
    expect(await signOutAndRedirect(() => Promise.reject(new TypeError("Failed to fetch")), { navigate })).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
