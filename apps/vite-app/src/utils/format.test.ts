import { describe, it, expect } from "vitest";
import { formatTitle } from "./format";

describe("formatTitle", () => {
  it("should return falsy/empty input as is", () => {
    expect(formatTitle("")).toBe("");
    // @ts-expect-error testing runtime falsy values
    expect(formatTitle(null)).toBe(null);
    // @ts-expect-error testing runtime falsy values
    expect(formatTitle(undefined)).toBe(undefined);
  });

  it("should convert underscore separated words to title case separated by space", () => {
    expect(formatTitle("hello_world")).toBe("Hello World");
    expect(formatTitle("my_first_test")).toBe("My First Test");
  });

  it("should handle single word correctly", () => {
    expect(formatTitle("hello")).toBe("Hello");
  });

  it("should preserve upper/lower case in remaining characters of words", () => {
    expect(formatTitle("hElLo_wOrLd")).toBe("HElLo WOrLd");
    expect(formatTitle("HELLO_WORLD")).toBe("HELLO WORLD");
  });

  it("should handle strings containing numbers and special characters", () => {
    expect(formatTitle("user_123_id")).toBe("User 123 Id");
    expect(formatTitle("item_#1_status")).toBe("Item #1 Status");
  });

  it("should handle consecutive and surrounding underscores", () => {
    expect(formatTitle("hello__world")).toBe("Hello  World");
    expect(formatTitle("_hello_world_")).toBe(" Hello World ");
  });

  it("should handle strings already separated by spaces or without underscores", () => {
    expect(formatTitle("already Title Case")).toBe("Already Title Case");
  });
});
