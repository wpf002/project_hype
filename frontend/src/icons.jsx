/**
 * Shared icon utilities for Project Hype.
 *
 * FlagIcon: renders sovereign-flag SVGs from flagcdn.com (CSP-whitelisted).
 * All other icon names are re-exports from lucide-react, imported here to keep
 * a single canonical source and avoid spread imports in App/Landing.
 */

// ── Flag helpers ───────────────────────────────────────────────────────────────

/** Maps Project-Hype currency codes → ISO 3166-1 alpha-2 (lowercase) for flagcdn.com. */
export const CURRENCY_FLAG_CODES = {
  IQD: "iq", VND: "vn", IRR: "ir", IDR: "id", KHR: "kh",
  MMK: "mm", LAK: "la", ZWG: "zw", VES: "ve", ARS: "ar",
  TRY: "tr", LBP: "lb", SYP: "sy", AFN: "af", GHS: "gh",
  NGN: "ng", EGP: "eg", PKR: "pk", SLL: "sl", MZN: "mz",
  UZS: "uz", KZT: "kz", BDT: "bd", ETB: "et", TZS: "tz",
  SDG: "sd", CDF: "cd", SOS: "so", MNT: "mn", AMD: "am",
  GEL: "ge", AZN: "az", MKD: "mk", HTG: "ht", STN: "st",
  MVR: "mv", KPW: "kp", SCR: "sc", YER: "ye",
  XOF: null, // 8-country CFA zone — no single flag
};

/**
 * Renders a sovereign flag as an <img> from flagcdn.com.
 * Falls back to a globe SVG for multi-country currencies (XOF).
 * @param {{ code: string, size?: number, style?: object }} props
 */
export function FlagIcon({ code, size = 20, style = {} }) {
  const cc = CURRENCY_FLAG_CODES[code];
  if (!cc) {
    return (
      <svg
        width={size} height={size} viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round"
        style={{ verticalAlign: "middle", flexShrink: 0, ...style }}
        aria-label={code}
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a14.5 14.5 0 010 18M12 3a14.5 14.5 0 000 18M3 12h18" />
      </svg>
    );
  }
  return (
    <img
      src={`https://flagcdn.com/${cc}.svg`}
      alt={code}
      width={Math.round(size * 1.4)}
      height={size}
      loading="lazy"
      style={{ verticalAlign: "middle", borderRadius: 2, flexShrink: 0, objectFit: "cover", ...style }}
    />
  );
}

// ── Re-export every icon used across App.jsx / Landing.jsx ────────────────────
export {
  Zap,
  BarChart2,
  Flame,
  Target,
  Info,
  Briefcase,
  Bell,
  BellRing,
  AlertTriangle,
  Newspaper,
  Link2,
  Search,
  TrendingUp,
  Eye,
  Check,
  CheckCircle2,
  X,
  AlertCircle,
  Circle,
  Globe,
} from "lucide-react";
