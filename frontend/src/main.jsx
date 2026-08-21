import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Landing from "./Landing.jsx";
import { trackPageView } from "./analytics.js";

const path = window.location.pathname;
const isApp = path === "/app" || path.startsWith("/app/");
const Root = isApp ? App : Landing;

// One page_view per load, before render — this is the "how many people
// accessed the app" number. Unique visitors are derived server-side.
trackPageView(isApp ? "app" : "landing");

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
