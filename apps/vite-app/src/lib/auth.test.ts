import { describe, expect, it } from "vitest";
import { getAccessToken, setAccessTokenProvider } from "./auth";

describe("Auth token provider", () => {
  it("reflects login and logout state without a fixed production token", async () => {
    let token: string | null = "signed-in-token";
    const restore = setAccessTokenProvider(() => token);

    expect(await getAccessToken()).toBe("signed-in-token");
    token = null;
    expect(await getAccessToken()).toBeNull();

    restore();
  });
});
