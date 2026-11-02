import { describe, expect, it } from "vitest";
import { buildApiRequestHeaders } from "./apiRequestHeaders";

describe("buildApiRequestHeaders", () => {
  it("builds a new Headers with only the default content type for empty input", () => {
    const headers = buildApiRequestHeaders(undefined, null);

    expect(headers).toBeInstanceOf(Headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.has("Authorization")).toBe(false);
  });

  it("preserves raw object headers without mutating the frozen input", () => {
    const input = Object.freeze({
      "Content-Type": "application/vnd.echotalk+json",
      "X-Client-Version": "1.2.3",
    });

    const headers = buildApiRequestHeaders(input, "token-1");

    expect(headers.get("Content-Type")).toBe("application/vnd.echotalk+json");
    expect(headers.get("X-Client-Version")).toBe("1.2.3");
    expect(headers.get("Authorization")).toBe("Bearer token-1");
    expect(input).toEqual({
      "Content-Type": "application/vnd.echotalk+json",
      "X-Client-Version": "1.2.3",
    });
  });

  it("preserves repeated array entries and standard Headers multi-value semantics", () => {
    const input: [string, string][] = [
      ["X-Multi", "one"],
      ["X-Multi", "two"],
    ];

    const headers = buildApiRequestHeaders(input, null);

    expect(headers.get("X-Multi")).toBe("one, two");
    expect(input).toEqual([
      ["X-Multi", "one"],
      ["X-Multi", "two"],
    ]);
  });

  it("copies a Headers instance without sharing mutable state", () => {
    const input = new Headers({
      Authorization: "Bearer caller-token",
      "X-Input": "original",
    });

    const headers = buildApiRequestHeaders(input, null);
    headers.set("X-Input", "changed");
    headers.append("X-Only-Output", "yes");

    expect(headers).not.toBe(input);
    expect(headers.get("Authorization")).toBe("Bearer caller-token");
    expect(headers.get("X-Input")).toBe("changed");
    expect(input.get("X-Input")).toBe("original");
    expect(input.has("X-Only-Output")).toBe(false);
  });

  it("keeps an explicit authorization header when no token is available", () => {
    const headers = buildApiRequestHeaders(
      { Authorization: "Basic caller-credentials", "X-Custom": "kept" },
      null,
    );

    expect(headers.get("Authorization")).toBe("Basic caller-credentials");
    expect(headers.get("X-Custom")).toBe("kept");
  });

  it("sets bearer authentication when a token is available", () => {
    const headers = buildApiRequestHeaders(
      { Authorization: "Bearer caller-token", "X-Custom": "kept" },
      "access-token",
    );

    expect(headers.get("Authorization")).toBe("Bearer access-token");
    expect(headers.get("X-Custom")).toBe("kept");
  });

  it("does not mutate a frozen Headers-initializer array", () => {
    const firstEntry: [string, string] = ["X-Immutable", "one"];
    const secondEntry: [string, string] = ["X-Immutable", "two"];
    const input: [string, string][] = [firstEntry, secondEntry];
    Object.freeze(firstEntry);
    Object.freeze(secondEntry);
    Object.freeze(input);

    const headers = buildApiRequestHeaders(input, "token-1");

    expect(headers.get("X-Immutable")).toBe("one, two");
    expect(input[0]).toEqual(["X-Immutable", "one"]);
    expect(input[1]).toEqual(["X-Immutable", "two"]);
  });

  it("returns independent Headers on each call", () => {
    const first = buildApiRequestHeaders({ "X-Call": "first" }, null);
    const second = buildApiRequestHeaders({ "X-Call": "second" }, null);

    first.set("X-Mutation", "first-only");

    expect(first).not.toBe(second);
    expect(first.get("X-Call")).toBe("first");
    expect(second.get("X-Call")).toBe("second");
    expect(second.has("X-Mutation")).toBe(false);
  });
});
