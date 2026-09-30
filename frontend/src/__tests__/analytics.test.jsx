import { describe, it, expect, beforeEach, vi } from "vitest";
import { trackEvent } from "../analytics.js";

/** Pretend to be the live site: the real rules skip localhost entirely. */
function atProd(search = "") {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { hostname: "projecthype.io", search, pathname: "/app" },
  });
}

describe("analytics opt-out", () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
  });

  it("sends events by default on the live site", () => {
    atProd();
    trackEvent("page_view", { page: "app" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("?notrack=1 stops events from this browser permanently", () => {
    atProd("?notrack=1");
    trackEvent("page_view", { page: "app" });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem("hype_no_track")).toBe("1");

    atProd(""); // later visit, no parameter
    trackEvent("currency_selected", { code: "IQD" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("?notrack=0 restores tracking", () => {
    localStorage.setItem("hype_no_track", "1");
    atProd("?notrack=0");
    trackEvent("page_view", { page: "app" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("never reports from local development", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { hostname: "localhost", search: "", pathname: "/app" },
    });
    trackEvent("page_view", { page: "app" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
