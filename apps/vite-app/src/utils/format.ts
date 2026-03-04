export function formatTitle(str: string): string {
  if (!str) return str;
  return str
    .split("_")
    .map((word) => {
      // Keep simple words lowercase? We can Title Case them for cleaner look.
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}
