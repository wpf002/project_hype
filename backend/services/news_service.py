"""
News Service — returns headlines for speculative currencies.

3-tier source architecture:
  Tier 1 (weight 3×): Institutional RSS feeds — IMF, World Bank, US Treasury OFAC, BIS
  Tier 2 (weight 2×): Quality financial news via GDELT domain-filtered feed
  Tier 3 (weight 1×): Currency-specific regional/specialist RSS feeds
  Fallback: analyst-written mock headlines (geopolitically informed, not generic)
"""

import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional, Tuple

import httpx

from data.currencies import CURRENCY_MAP

logger = logging.getLogger(__name__)
GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"

# ── Tier 1: Institutional RSS feeds ─────────────────────────────────────────
TIER1_FEEDS = [
    ("IMF", "https://www.imf.org/en/News/rss?language=eng"),
    ("World Bank", "https://feeds.worldbank.org/worldbank/news"),
    ("US Treasury OFAC", "https://home.treasury.gov/rss.xml"),
    ("BIS", "https://www.bis.org/doclist/all_speeches.rss"),
]

# ── Tier 2: Quality-filtered GDELT domains ───────────────────────────────────
TIER2_QUALITY_DOMAINS = (
    "domain:reuters.com OR domain:apnews.com OR domain:ft.com OR "
    "domain:wsj.com OR domain:economist.com OR domain:bloomberg.com OR "
    "domain:aljazeera.com OR domain:bbc.co.uk OR domain:france24.com OR "
    "domain:voanews.com OR domain:rferl.org OR domain:nikkei.com OR "
    "domain:scmp.com"
)

# ── Tier 3: Currency-specific regional/specialist RSS feeds ──────────────────
CURRENCY_RSS_MAP: Dict[str, List[Tuple[str, str]]] = {
    "IQD": [
        ("Iraq Business News", "https://www.iraq-businessnews.com/feed/"),
        ("Rudaw", "https://www.rudaw.net/english/rss"),
        ("Kurdistan 24", "https://Kurdistan24.net/en/rss"),
    ],
    "IRR": [
        ("Radio Farda", "https://www.radiofarda.com/api/z-yqpiqe$qepmit"),
        ("Iran International", "https://www.iranintl.com/en/rss"),
    ],
    "LBP": [
        ("L'Orient Today", "https://today.lorientlejour.com/rss"),
        ("Naharnet", "https://www.naharnet.com/stories/en/rss"),
    ],
    "ZWL": [
        ("NewsDay Zimbabwe", "https://www.newsday.co.zw/feed/"),
        ("The Herald Zimbabwe", "https://www.herald.co.zw/feed/"),
    ],
    "VES": [
        ("Caracas Chronicles", "https://www.caracaschronicles.com/feed/"),
        ("El Universal Venezuela", "https://www.eluniversal.com/rss"),
    ],
    "NGN": [
        ("Nairametrics", "https://nairametrics.com/feed/"),
        ("BusinessDay Nigeria", "https://businessday.ng/feed/"),
    ],
    "ARS": [
        ("Buenos Aires Times", "https://www.batimes.com.ar/rss"),
        ("Infobae", "https://www.infobae.com/feeds/rss/"),
    ],
    "TRY": [
        ("Daily Sabah", "https://www.dailysabah.com/rss"),
        ("Hurriyet Daily News", "https://www.hurriyetdailynews.com/rss"),
    ],
    "EGP": [
        ("Egypt Independent", "https://egyptindependent.com/feed/"),
        ("Ahram Online", "https://english.ahram.org.eg/rss"),
    ],
    "KPW": [
        ("NK News", "https://www.nknews.org/feed/"),
        ("38 North", "https://www.38north.org/feed/"),
    ],
}

# In-memory cache for RSS feeds: {url: (articles_list, fetched_at)}
_rss_cache: Dict[str, Tuple[List[dict], float]] = {}
RSS_CACHE_TTL = 2 * 3600  # 2 hours in seconds

# ---------------------------------------------------------------------------
# Geopolitically-informed mock headlines — one analyst's read on each currency
# ---------------------------------------------------------------------------
MOCK_HEADLINES: Dict[str, List[Dict[str, str]]] = {
    "IQD": [
        {"title": "CBI Governor: Iraq targeting Article VIII IMF compliance as precondition for dinar rate reform", "source": "Iraq Financial Observer"},
        {"title": "FOREX ANALYSIS: Iraqi dinar black market premium narrows to 3% as CBI tightens dollar auction controls", "source": "Middle East Monitor"},
        {"title": "Reconstruction contracts accelerate FX inflows — USD 17B in Q3 disbursements via World Bank and GCC pledges", "source": "Baghdad Financial Times"},
        {"title": "Dinar revaluation forums hit 2.1M daily visits as CBI signals 'managed appreciation' path", "source": "Speculative FX Desk"},
        {"title": "Iraq's non-oil GDP grows 6.2% — diversification push may support case for stronger dinar peg revision", "source": "Gulf Capital Review"},
    ],
    "IRR": [
        {"title": "Iran's parallel market rial hits new low as IRGC-linked exchanges absorb dollar flight", "source": "Iran International"},
        {"title": "JCPOA revival talks stall — sanctions relief window narrows for rial stabilization", "source": "Atlantic Council FX"},
        {"title": "Toman redenomination bill passes third reading — 10,000 rial = 1 toman set for 2025 rollout", "source": "Tehran Financial Wire"},
        {"title": "Black market spread between official SANA rate and street rate widens to 44% — capital controls tighten", "source": "Middle East FX Monitor"},
        {"title": "Oil exports via UAE front companies estimated at $7B — rial supply partially cushioned", "source": "Petroleum Intelligence Weekly"},
    ],
    "KPW": [
        {"title": "Jangmadang black market: USD/KPW reaches 8,500 in Pyongyang markets amid food import surge", "source": "NK Economy Watch"},
        {"title": "OFAC designates three Macau-based entities for DPRK currency conversion operations", "source": "Treasury Enforcement Digest"},
        {"title": "North Korea's dollarization expands — won used only for domestic retail as elites hold USD/CNY", "source": "38 North Economic Analysis"},
        {"title": "Speculation on post-regime currency reform: analysts model KPW redenomination at Korean reunification", "source": "Seoul FX Strategy"},
        {"title": "UN panel: DPRK uses cryptocurrency and hawala networks to bypass won convertibility restrictions", "source": "UN Security Council Monitor"},
    ],
    "VES": [
        {"title": "Venezuela's bolivar loses 67% against dollar in 12 months — BCV digital bolivar intervention fails", "source": "Venezuela Analysis"},
        {"title": "Maduro administration widens FX swap window to 3% band — parallel rate still trades 18% above official", "source": "LatAm FX Desk"},
        {"title": "Oil output at 800K bpd — Chevron waiver extension seen as temporary bolivar support mechanism", "source": "OPEC Monitor"},
        {"title": "Dollarization de facto: 65% of Venezuelan retail transactions now denominated in USD", "source": "Caracas Economic Monitor"},
        {"title": "PDVSA bond restructuring negotiations open crack in sanctions wall — bolivar speculators watch closely", "source": "EM Debt Strategy"},
    ],
    "ARS": [
        {"title": "Milei's cepo dismantlement: BCRA removes FX controls for exporters — blue-chip spread collapses to 4%", "source": "Buenos Aires Herald"},
        {"title": "Argentina exits IMF program with $44B repaid — peso gains 12% on news of Article IV completion", "source": "IMF Watch LatAm"},
        {"title": "Dollarization debate resurfaces: Milei reconfirms USD adoption target if reserves reach $15B threshold", "source": "La Nación Financial"},
        {"title": "Agricultural sector holds USD 8B in silos — soy liquidation trigger watched as peso support catalyst", "source": "LatAm Agri Finance"},
        {"title": "BCRA reserves reach $30B — first time since 2019, peso carry trade attracting EM fund inflows", "source": "EM Capital Monitor"},
    ],
    "TRY": [
        {"title": "TCMB holds rates at 45% — signals extended plateau as inflation decelerates toward 40%", "source": "Bloomberg Turkey"},
        {"title": "Turkish lira carry trade returns: foreign investors hold $12B in TRY T-bills on high real yield", "source": "EM FX Strategy"},
        {"title": "Erdogan signals tolerance for lira strength — first explicit backing of tight monetary policy in 5 years", "source": "Bosphorus Capital"},
        {"title": "Current account deficit narrows 40% YoY — reduced FX demand pressure supports lira stabilization", "source": "Turkey Macro Monitor"},
        {"title": "Hafize Gaye Erkan successor holds rates firm — TCMB independence narrative gaining traction in markets", "source": "Istanbul Financial Review"},
    ],
    "LBP": [
        {"title": "Banque du Liban: Sayrafa platform rate unified to 89,500 LBP/USD — three-tier system officially ends", "source": "Lebanon Financial Monitor"},
        {"title": "IMF staff-level agreement reached — $3B program contingent on banking sector haircut legislation", "source": "IMF Lebanon Desk"},
        {"title": "Capital controls bill stalls in parliament for 18th consecutive month — depositor recovery timeline extends", "source": "Beirut Economic Observer"},
        {"title": "Lebanese diaspora remittances hit $8.2B — informal lollar economy keeps pound from full collapse", "source": "World Bank Lebanon"},
        {"title": "Hezbollah ceasefire opens reconstruction window — GCC pledges $5B contingent on central bank reform", "source": "Gulf-Levant Monitor"},
    ],
    "SYP": [
        {"title": "HTS administration establishes provisional exchange commission — SYP/USD rate set at 13,000 in liberated zones", "source": "Syria Report"},
        {"title": "Caesar Act waiver debate intensifies in Washington as reconstruction contractors lobby for sanctions relief", "source": "Washington Syria Desk"},
        {"title": "Syrian pound black market: Damascus street rate 3x official as humanitarian imports accelerate", "source": "Syria Direct Economic"},
        {"title": "Gulf states pledge $25B reconstruction fund contingent on transitional government formation", "source": "GCC Development Monitor"},
        {"title": "IMF Article IV consultation with Syria scheduled for first time since 2010 — precursor to program discussions", "source": "Bretton Woods Observer"},
    ],
    "ZWL": [
        {"title": "RBZ launches ZiG gold-backed currency — second redenomination in 5 years replaces ZWL at 2,500:1", "source": "Zimbabwe Financial Gazette"},
        {"title": "ZiG trades at 3% premium to official gold parity in Bulawayo informal markets — early adoption positive", "source": "Southern Africa Monitor"},
        {"title": "ZIMSTAT: dollarization index rises to 78% — ZiG adoption requires reversing deep USD dependency", "source": "RBZ Economic Review"},
        {"title": "Lithium export revenues earmarked for ZiG reserve backing — Arcadia mine produces $600M in 2024", "source": "Zimbabwe Mining Weekly"},
        {"title": "IMF Article IV: Zimbabwe's monetary credibility requires 12-18 months of ZiG stability before program talks", "source": "IMF Zimbabwe"},
    ],
    "MMK": [
        {"title": "Myanmar junta fixes kyat at 2,100/USD — black market trades at 4,200 as military loses territory", "source": "Irrawaddy Economic"},
        {"title": "CBM foreign reserves fall below 90-day import cover — kyat depreciation pressure structural", "source": "Myanmar Business Today"},
        {"title": "Resistance government (NUG) issues parallel currency instruments — dual monetary system risk elevated", "source": "Burma Insider"},
        {"title": "Cross-border yuan payments with China bypass official kyat — border trade increasingly CNY-denominated", "source": "Mekong FX Monitor"},
        {"title": "ASEAN summit: Thailand, India push for Myanmar ceasefire as kyat volatility disrupts regional supply chains", "source": "Southeast Asia Monitor"},
    ],
    "NGN": [
        {"title": "CBN Governor Cardoso: naira FX unification complete — official and parallel rates converge within 2%", "source": "Nairametrics"},
        {"title": "Nigeria clears $7B FX backlog — multinational dividend repatriation unlocks, naira liquidity improves", "source": "BusinessDay Nigeria"},
        {"title": "NNPC oil output hits 1.8M bpd target — petrodollar inflows seen as key naira stabilization lever", "source": "Energy Intelligence Nigeria"},
        {"title": "Tinubu fuel subsidy savings: N7.5T redirected — IMF approves fiscal framework, program discussions advance", "source": "IMF Nigeria Desk"},
        {"title": "Eurobond issuance 4x oversubscribed — Nigeria regains market access at 9.5%, naira sentiment improves", "source": "African Capital Markets"},
    ],
    "EGP": [
        {"title": "Egypt secures $35B UAE investment deal — Ras El-Hekma funds seen as multi-year pound stabilizer", "source": "Egypt Today Finance"},
        {"title": "CBE holds rates at 27.25% — high real yields attracting Gulf and EM carry trade into EGP", "source": "Egyptian Central Bank Monitor"},
        {"title": "IMF program expanded to $8B — conditionalities include flexible exchange rate commitment", "source": "IMF Egypt"},
        {"title": "Suez Canal revenues recover to $8.8B annual run-rate post-Red Sea normalization", "source": "Suez Canal Authority"},
        {"title": "Egypt's FX reserves hit $46B — highest since 2020, pound now supported by six months import cover", "source": "Macro Egypt Monitor"},
    ],
    "PKR": [
        {"title": "Pakistan completes $3B IMF Stand-By Arrangement — new 37-month EFF program negotiations open", "source": "Dawn Business"},
        {"title": "SBP holds policy rate at 22% — rupee carry trade attracting $2B in hot money inflows", "source": "Pakistan Economy Watch"},
        {"title": "CPEC Phase II contracts signed — $15B infrastructure inflows expected to ease FX pressure", "source": "China-Pakistan Monitor"},
        {"title": "Remittances hit $2.8B monthly — diaspora flows primary source of external FX stability", "source": "SBP Economic Bulletin"},
        {"title": "Army signals political settlement with PTI — markets interpret stability as rupee-positive", "source": "Islamabad Financial Review"},
    ],
    "AFN": [
        {"title": "US Treasury OFAC: Da Afghanistan Bank (DAB) partial sanctions relief extended for 120 days", "source": "OFAC Afghanistan Monitor"},
        {"title": "Afghanistan's frozen $3.5B in Swiss trust fund: disbursement criteria remain unmet — humanitarian pressure mounts", "source": "UN Afghanistan Monitor"},
        {"title": "Hawala networks process $2.1B annually — formal banking system handles under 15% of Afghan FX flows", "source": "Afghanistan Finance Watch"},
        {"title": "Taliban mining contracts with Chinese firms: $6.5B in lithium and copper deals bypass USD settlement", "source": "Resource Finance Monitor"},
        {"title": "Afghani depreciates 8% vs. USD in Q3 — poppy revenue decline reduces informal dollar supply", "source": "SIGAR Economic Monitor"},
    ],
    "GHS": [
        {"title": "Ghana completes $13B debt restructuring — eurobond holders accept 37% haircut, IMF program unlocked", "source": "Ghana Business News"},
        {"title": "BoG Governor: cedi on managed float path — 'no more interventions to defend artificial rate'", "source": "Bank of Ghana Monitor"},
        {"title": "Gold production at 4.2M oz — PMMC reforms increase formal sector capture, cedi benefiting from royalties", "source": "Ghana Chamber of Mines"},
        {"title": "Cocoa Board (COCOBOD) secures $1.5B syndicated facility — seasonal FX inflows on schedule", "source": "West Africa Agri Finance"},
        {"title": "IMF fifth review: Ghana on track — fiscal primary surplus achieved for first time in 12 years", "source": "IMF Ghana Desk"},
    ],
    "XOF": [
        {"title": "ECOWAS ECO transition stalls as Sahel junta bloc (Mali, Burkina, Niger) announces CFA exit timeline", "source": "West Africa Monitor"},
        {"title": "France reduces CFA reserves backing requirement — symbolic shift in post-colonial monetary architecture", "source": "Banque de France BCEAO"},
        {"title": "BCEAO raises rates 100bps — first independent tightening cycle signals institutional autonomy from French Treasury", "source": "Francophone Africa Finance"},
        {"title": "Senegal oil revenues: $3.2B projected from Sangomar field — BCEAO sees FX diversification opportunity", "source": "West Africa Energy Monitor"},
        {"title": "AES junta currencies proposal: pan-Sahel scrip to replace CFA — markets watch Bamako communiqué", "source": "Sahel Policy Monitor"},
    ],
    "CDF": [
        {"title": "DRC cobalt export revenues hit $8.4B — BCC pressured to strengthen franc ahead of mining law revision", "source": "Kinshasa Mining Finance"},
        {"title": "Coltan supply chain review: G7 critical minerals deal may channel dollar premiums through formal BCC system", "source": "Critical Minerals Monitor"},
        {"title": "IMF ECF program disbursement: $216M tranche released after fiscal benchmarks met — franc stable", "source": "IMF DRC"},
        {"title": "Eastern DRC conflict: M23 territorial gains disrupt coltan production — franc weakens on supply risk", "source": "Great Lakes Monitor"},
        {"title": "BCC adopts crawling peg framework — analyst: 'First credible monetary commitment in 15 years'", "source": "Central Africa FX Desk"},
    ],
    "YER": [
        {"title": "Yemen's dual central bank crisis: Aden CBY and Sanaa CBY issue conflicting rate circulars", "source": "Yemen Economic Monitor"},
        {"title": "Saudi Arabia deposits $1.2B in Aden CBY — southern rial trades 2,100/USD vs 540/USD in Houthi north", "source": "Gulf-Yemen Finance"},
        {"title": "Houthi-controlled Hodeidah port: rial black market surges 40% on remittance disruption post-Red Sea closure", "source": "Shipping & FX Monitor"},
        {"title": "UN Yemen peace framework: reconstruction fund of $25B floated — unified rial rate prerequisite", "source": "UN Yemen Monitor"},
        {"title": "SFD Saudi Fund deposit mechanics: dollar inflows bypass Sanaa, supporting legitimate government rial", "source": "MENA Development Finance"},
    ],
    "SDG": [
        {"title": "RSF captures Central Bank of Sudan Khartoum vault — gold reserves status unknown", "source": "Sudan Conflict Monitor"},
        {"title": "Sudan pound hyperinflation: monthly rate at 40% as parallel market prints 2,800/USD vs 595 official", "source": "Khartoum Economic Desk"},
        {"title": "Port Sudan CBos operations: limited reserve management possible from temporary capital", "source": "Africa Finance Monitor"},
        {"title": "Gold smuggling to UAE estimated at $15B annually — largest informal FX source for Sudan economy", "source": "Global Financial Integrity"},
        {"title": "IMF: Sudan debt relief under HIPC initiative suspended pending conflict cessation and governance criteria", "source": "IMF Sudan"},
    ],
    "LAK": [
        {"title": "Laos debt distress: 55% of GDP owed to Chinese creditors — kip depreciation accelerates debt servicing cost", "source": "Mekong Economic Monitor"},
        {"title": "BOL raises rates 300bps in emergency session — inflation at 25%, kip at all-time low vs. USD and THB", "source": "Bank of Lao PDR"},
        {"title": "Laos-China rail revenues: $400M projected — seen as partial BRI debt offset, kip sentiment cautiously positive", "source": "Belt and Road Monitor"},
        {"title": "IMF Article IV: Laos requires immediate FX reserve rebuilding — recommends flexible exchange rate adoption", "source": "IMF Laos"},
        {"title": "Kip informal dollarization rises to 65% — Thai baht dominates border trade as kip trust erodes", "source": "Southeast Asia Finance"},
    ],
    "MZN": [
        {"title": "TotalEnergies resumes Mozambique LNG construction — BM projects $4B annual FX inflows from 2028", "source": "Mozambique Energy Monitor"},
        {"title": "IMF: Mozambique's hidden debt scandal legacy — creditors accept 30% haircut in final Ematum settlement", "source": "IMF Mozambique"},
        {"title": "Cabo Delgado insurgency: security corridor established, LNG site protected — metical reacts positively", "source": "Southern Africa Monitor"},
        {"title": "Banco de Moçambique intervention: metical defended at 64/USD using IMF SDR allocation", "source": "Maputo Finance Desk"},
        {"title": "Mineral royalties reform: graphite and ruby export taxes restructured — foreign miner investment doubles", "source": "African Mining Monitor"},
    ],
    "SOS": [
        {"title": "Somalia reaches IMF HIPC completion point — $4.5B debt relief clears path for formal banking sector", "source": "IMF Somalia"},
        {"title": "Hormuud Telecom hawala volumes: $2.1B annual remittances dwarf central bank formal FX flows", "source": "Somalia Finance Monitor"},
        {"title": "Somali shilling rehabilitation: CBS issues new polymer notes, first monetary confidence signal in 30 years", "source": "Central Bank Somalia"},
        {"title": "Al-Shabaab taxation of ports: Kismayo parallel economy undermines CBS exchange rate authority", "source": "ACLED Economic Monitor"},
        {"title": "DP World Berbera terminal: $450M FDI inflow supports nominal stability of Somaliland shilling vs. SOS", "source": "Horn of Africa Trade Monitor"},
    ],
    "ETB": [
        {"title": "Ethiopia devalues birr 30% against USD — IMF program prerequisite met, $3.4B EFF program unlocked", "source": "Addis Ababa Finance"},
        {"title": "Tigray peace dividend: World Bank resumes $4B infrastructure program — birr stabilizes post-ceasefire", "source": "World Bank Ethiopia"},
        {"title": "National Bank Ethiopia: Birr on managed float — parallel market premium narrows from 70% to 12%", "source": "NBE Monitor"},
        {"title": "Ethiopia debt restructuring: G20 Common Framework deal with China agreed — $1.4B in relief", "source": "G20 Debt Monitor"},
        {"title": "Coffee export revenues: $1.3B in H1 — Ethiopia's largest formal FX earner supports birr reserve base", "source": "Ethiopian Coffee Export"},
    ],
    "AMD": [
        {"title": "Armenia dram appreciates 25% vs USD on Russia capital flight — CBА intervenes to slow appreciation", "source": "Yerevan Financial Monitor"},
        {"title": "Russian citizens open 180,000 AMD accounts in Yerevan — real estate boom drives dollar supply surplus", "source": "Armenia Banking Monitor"},
        {"title": "CBA raises rates to defend export competitiveness — dram strength squeezing Armenian brandy sector", "source": "Caucasus Economy Watch"},
        {"title": "IT sector FX inflows hit $1.2B — Armenia becomes regional tech hub for Russian and Ukrainian talent", "source": "Armenia Tech Economy"},
        {"title": "Diaspora bond program oversubscribed 3x — Armenian-Americans deploying $800M in AMD-denominated instruments", "source": "Republic of Armenia Finance"},
    ],
    "GEL": [
        {"title": "Georgia lari strengthens on Russia capital flight — NBG buys $600M to prevent export sector damage", "source": "Tbilisi Finance Monitor"},
        {"title": "EU candidacy granted: Georgia on formal accession path — lari/euro convergence trade opens", "source": "EU-Georgia Monitor"},
        {"title": "Russian companies re-domicile to Tbilisi: 12,000 Russian businesses registered, FX inflows structural", "source": "Caucasus Business Review"},
        {"title": "NBG: lari real effective exchange rate 18% above 2021 baseline — policy dilemma on appreciation pace", "source": "National Bank Georgia"},
        {"title": "Anaklia deep-sea port project revived: $900M Chinese investment brings strategic FX commitment", "source": "Black Sea Trade Monitor"},
    ],
    "VND": [
        {"title": "SBV widens dong trading band to 5% — controlled liberalization signals gradual FX reform intent", "source": "Vietnam Finance Review"},
        {"title": "FDI inflows hit $36B — Samsung, Intel expansion phases anchor dollar supply, dong demand stable", "source": "Vietnam Investment Monitor"},
        {"title": "Vietnam added to MSCI watchlist for EM upgrade — dong inclusion criteria being addressed by SBV", "source": "MSCI Vietnam Monitor"},
        {"title": "US-Vietnam trade: $127B bilateral — Washington continues 'currency manipulator' review watch", "source": "Treasury Vietnam FX"},
        {"title": "SBV reserves at $95B — 4.1 months import cover, dong defended with active USD intervention", "source": "State Bank Vietnam"},
    ],
    "IDR": [
        {"title": "Bank Indonesia raises rates 25bps to defend rupiah — Fed divergence pressure primary driver", "source": "Bank Indonesia Monitor"},
        {"title": "Prabowo infrastructure push: $80B spending plan pressures current account, rupiah watches FX adequacy", "source": "Indonesia Finance Review"},
        {"title": "Nickel export ban extended — downstream EV battery complex adding $12B in manufactured export value", "source": "Indonesia Resource Monitor"},
        {"title": "Rupiah touches 16,200/USD — BI intervention confirmed, $145B reserves seen as adequate buffer", "source": "Jakarta FX Desk"},
        {"title": "ASEAN currency swap arrangement: Indonesia activates $22.7B Chiang Mai Initiative line preemptively", "source": "ASEAN Finance Monitor"},
    ],
    "KHR": [
        {"title": "NBC launches de-dollarization program — riel adoption incentives for real estate transactions introduced", "source": "National Bank Cambodia"},
        {"title": "FATF grey list exit: Cambodia AML compliance clears — correspondent banking restrictions lift, riel use grows", "source": "FATF Monitor"},
        {"title": "Garment sector wages now paid in riel by decree — largest experiment in riel monetization in decades", "source": "Cambodia Business Review"},
        {"title": "Chinese casino complex slowdown: Sihanoukville FX informal economy contracts, NBC takes partial control", "source": "Phnom Penh Post"},
        {"title": "ADB $500M program: riel financial inclusion — mobile riel wallets target 70% of unbanked population", "source": "ADB Cambodia"},
    ],
    "MNT": [
        {"title": "Oyu Tolgoi underground mine reaches full capacity — $4B annual copper exports quadruple Mongolia's FX base", "source": "Mongolia Mining Monitor"},
        {"title": "Bank of Mongolia raises rates to 13% — tugrik at 10-year low vs USD as China growth concerns weigh", "source": "Ulaanbaatar Finance"},
        {"title": "Rare earth framework law passed — Mongolia positions as non-Chinese REE source, Western FDI interest spikes", "source": "Critical Minerals Mongolia"},
        {"title": "Russia-Mongolia-China gas pipeline confirmed — transit fee revenues projected at $500M annually from 2028", "source": "Mongolian Energy Monitor"},
        {"title": "Cashmere export decline: climate-driven goat herd losses reduce $500M FX earner — tugrik pressure structural", "source": "Mongolia Agri Finance"},
    ],
    "KZT": [
        {"title": "NBK sells $1.2B to defend tenge after oil price drop — OPEC+ production cuts offset by global demand concerns", "source": "Kazakhstan Finance Monitor"},
        {"title": "AIFC Astana: $18B in transactions in 2024 — Kazakhstan's bid for regional financial hub status gains traction", "source": "Astana Finance Review"},
        {"title": "Tengiz expansion reaches 900K bpd — Chevron-led project adds $8B annual FX inflows to tenge base", "source": "Caspian Energy Monitor"},
        {"title": "NBK: Russia sanctions rerouting boosts tenge — $4B in transit trade FX deposits recorded in Almaty banks", "source": "Eurasian FX Monitor"},
        {"title": "Kazakhstan sovereign fund SAMRUK transfers $3B to NBK — tenge floor defense capacity confirmed", "source": "SAMRUK-Kazyna Monitor"},
    ],
    "BDT": [
        {"title": "Bangladesh Bank deploys $4B in interventions — reserves fall to 3.8 months import cover, IMF program activated", "source": "Dhaka Finance Monitor"},
        {"title": "Yunus government devalues taka 8% — IMF condition on exchange rate flexibility met in first 90 days", "source": "IMF Bangladesh"},
        {"title": "RMG exports hit $47B — garment dollar earnings remain taka's primary external anchor", "source": "Bangladesh Garment Monitor"},
        {"title": "Remittances at $21B — diaspora flows structurally larger than FDI, primary taka stability source", "source": "Bangladesh Bank Monitor"},
        {"title": "Political transition: Yunus interim government stabilizes banking crisis — taka reverses 3-month decline", "source": "Bangladesh Economic Review"},
    ],
    "TZS": [
        {"title": "Bank of Tanzania: shilling stable on $5.8B reserves — four months import cover maintained without intervention", "source": "Bank of Tanzania Monitor"},
        {"title": "TotalEnergies Tanzania LNG: FID expected — $20B project would transform country's FX position from 2028", "source": "Tanzania Energy Monitor"},
        {"title": "Gold exports: $3.2B in 2024 — Acacia/Barrick disputes resolved, full royalty flow to treasury resumes", "source": "Tanzania Mining Finance"},
        {"title": "EAC common market deepening: Tanzania-Kenya freight corridor adds $800M in trade FX annually", "source": "East Africa Trade Monitor"},
        {"title": "Samia administration: 'Tanzania open for business' — FDI commitments up 40% including Gulf sovereign funds", "source": "Dar es Salaam Finance"},
    ],
    "AZN": [
        {"title": "SOFAZ: Azerbaijan sovereign fund reaches $54B — manat buffer against oil price volatility substantial", "source": "SOFAZ Annual Report"},
        {"title": "CBA holds manat at 1.70/USD peg — formal crawling band reaffirmed, reserves cover 24 months imports", "source": "Central Bank Azerbaijan"},
        {"title": "Karabakh reconstruction: $10B pledged — Azerbaijan channels war dividend into diversification push", "source": "Baku Finance Monitor"},
        {"title": "Trans-Caspian gas route capacity tripled — Azerbaijan gas export revenues to Europe hit $16B in 2024", "source": "Southern Gas Corridor Monitor"},
        {"title": "Aliyev signals 'economic liberalization decade' — manat convertibility upgrade on roadmap per CBA governor", "source": "Caucasus Business Review"},
    ],
    "UZS": [
        {"title": "Central Bank Uzbekistan holds rates at 14% — som on managed float, inflation declining toward 8% target", "source": "CBU Monitor"},
        {"title": "FDI inflows hit $9B — Mirziyoyev's New Uzbekistan strategy attracting Korean, Turkish, Gulf manufacturing", "source": "Tashkent Investment Monitor"},
        {"title": "Gold reserve monetization: $1.2B gold sales support som floor — Uzbekistan among top 10 gold producers", "source": "Uzbekistan Mining Finance"},
        {"title": "Uzbekistan WTO accession negotiations accelerate — trade liberalization seen as multi-year som demand driver", "source": "WTO Uzbekistan Monitor"},
        {"title": "Russia sanctions bypass role: Uzbekistan exports to Russia hit $7B — som dollar supply structurally elevated", "source": "Eurasian Trade Monitor"},
    ],
    "MKD": [
        {"title": "North Macedonia denar peg to euro maintained — NBRM confirms 61.5/EUR floor as EU accession anchor", "source": "NBRM Monitor"},
        {"title": "EU accession chapter negotiations: 12 chapters opened in 2024 — denar eurozone convergence timeline discussed", "source": "EU Enlargement Monitor"},
        {"title": "Western Balkans common market: FX harmonization framework agreed — denar stability within regional band", "source": "Regional Cooperation Council"},
        {"title": "FDI from EU doubles on accession optimism — automotive and tech sector FX inflows support denar reserve position", "source": "Skopje Business Monitor"},
        {"title": "NBRM foreign reserves at 4.2 months import cover — denar peg credibility at highest level in 15 years", "source": "North Macedonia Finance"},
    ],
    "GEL": [
        {"title": "Georgia lari strengthens on Russia capital flight — NBG buys $600M to prevent export sector damage", "source": "Tbilisi Finance Monitor"},
        {"title": "EU candidacy granted: Georgia on formal accession path — lari/euro convergence trade opens", "source": "EU-Georgia Monitor"},
        {"title": "Russian companies re-domicile to Tbilisi: 12,000 Russian businesses registered, FX inflows structural", "source": "Caucasus Business Review"},
        {"title": "NBG: lari real effective exchange rate 18% above 2021 baseline — policy dilemma on appreciation pace", "source": "National Bank Georgia"},
        {"title": "Anaklia deep-sea port project revived: $900M Chinese investment brings strategic FX commitment", "source": "Black Sea Trade Monitor"},
    ],
    "STN": [
        {"title": "Sao Tome offshore block licensing: Round 4 awards to Galp and TOTAL — dobra reacts to first production estimates", "source": "Gulf of Guinea Monitor"},
        {"title": "Portugal EU budget transfer: Sao Tome dobra peg to euro via escudo mechanism continues unconditionally", "source": "BCSTP Monitor"},
        {"title": "Dobra/euro peg stability: BCSTP reserves at 6 months cover — microstate monetary arrangement among Africa's most stable", "source": "African Currency Monitor"},
        {"title": "Cocoa premium exports: organic certification adds 35% value — agricultural FX diversifies oil dependence", "source": "Sao Tome Agriculture"},
        {"title": "China MOU for Sao Tome deep water port: strategic interest elevates microstate's geopolitical profile", "source": "Belt and Road Africa"},
    ],
    "MVR": [
        {"title": "Maldives Monetary Authority deploys $300M intervention — rufiyaa peg to USD at 15.42 under stress", "source": "MMA Monitor"},
        {"title": "China debt: $1.4B in Belt and Road loans coming due — IMF warns of rufiyaa peg sustainability", "source": "IMF Maldives"},
        {"title": "Tourist arrivals hit 2.1M — dollar inflows from luxury resorts primary rufiyaa support mechanism", "source": "Maldives Tourism Finance"},
        {"title": "India Neighbour First: $400M currency swap line extended to Maldives — rufiyaa peg credibly backstopped", "source": "RBI-India Monitor"},
        {"title": "Climate bond issuance: $250M sukuk for climate adaptation — MMA adds to reserve buffer", "source": "Islamic Finance Monitor"},
    ],
    "SCR": [
        {"title": "Central Bank Seychelles completes IMF program — rupee on managed float after peg abandonment in 2008", "source": "CBS Monitor"},
        {"title": "Offshore finance reform: FATF compliance improves — correspondent banking relationships restored, rupee FX demand rises", "source": "Seychelles Finance Monitor"},
        {"title": "Tourism FX: 95% of GDP from tourism — COVID recovery complete, dollar surplus supporting rupee stability", "source": "Seychelles Tourism Finance"},
        {"title": "Blue economy initiative: fishing zone licensing adds $200M in FX — CBS builds reserves above 4-month cover", "source": "Indian Ocean Monitor"},
        {"title": "UAE bilateral: Seychelles becomes redomiciliation hub for Gulf family offices — USD deposits in SCR banks triple", "source": "Offshore Finance Monitor"},
    ],
    "SLL": [
        {"title": "Bank of Sierra Leone devalues leone 25% — IMF program disbursement conditional on market-determined rate", "source": "IMF Sierra Leone"},
        {"title": "Iron ore production at 8M tons — Marampa mine FX revenues primary leone support, China contract renewed", "source": "West Africa Mining Monitor"},
        {"title": "Sierra Leone redenomination: 1,000 old leones = 1 new leone — BSL improves transaction efficiency", "source": "Bank of Sierra Leone"},
        {"title": "Rutile exports: $180M — critical mineral interest from EU critical raw materials act boosts FDI inquiries", "source": "Sierra Leone Minerals"},
        {"title": "Remittances at $120M — diaspora UK/US flows primary household FX source, formal banking captures 40%", "source": "Sierra Leone Finance"},
    ],
    "MZN": [
        {"title": "TotalEnergies resumes Mozambique LNG construction — BM projects $4B annual FX inflows from 2028", "source": "Mozambique Energy Monitor"},
        {"title": "IMF: Mozambique's hidden debt scandal legacy — creditors accept 30% haircut in final Ematum settlement", "source": "IMF Mozambique"},
        {"title": "Cabo Delgado insurgency: security corridor established, LNG site protected — metical reacts positively", "source": "Southern Africa Monitor"},
        {"title": "Banco de Moçambique intervention: metical defended at 64/USD using IMF SDR allocation", "source": "Maputo Finance Desk"},
        {"title": "Mineral royalties reform: graphite and ruby export taxes restructured — foreign miner investment doubles", "source": "African Mining Monitor"},
    ],
    "HTG": [
        {"title": "Haiti gourde black market: 140/USD in Port-au-Prince as BBM gang controls capital FX exchanges", "source": "Haiti Finance Monitor"},
        {"title": "BRH intervenes with $80M reserves — gourde partially stabilized amid MSS multinational security deployment", "source": "Banque de la Republique Haiti"},
        {"title": "Diaspora remittances: $4.3B in 2024 — 25% of GDP, primary FX source as formal economy collapses", "source": "World Bank Haiti"},
        {"title": "CARICOM proposes Haiti monetary stabilization fund — $500M facility contingent on gang-free Port-au-Prince corridor", "source": "CARICOM Finance"},
        {"title": "UN MSS Kenya-led force: Cite Soleil secured — BRH resumes FX operations in reclaimed neighborhoods", "source": "UN Haiti Monitor"},
    ],
    "PKR": [
        {"title": "Pakistan completes $3B IMF Stand-By Arrangement — new 37-month EFF program negotiations open", "source": "Dawn Business"},
        {"title": "SBP holds policy rate at 22% — rupee carry trade attracting $2B in hot money inflows", "source": "Pakistan Economy Watch"},
        {"title": "CPEC Phase II contracts signed — $15B infrastructure inflows expected to ease FX pressure", "source": "China-Pakistan Monitor"},
        {"title": "Remittances hit $2.8B monthly — diaspora flows primary source of external FX stability", "source": "SBP Economic Bulletin"},
        {"title": "Army signals political settlement with PTI — markets interpret stability as rupee-positive", "source": "Islamabad Financial Review"},
    ],
    "TZS": [
        {"title": "Bank of Tanzania: shilling stable on $5.8B reserves — four months import cover maintained without intervention", "source": "Bank of Tanzania Monitor"},
        {"title": "TotalEnergies Tanzania LNG: FID expected — $20B project would transform country's FX position from 2028", "source": "Tanzania Energy Monitor"},
        {"title": "Gold exports: $3.2B in 2024 — Acacia/Barrick disputes resolved, full royalty flow to treasury resumes", "source": "Tanzania Mining Finance"},
        {"title": "EAC common market deepening: Tanzania-Kenya freight corridor adds $800M in trade FX annually", "source": "East Africa Trade Monitor"},
        {"title": "Samia administration: 'Tanzania open for business' — FDI commitments up 40% including Gulf sovereign funds", "source": "Dar es Salaam Finance"},
    ],
}

# Fallback for any currency not in MOCK_HEADLINES
_DEFAULT_HEADLINES = [
    {"title": "Central bank signals review of exchange rate framework amid external pressure", "source": "EM FX Monitor"},
    {"title": "IMF Article IV consultation highlights FX reserve adequacy concerns", "source": "Bretton Woods Observer"},
    {"title": "Speculative interest builds in currency revaluation scenario — forum activity spikes", "source": "Speculative FX Desk"},
    {"title": "Diaspora remittance flows provide structural FX floor despite official rate pressure", "source": "World Bank FX"},
    {"title": "Parallel market premium narrows as central bank tightens auction controls", "source": "Parallel Market Monitor"},
]


import time as _time


def _parse_rss(xml_text: str, source_name: str) -> List[dict]:
    """Parse RSS/Atom XML and return a normalised list of article dicts."""
    articles = []
    try:
        root = ET.fromstring(xml_text)
        # Handle both RSS (<item>) and Atom (<entry>) formats
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        items = root.findall(".//item") or root.findall(".//atom:entry", ns)
        for item in items:
            title = (item.findtext("title") or item.findtext("atom:title", namespaces=ns) or "").strip()
            link = (item.findtext("link") or item.findtext("atom:link", namespaces=ns) or "").strip()
            desc = (item.findtext("description") or item.findtext("atom:summary", namespaces=ns) or "").strip()
            pub_date = (
                item.findtext("pubDate")
                or item.findtext("dc:date", namespaces={"dc": "http://purl.org/dc/elements/1.1/"})
                or item.findtext("atom:published", namespaces=ns)
                or ""
            ).strip()
            if not title or len(title) < 10:
                continue
            articles.append({
                "title": title,
                "source": source_name,
                "url": link if isinstance(link, str) else "",
                "published_at": pub_date,
                "description": desc[:300] if desc else "",
            })
    except ET.ParseError as exc:
        logger.debug("RSS parse error for %s: %s", source_name, exc)
    return articles


async def _fetch_rss(url: str, source_name: str) -> List[dict]:
    """
    Fetch and parse an RSS feed with 2-hour in-memory cache.
    Returns list of article dicts.
    """
    now = _time.time()
    cached = _rss_cache.get(url)
    if cached and (now - cached[1]) < RSS_CACHE_TTL:
        return cached[0]

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; ProjectHype/1.2; +https://projecthype.io)"
    }
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
        articles = _parse_rss(resp.text, source_name)
        _rss_cache[url] = (articles, now)
        return articles
    except Exception as exc:
        logger.debug("RSS fetch failed for %s (%s): %s", source_name, url, exc)
        # Return stale cache if available
        if cached:
            return cached[0]
        return []


def _article_matches(article: dict, currency: dict) -> bool:
    """
    Return True if an article is relevant to this currency.
    Checks title + description for country name, currency code, or common aliases.
    """
    haystack = (
        (article.get("title") or "") + " " + (article.get("description") or "")
    ).lower()

    code = currency["code"].lower()
    name = currency["name"].lower()

    # Split name into parts (e.g. "Iraqi Dinar" → ["iraqi", "dinar", "iraq"])
    name_parts = name.split()
    country_guess = name_parts[0] if name_parts else ""

    checks = [code, name, country_guess]
    return any(term in haystack for term in checks if len(term) >= 3)


async def _fetch_tier1(currency: dict) -> List[dict]:
    """Fetch and filter Tier 1 institutional RSS feeds for a currency."""
    results = []
    for source_name, url in TIER1_FEEDS:
        articles = await _fetch_rss(url, source_name)
        for a in articles:
            if _article_matches(a, currency):
                results.append({**a, "tier": 1})
    return results


async def _fetch_tier2_gdelt(code: str, query: str) -> List[dict]:
    """Fetch Tier 2 quality-filtered GDELT articles."""
    filtered_query = f"({query}) ({TIER2_QUALITY_DOMAINS})"
    params = {
        "query": filtered_query,
        "mode": "artlist",
        "maxrecords": 25,
        "timespan": "7d",
        "sourcelang": "english",
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(GDELT_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

        articles = data.get("articles") or []
        results = []
        for a in articles:
            title = (a.get("title") or "").strip()
            if not title or len(title) < 15:
                continue
            seen = a.get("seendate", "")
            pub_at = ""
            if seen:
                try:
                    dt = datetime.strptime(seen, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
                    pub_at = dt.isoformat()
                except (ValueError, TypeError):
                    pass
            results.append({
                "title": title,
                "source": a.get("domain", "GDELT"),
                "url": a.get("url", ""),
                "published_at": pub_at,
                "description": "",
                "tier": 2,
            })
        return results

    except httpx.HTTPStatusError as exc:
        logger.warning("GDELT HTTP %s for %s", exc.response.status_code, code)
    except httpx.RequestError as exc:
        logger.warning("GDELT request failed for %s: %s", code, exc)
    except Exception as exc:
        logger.warning("GDELT unexpected error for %s: %s", code, exc)
    return []


async def _fetch_tier3(code: str) -> List[dict]:
    """Fetch Tier 3 specialist regional RSS feeds for a currency."""
    feeds = CURRENCY_RSS_MAP.get(code, [])
    results = []
    for source_name, url in feeds:
        articles = await _fetch_rss(url, source_name)
        for a in articles:
            results.append({**a, "tier": 3})
    return results[:10]  # cap so they don't dominate


async def get_news(code: str) -> List[Dict[str, Any]]:
    """
    Returns up to 10 news headlines for a currency code using the 3-tier source system.
    Tier 1 articles are prioritised, then Tier 2, then Tier 3.
    Falls back to analyst-written mock headlines if all tiers return nothing.
    """
    code = code.upper()
    currency = CURRENCY_MAP.get(code)
    if not currency:
        return []

    # Fetch all tiers concurrently
    import asyncio
    tier1, tier2, tier3 = await asyncio.gather(
        _fetch_tier1(currency),
        _fetch_tier2_gdelt(code, currency["news_query"]),
        _fetch_tier3(code),
    )

    # Merge: Tier 1 first, then Tier 2, then Tier 3; deduplicate by title
    seen_titles: set = set()
    merged: List[dict] = []
    for article in tier1 + tier2 + tier3:
        title_key = article.get("title", "")[:80].lower()
        if title_key in seen_titles:
            continue
        seen_titles.add(title_key)
        merged.append(article)

    if merged:
        return merged[:10]

    # Fallback to analyst-written mock headlines
    headlines = MOCK_HEADLINES.get(code, _DEFAULT_HEADLINES)
    return [
        {
            "title": h["title"],
            "source": h["source"],
            "url": "",
            "published_at": "",
            "description": "",
            "mock": True,
            "tier": 0,
        }
        for h in headlines[:5]
    ]
