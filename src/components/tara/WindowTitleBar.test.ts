import { describe, expect, it } from "vitest";
import { windowTitleForPath } from "./WindowTitleBar";

describe("windowTitleForPath", () => {
  it.each([
    ["/", "Meetings"],
    ["/meeting/42", "Meeting"],
    ["/settings", "Settings"],
    ["/record", "Recording"],
    ["/new", "New meeting"],
    ["/onboarding", "Welcome"],
    ["/unknown", "Tara"],
  ])("maps %s to %s", (pathname, expected) => {
    expect(windowTitleForPath(pathname)).toBe(expected);
  });
});
