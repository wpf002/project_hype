// Self-hosted analytics client.
//
// Every event is a fire-and-forget POST to our own backend — no third-party
// scripts, no cookies, no PII. Unique visitors are counted server-side from a
// salted, daily-rotating hash of IP + User-Agent (never stored raw).
//
// trackEvent() must NEVER throw or reject: analytics failures are invisible
// to the user by design.

const API = import.meta.env.VITE_API_URL || "";

export function trackEvent(name, props) {
  try {
    fetch(`${API}/api/analytics/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: name, props: props || {} }),
      // keepalive lets the request survive a page navigation / tab close
      keepalive: true,
    }).catch(() => {});
  } catch (_) {
    /* analytics must never break the app */
  }
}

// Debounced variant, for events driven by continuous input.
//
// Typing "20000000" into the converter fires a change handler per keystroke.
// Sending one event each would make the metric count keystrokes rather than
// conversions, and would put eight rows in the database for one interaction.
// Trailing-edge only: the event describes what the user settled on.
const _pending = new Map();

export function trackEventDebounced(name, props, waitMs = 600) {
  const existing = _pending.get(name);
  if (existing) clearTimeout(existing);
  _pending.set(
    name,
    setTimeout(() => {
      _pending.delete(name);
      trackEvent(name, props);
    }, waitMs)
  );
}

// Fired once per page load. `page` distinguishes the landing page from the
// dashboard so we can see the top-of-funnel → app conversion rate.
export function trackPageView(page) {
  trackEvent("page_view", {
    page,
    referrer: document.referrer ? new URL(document.referrer).hostname : "direct",
  });
}
