// How-to-buy data for each tracked currency.
// tier: "exchange" | "limited" | "dealer" | "sanctioned"

const HOW_TO_BUY = {
  // ── SANCTIONED ─────────────────────────────────────────────────────────────
  KPW: {
    tier: "sanctioned",
    summary: "North Korean Won is subject to comprehensive OFAC sanctions. Buying, selling, or holding it is illegal for US persons and prohibited in most jurisdictions.",
    steps: [],
    platforms: [],
    disclaimer: "Attempting to acquire KPW may violate US Treasury OFAC regulations and equivalent laws in the EU, UK, and Canada. Do not attempt.",
  },
  IRR: {
    tier: "sanctioned",
    summary: "Iranian Rial is subject to comprehensive OFAC sanctions. US persons and most Western nationals are prohibited from transacting in IRR.",
    steps: [],
    platforms: [],
    disclaimer: "IRR transactions are blocked under US Treasury OFAC regulations (31 CFR Part 560). Violations carry severe civil and criminal penalties.",
  },
  SYP: {
    tier: "sanctioned",
    summary: "Syrian Pound is subject to comprehensive OFAC sanctions. Most financial transactions involving SYP are prohibited for US persons.",
    steps: [],
    platforms: [],
    disclaimer: "SYP is blocked under US Executive Order 13338 and related OFAC programs. Consult a sanctions attorney before any engagement.",
  },

  // ── DEALER ONLY ────────────────────────────────────────────────────────────
  IQD: {
    tier: "dealer",
    summary: "Iraqi Dinar is not traded on mainstream forex platforms. It can only be purchased from specialist currency dealers — typically in physical banknote form.",
    steps: [
      "Find a reputable currency dealer that specialises in exotic banknotes (see platforms below).",
      "Verify the dealer is registered with FinCEN (US) or equivalent regulator.",
      "Order online or visit in person — dealers ship banknotes directly to you.",
      "Store physical notes safely; there is no liquid market to resell quickly.",
      "Be aware: IQD revaluation speculation has a long history of scams — only buy what you can afford to lose.",
    ],
    platforms: [
      { name: "Treasury Vault", url: "https://www.treasuryvault.com" },
      { name: "Dinar Corp", url: "https://www.dinarcorp.com" },
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: "IQD is highly illiquid and speculative. No mainstream exchange supports it. Revaluation scenarios are unverified.",
  },
  ZWG: {
    tier: "dealer",
    summary: "Zimbabwe Gold Dollar (ZWG) is a new currency launched in 2024. It is not yet available on any mainstream platform — specialist dealers are the only option.",
    steps: [
      "Contact specialist banknote or exotic currency dealers.",
      "Ask specifically for ZWG (not ZWL — that is the old Zimbabwe dollar).",
      "Expect very limited supply and wide bid/ask spreads.",
      "Consider this extremely speculative — Zimbabwe has a history of currency resets.",
    ],
    platforms: [
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: "ZWG launched in April 2024. Liquidity is near-zero. This is among the most speculative assets tracked here.",
  },
  LBP: {
    tier: "dealer",
    summary: "Lebanese Pound can be purchased from Middle East-focused currency dealers. The parallel market rate differs significantly from the official rate.",
    steps: [
      "Use a specialist dealer or Middle Eastern exchange house.",
      "Clarify whether you want the official rate or parallel-market rate — they differ substantially.",
      "Physical notes only; no digital LBP accounts are available to foreigners.",
    ],
    platforms: [
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: "LBP has suffered extreme devaluation since 2019. The official and black-market rates differ by orders of magnitude.",
  },
  YER: {
    tier: "dealer",
    summary: "Yemeni Rial is only available through specialist dealers. Liquidity is extremely thin due to the ongoing conflict.",
    steps: [
      "Search specialist exotic currency dealers.",
      "Expect very limited availability and poor resale prospects.",
    ],
    platforms: [
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: "YER is extremely illiquid. Ongoing conflict makes resale or repatriation of funds nearly impossible.",
  },
  MMK: {
    tier: "dealer",
    summary: "Myanmar Kyat is available through some specialist dealers, but targeted US/EU sanctions on Myanmar impose restrictions on certain transactions.",
    steps: [
      "Use a specialist exotic currency dealer.",
      "Review US and EU sanctions on Myanmar before transacting — some sectors are restricted.",
      "Physical banknotes only.",
    ],
    platforms: [
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: "Targeted sanctions on Myanmar military-linked entities may affect legality of some transactions. Seek legal advice.",
  },
  AFN: {
    tier: "dealer",
    summary: "Afghan Afghani is only available through specialist dealers. The Taliban government's control of the central bank creates additional legal complexity for US persons.",
    steps: [
      "Contact specialist exotic banknote dealers.",
      "Be aware of OFAC considerations around Taliban-controlled financial institutions.",
    ],
    platforms: [
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: "OFAC maintains sanctions on Taliban-linked entities. Consult legal counsel before any AFN transaction.",
  },
  HTG: {
    tier: "dealer",
    summary: "Haitian Gourde is available through some Caribbean-focused currency dealers.",
    steps: [
      "Find a Caribbean or Latin American currency specialist.",
      "Physical banknotes only — no liquid digital market exists.",
    ],
    platforms: [
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: "Extremely illiquid. Resale may be very difficult.",
  },
  SOS: {
    tier: "dealer",
    summary: "Somali Shilling is available through some specialist dealers but is highly illiquid.",
    steps: [
      "Contact specialist exotic banknote dealers.",
      "Multiple competing currencies exist in Somalia — confirm you are buying the correct one.",
    ],
    platforms: [
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: "Very limited liquidity. Multiple currencies circulate in Somalia.",
  },
  SDG: {
    tier: "dealer",
    summary: "Sudanese Pound has very limited availability. US sanctions on Sudan were largely lifted in 2017 but accessing SDG remains practically very difficult.",
    steps: [
      "Seek specialist dealers — availability is extremely low.",
    ],
    platforms: [
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: "Despite sanctions relief, SDG is not commercially available on mainstream platforms.",
  },
  CDF: {
    tier: "dealer",
    summary: "Congolese Franc is only available through specialist dealers at very thin liquidity.",
    steps: [
      "Contact specialist African currency or banknote dealers.",
    ],
    platforms: [
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: "Very illiquid. No mainstream exchange support.",
  },
  SLL: {
    tier: "dealer",
    summary: "Sierra Leone Leone is available only through specialist dealers. Note: Sierra Leone redenominated its currency in 2022 (old SLL → new SLE).",
    steps: [
      "Contact specialist West African currency dealers.",
      "Clarify old SLL vs new SLE when ordering.",
    ],
    platforms: [
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: "Redenomination occurred in 2022. Confirm exact currency version with any dealer.",
  },
  MZN: {
    tier: "dealer",
    summary: "Mozambican Metical is rarely held outside Mozambique and is only available through specialist dealers.",
    steps: [
      "Contact specialist African exotic currency dealers.",
    ],
    platforms: [
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: "Extremely illiquid outside Mozambique.",
  },
  STN: {
    tier: "dealer",
    summary: "São Tomé and Príncipe Dobra is one of the least-traded currencies in the world. Only a handful of specialist dealers carry it.",
    steps: [
      "Contact specialist banknote collectors or exotic currency dealers.",
    ],
    platforms: [
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: "Possibly the hardest currency on this list to acquire. Treat as a collector's item rather than an investment.",
  },

  // ── LIMITED (P2P / regional platforms) ─────────────────────────────────────
  VES: {
    tier: "limited",
    summary: "Venezuelan Bolívar can be acquired via P2P crypto platforms and Latin America-focused fintechs. It is not on mainstream forex exchanges.",
    steps: [
      "Use Binance P2P or AirTM to buy VES from local Venezuelan sellers using USDT as the intermediary.",
      "Sign up, complete KYC, and fund your account with USDT or USD.",
      "Select VES on the P2P marketplace and agree terms with a seller.",
      "Note: Venezuela has targeted US/EU sanctions — verify your jurisdiction's rules before transacting.",
    ],
    platforms: [
      { name: "Binance P2P", url: "https://p2p.binance.com" },
      { name: "AirTM", url: "https://www.airtm.com" },
    ],
    disclaimer: "Venezuela is subject to targeted OFAC sanctions. Some transactions may require licences. Check OFAC guidance for your specific use case.",
  },

  // ── EXCHANGE (mainstream forex/fintech) ─────────────────────────────────────
  ARS: {
    tier: "exchange",
    summary: "Argentine Peso is available on Wise, major forex brokers, and Binance P2P. Argentina's currency controls mean the official rate differs from the 'blue dollar' street rate.",
    steps: [
      "Open an account on Wise or a forex broker (OANDA, Interactive Brokers).",
      "Complete identity verification (KYC).",
      "Transfer USD and convert to ARS at the official rate.",
      "For the parallel (blue dollar) rate, use Binance P2P: buy USDT with USD, then sell USDT to Argentine buyers in exchange for ARS.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
      { name: "Binance P2P", url: "https://p2p.binance.com" },
      { name: "OANDA", url: "https://www.oanda.com" },
    ],
    disclaimer: "Argentina's exchange controls mean official and parallel rates can diverge significantly. The parallel (blue) rate is technically informal.",
  },
  TRY: {
    tier: "exchange",
    summary: "Turkish Lira is one of the most liquid emerging-market currencies. Available on most forex brokers, Wise, and Revolut.",
    steps: [
      "Sign up on Wise, Revolut, or a forex broker.",
      "Complete KYC verification.",
      "Fund your account and convert to TRY instantly.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
      { name: "Revolut", url: "https://www.revolut.com" },
      { name: "OANDA", url: "https://www.oanda.com" },
      { name: "Interactive Brokers", url: "https://www.interactivebrokers.com" },
    ],
    disclaimer: null,
  },
  NGN: {
    tier: "exchange",
    summary: "Nigerian Naira is available on Wise and a few Africa-focused platforms. Nigeria's dual exchange rate system means rates vary by platform.",
    steps: [
      "Open a Wise account and verify your identity.",
      "Send USD to your Wise account and convert to NGN.",
      "Alternatively, use Grey Finance for Nigeria-specific transfers.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
      { name: "Grey Finance", url: "https://grey.co" },
    ],
    disclaimer: "Nigeria has historically maintained official and parallel exchange rates. Rates may differ between platforms.",
  },
  IDR: {
    tier: "exchange",
    summary: "Indonesian Rupiah is widely supported across forex and fintech platforms.",
    steps: [
      "Open an account on Wise or OFX.",
      "Complete KYC and fund with USD.",
      "Convert to IDR at the mid-market rate.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
      { name: "OFX", url: "https://www.ofx.com" },
    ],
    disclaimer: null,
  },
  VND: {
    tier: "exchange",
    summary: "Vietnamese Dong is available on Wise and OFX. It is not freely convertible so options are more limited than major currencies.",
    steps: [
      "Use Wise for the best rates and lowest fees.",
      "OFX is an alternative for larger transfers.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
      { name: "OFX", url: "https://www.ofx.com" },
    ],
    disclaimer: "VND is a restricted currency. Repatriation of funds from Vietnam can be slow.",
  },
  PKR: {
    tier: "exchange",
    summary: "Pakistani Rupee is available on Wise and a number of remittance services.",
    steps: [
      "Open a Wise account and verify your identity.",
      "Convert USD to PKR and hold in your Wise balance.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
      { name: "OFX", url: "https://www.ofx.com" },
    ],
    disclaimer: null,
  },
  EGP: {
    tier: "exchange",
    summary: "Egyptian Pound is available on Wise and some forex brokers. Egypt has loosened currency controls since 2024.",
    steps: [
      "Open a Wise account and complete KYC.",
      "Convert USD to EGP — Wise typically offers competitive rates.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
      { name: "OFX", url: "https://www.ofx.com" },
    ],
    disclaimer: null,
  },
  GHS: {
    tier: "exchange",
    summary: "Ghanaian Cedi is available on Wise.",
    steps: [
      "Create a Wise account, complete identity verification, and convert USD to GHS.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
    ],
    disclaimer: null,
  },
  KZT: {
    tier: "exchange",
    summary: "Kazakhstani Tenge is available on Wise and some forex brokers targeting Central Asia.",
    steps: [
      "Use Wise for currency conversion.",
      "For larger amounts, contact OFX or a forex broker directly.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
      { name: "OFX", url: "https://www.ofx.com" },
    ],
    disclaimer: null,
  },
  AMD: {
    tier: "exchange",
    summary: "Armenian Dram is available on Wise.",
    steps: [
      "Open a Wise account and convert USD to AMD directly.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
    ],
    disclaimer: null,
  },
  AZN: {
    tier: "exchange",
    summary: "Azerbaijani Manat is available on Wise and OFX.",
    steps: [
      "Open a Wise account, complete KYC, and convert USD to AZN.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
      { name: "OFX", url: "https://www.ofx.com" },
    ],
    disclaimer: null,
  },
  GEL: {
    tier: "exchange",
    summary: "Georgian Lari is available on Wise. Georgia has a very open economy and the Lari is freely convertible.",
    steps: [
      "Open a Wise account and convert USD to GEL instantly.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
    ],
    disclaimer: null,
  },
  BDT: {
    tier: "exchange",
    summary: "Bangladeshi Taka is available on Wise and remittance platforms.",
    steps: [
      "Open a Wise account, verify identity, and convert USD to BDT.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
    ],
    disclaimer: null,
  },
  UZS: {
    tier: "exchange",
    summary: "Uzbek Som is available on Wise following Uzbekistan's currency liberalisation in 2017.",
    steps: [
      "Use Wise for the most straightforward access.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
    ],
    disclaimer: null,
  },
  KHR: {
    tier: "exchange",
    summary: "Cambodian Riel has limited exchange support. OFX handles it for transfers; physical notes are available from dealers.",
    steps: [
      "Use OFX for currency transfer to Cambodia.",
      "For physical notes, use a specialist currency dealer.",
    ],
    platforms: [
      { name: "OFX", url: "https://www.ofx.com" },
      { name: "Currency Liquidator", url: "https://www.currencyliquidator.com" },
    ],
    disclaimer: null,
  },
  ETB: {
    tier: "exchange",
    summary: "Ethiopian Birr has very limited access outside Ethiopia. OFX supports remittance transfers.",
    steps: [
      "Use OFX for remittance transfers to Ethiopia.",
      "Holding ETB outside Ethiopia is not practically supported.",
    ],
    platforms: [
      { name: "OFX", url: "https://www.ofx.com" },
    ],
    disclaimer: "ETB is a restricted currency. Direct holding outside Ethiopia is not supported by mainstream platforms.",
  },
  LAK: {
    tier: "exchange",
    summary: "Lao Kip has very limited international access. OFX supports transfers; physical notes from specialist dealers.",
    steps: [
      "Use OFX for transfers to Laos.",
      "For physical notes, contact a specialist dealer.",
    ],
    platforms: [
      { name: "OFX", url: "https://www.ofx.com" },
    ],
    disclaimer: null,
  },
  MNT: {
    tier: "exchange",
    summary: "Mongolian Tögrög has limited but growing international support.",
    steps: [
      "OFX supports MNT transfers.",
      "Physical notes available from specialist dealers.",
    ],
    platforms: [
      { name: "OFX", url: "https://www.ofx.com" },
    ],
    disclaimer: null,
  },
  TZS: {
    tier: "exchange",
    summary: "Tanzanian Shilling is available on Wise.",
    steps: [
      "Open a Wise account and convert USD to TZS.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
    ],
    disclaimer: null,
  },
  XOF: {
    tier: "exchange",
    summary: "West African CFA Franc is used by 8 countries and is pegged to the Euro. Wise supports it for several member countries.",
    steps: [
      "Open a Wise account.",
      "Select the destination country (Senegal, Côte d'Ivoire, etc.) — Wise routes to the correct local institution.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
      { name: "OFX", url: "https://www.ofx.com" },
    ],
    disclaimer: "XOF is Euro-pegged, so speculation on revaluation is different from other currencies on this list.",
  },
  MVR: {
    tier: "exchange",
    summary: "Maldivian Rufiyaa has very limited international exchange support. It can be obtained at arrival airports or resort exchange desks.",
    steps: [
      "Exchange cash at Malé International Airport or at resort desks.",
      "OFX handles remittance transfers in some cases.",
    ],
    platforms: [
      { name: "OFX", url: "https://www.ofx.com" },
    ],
    disclaimer: "Not practically holdable outside the Maldives.",
  },
  SCR: {
    tier: "exchange",
    summary: "Seychelles Rupee has limited but accessible international support via Wise and OFX.",
    steps: [
      "Use Wise for conversion and transfer.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
      { name: "OFX", url: "https://www.ofx.com" },
    ],
    disclaimer: null,
  },
  MKD: {
    tier: "exchange",
    summary: "North Macedonia Denar is available through Wise and EU-based banks. MKD is pegged to the Euro.",
    steps: [
      "Use Wise or an EU bank for straightforward access.",
    ],
    platforms: [
      { name: "Wise", url: "https://wise.com" },
    ],
    disclaimer: "MKD is Euro-pegged. Speculative upside is limited compared to free-floating currencies.",
  },
};

export default HOW_TO_BUY;
