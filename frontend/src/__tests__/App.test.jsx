/**
 * Frontend tests for Project Hype App component.
 *
 * Strategy: mock global.fetch with URL-based dispatch so the App's data
 * fetching works without a real backend. Each test suite sets up the mock
 * before rendering and asserts on the resulting DOM.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, afterEach, vi } from "vitest";
import App from "../App";

// ── Shared mock data ────────────────────────────────────────────────────────

const MOCK_CURRENCIES = [
  {
    code: "IQD",
    name: "Iraqi Dinar",
    flag: "🇮🇶",
    rate: 0.000763,
    mcap: "$800B",
    vol: "$5M",
    hype: 3,
    story: "Post-war reconstruction speculation.",
    live: true,
    source: "oxr",
    change_24h: 0.52,
    hype_score: 72.5,
    catalyst_score: 64.0,
    sentiment: 0.4,
    momentum_7d: 1.2,
  },
  {
    code: "IRR",
    name: "Iranian Rial",
    flag: "🇮🇷",
    rate: 0.0000238,
    mcap: "$600B",
    vol: "$2M",
    hype: 4,
    story: "Sanctions relief speculation.",
    live: false,
    source: "analyst",
    change_24h: -0.1,
    hype_score: 81.0,
    catalyst_score: 78.0,
    sentiment: 0.8,
    momentum_7d: 2.1,
  },
];

const MOCK_ROI = {
  code: "IQD",
  amount: 20000000,
  current_rate: 0.000763,
  target_rate: 0.001,
  current_value: 15260.0,
  target_value: 20000.0,
  gain: 4740.0,
  roi_percent: 31.06,
  multiplier: 1.310616,
  live: true,
};

const MOCK_HEADLINES = [
  {
    title: "Iraq Central Bank Reforms Exchange Rate Policy",
    source: "Reuters",
    url: "https://example.com/1",
    published_at: "2024-01-15T10:00:00Z",
    description: "Major reform announced.",
    mock: false,
  },
];

/** Returns a resolved fetch Response for the given URL pattern. */
function makeMockFetch(overrides = {}) {
  return vi.fn((url) => {
    const str = url.toString();

    if (str.includes("/rates")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_CURRENCIES),
      });
    }
    if (str.includes("/news/")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_HEADLINES),
      });
    }
    if (str.includes("/history/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (str.includes("/signals/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (str.includes("/hype/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (str.includes("/roi")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_ROI) });
    }
    if (str.includes("/alerts/subscribe")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ subscribed: true }),
      });
    }
    if (str.includes("/portfolio/share")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: "abc12345", url: "http://localhost:5173?portfolio=abc12345" }),
      });
    }
    if (str.includes("/portfolio/")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }

    // Custom per-test overrides by URL fragment
    for (const [fragment, handler] of Object.entries(overrides)) {
      if (str.includes(fragment)) return handler(str);
    }

    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

/** Render App and wait until the currency list has loaded. */
async function renderWithData() {
  global.fetch = makeMockFetch();
  render(<App />);
  // Wait for at least one IQD element — means rates have loaded
  await waitFor(
    () => expect(screen.getAllByText("IQD").length).toBeGreaterThan(0),
    { timeout: 3000 }
  );
}

/** Click the tab with the given visible label text. */
function clickTab(labelText) {
  const tabs = screen.getAllByRole("button", { name: new RegExp(labelText, "i") });
  fireEvent.click(tabs[0]);
}

// ── Clean up mocks after each test ─────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Loading state ───────────────────────────────────────────────────────────

describe("Loading state", () => {
  it("shows the app logo while data is loading", () => {
    // Fetch never resolves → stays in loading state
    global.fetch = vi.fn(() => new Promise(() => {}));
    render(<App />);
    // The header/logo should always be visible
    expect(document.body.textContent).toContain("PROJECT");
  });
});

// ── Error state ─────────────────────────────────────────────────────────────

describe("Error state", () => {
  it("shows error message when /api/rates fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/Unable to reach/i)).toBeInTheDocument()
    );
  });

  it("shows Retry button on error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText(/Retry/i)).toBeInTheDocument()
    );
  });

  it("retries fetch when Retry button is clicked", async () => {
    // First call fails, second succeeds
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockImplementation(makeMockFetch());

    render(<App />);
    await waitFor(() => screen.getByText(/Retry/i));

    fireEvent.click(screen.getByText(/Retry/i));

    await waitFor(() =>
      expect(screen.getAllByText("IQD").length).toBeGreaterThan(0)
    );
  });
});

// ── Currency data renders ───────────────────────────────────────────────────

describe("Currency data", () => {
  it("renders currency codes after data loads", async () => {
    await renderWithData();
    expect(screen.getAllByText("IQD").length).toBeGreaterThan(0);
    expect(screen.getAllByText("IRR").length).toBeGreaterThan(0);
  });

  it("renders currency names", async () => {
    await renderWithData();
    expect(screen.getAllByText(/Iraqi Dinar/i).length).toBeGreaterThan(0);
  });
});

// ── Tab navigation ──────────────────────────────────────────────────────────

describe("Tab navigation", () => {
  it("defaults to the Calculator tab", async () => {
    await renderWithData();
    // Calculator tab heading or content should be visible
    expect(screen.getByText(/ROI Calculator/i)).toBeInTheDocument();
  });

  it("switches to Portfolio tab", async () => {
    await renderWithData();
    clickTab("Portfolio");
    await waitFor(() =>
      expect(screen.getByText(/ADD TO PORTFOLIO/i)).toBeInTheDocument()
    );
  });

  it("switches to Signal Strength tab", async () => {
    await renderWithData();
    clickTab("Signal Strength");
    await waitFor(() =>
      expect(screen.getByText(/SPECULATIVE SIGNAL STRENGTH/i)).toBeInTheDocument()
    );
  });

  it("switches to About tab", async () => {
    await renderWithData();
    clickTab("About");
    await waitFor(() =>
      expect(screen.getByText(/About Project Hype/i)).toBeInTheDocument()
    );
  });
});

// ── Portfolio ───────────────────────────────────────────────────────────────

describe("Portfolio", () => {
  it("shows empty state before any position is added", async () => {
    await renderWithData();
    clickTab("Portfolio");
    await waitFor(() =>
      expect(screen.getByText(/No positions yet/i)).toBeInTheDocument()
    );
  });

  it("adds a position and shows it in the list", async () => {
    await renderWithData();
    clickTab("Portfolio");

    await waitFor(() => screen.getByPlaceholderText(/e\.g\. 1000000/i));

    // Enter amount
    const amountInput = screen.getByPlaceholderText(/e\.g\. 1000000/i);
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, "5000000");

    // Click Add
    fireEvent.click(screen.getByText(/ADD TO PORTFOLIO/i));

    // Position should appear (IQD is auto-selected)
    await waitFor(() =>
      expect(screen.getAllByText("IQD").length).toBeGreaterThan(1)
    );
  });

  it("shows share button when portfolio has positions", async () => {
    await renderWithData();
    clickTab("Portfolio");
    await waitFor(() => screen.getByPlaceholderText(/e\.g\. 1000000/i));

    const amountInput = screen.getByPlaceholderText(/e\.g\. 1000000/i);
    await userEvent.type(amountInput, "1000000");
    fireEvent.click(screen.getByText(/ADD TO PORTFOLIO/i));

    await waitFor(() =>
      expect(screen.getByText(/SHARE/i)).toBeInTheDocument()
    );
  });
});

// ── ROI Calculator ──────────────────────────────────────────────────────────

describe("ROI Calculator", () => {
  it("renders the target rate input", async () => {
    await renderWithData();
    const input = screen.getByPlaceholderText(/e\.g\. 0\.001/i);
    expect(input).toBeInTheDocument();
  });

  it("shows ROI results after entering a target rate", async () => {
    await renderWithData();
    const input = screen.getByPlaceholderText(/e\.g\. 0\.001/i);
    await userEvent.type(input, "0.001");

    await waitFor(
      () => expect(screen.getByText(/31\.06/)).toBeInTheDocument(),
      { timeout: 3000 }
    );
  });
});

// ── Alert modal ─────────────────────────────────────────────────────────────

describe("Alert modal", () => {
  it("opens when the bell button is clicked", async () => {
    await renderWithData();
    const bell = screen.getByText("🔔", { selector: "button" });
    fireEvent.click(bell);
    await waitFor(() =>
      expect(screen.getByText(/Catalyst Score Alerts/i)).toBeInTheDocument()
    );
  });

  it("shows email input inside the modal", async () => {
    await renderWithData();
    fireEvent.click(screen.getByText("🔔", { selector: "button" }));
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(/you@example\.com/i)
      ).toBeInTheDocument()
    );
  });

  it("shows error when submitting with invalid email", async () => {
    await renderWithData();
    fireEvent.click(screen.getByText("🔔", { selector: "button" }));
    await waitFor(() => screen.getByPlaceholderText(/you@example\.com/i));

    const emailInput = screen.getByPlaceholderText(/you@example\.com/i);
    await userEvent.type(emailInput, "not-an-email");

    fireEvent.click(screen.getByText(/Notify me when/i));
    await waitFor(() =>
      expect(screen.getByText(/valid email/i)).toBeInTheDocument()
    );
  });

  it("shows success state after valid subscription", async () => {
    await renderWithData();
    fireEvent.click(screen.getByText("🔔", { selector: "button" }));
    await waitFor(() => screen.getByPlaceholderText(/you@example\.com/i));

    const emailInput = screen.getByPlaceholderText(/you@example\.com/i);
    await userEvent.type(emailInput, "test@example.com");

    fireEvent.click(screen.getByText(/Notify me when/i));

    await waitFor(() =>
      expect(screen.getByText(/subscribed/i)).toBeInTheDocument(),
      { timeout: 3000 }
    );
  });

  it("closes modal when Cancel is clicked", async () => {
    await renderWithData();
    fireEvent.click(screen.getByText("🔔", { selector: "button" }));
    await waitFor(() => screen.getByText(/Cancel/i));

    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() =>
      expect(screen.queryByText(/Catalyst Score Alerts/i)).not.toBeInTheDocument()
    );
  });
});

// ── News section ────────────────────────────────────────────────────────────

describe("News / Latest Intel", () => {
  it("renders a headline when news loads", async () => {
    await renderWithData();
    await waitFor(() =>
      expect(
        screen.getByText(/Iraq Central Bank Reforms Exchange Rate Policy/i)
      ).toBeInTheDocument(),
      { timeout: 3000 }
    );
  });
});

// ── Root endpoint ────────────────────────────────────────────────────────────

describe("App root", () => {
  it("renders without crashing", async () => {
    global.fetch = vi.fn(() => new Promise(() => {}));
    const { container } = render(<App />);
    expect(container).toBeTruthy();
  });
});
