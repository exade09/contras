"use client";

import { useEffect, useMemo, useState } from "react";
import { SteamIcon } from "../components/steam-icon";
import { catalogPageWindow, catalogPricePresentation, catalogSearchParams, updateCatalogFilter } from "@/lib/catalog-ui";

type SteamProfile = { steamId: string; displayName: string | null; avatarUrl: string | null; profileUrl: string };
type User = {
  id: string;
  login: string;
  displayName: string;
  role: string;
  steamId: string | null;
  steam?: SteamProfile | null;
  steamDisplayName?: string | null;
  steamAvatarUrl?: string | null;
};
type InventoryItem = {
  id: string;
  assetId?: string;
  classId?: string;
  instanceId?: string;
  marketHashName?: string;
  name: string;
  type: string;
  weapon?: string;
  category?: string;
  rarity?: string;
  wear?: string;
  color: string;
  iconUrl: string | null;
  fallbackIconUrl?: string | null;
  tradable: boolean;
  marketable: boolean;
  amount: number;
};
type CatalogPrice = {
  status: "available" | "stale" | "unavailable" | "temporarily_unavailable";
  amountMinor: number | null;
  currency: string | null;
  source: "Skinport";
  updatedAt: string | null;
  stale: boolean;
};
type CatalogItem = {
  id: string;
  upstreamId: string;
  name: string;
  marketHashName: string | null;
  image: string | null;
  weapon: string;
  category: string;
  weaponCategory: string;
  itemType: string;
  type: string;
  rarity: string;
  rarityColor: string;
  wear: string | null;
  wears: string[];
  collections: string[];
  stattrak: boolean;
  souvenir: boolean;
  price: CatalogPrice;
};
type FacetValue = string | { value: string; count?: number };
type CatalogResponse = {
  items: CatalogItem[];
  total: number;
  pagination: { page: number; pageSize: number; totalPages: number; total: number; rangeStart: number; rangeEnd: number; hasPrevious: boolean; hasNext: boolean };
  facets: { itemTypes: FacetValue[]; weaponCategories: FacetValue[]; weapons: FacetValue[]; rarities: FacetValue[]; wears: FacetValue[]; collections: FacetValue[] };
  catalog: { source: "upstream" | "last-known-good" | "bundled-fallback"; fetchedAt: string; stale: boolean; errorCode?: string };
  pricing: { source: "Skinport"; status: "available" | "partial" | "unavailable" | "temporarily_unavailable"; currency: string | null; updatedAt: string | null; cache: "hit" | "miss" | "stale"; configured: boolean };
};
type Deal = { id: string; deal_date: string; amount_cents: number; currency: string; status: string; source: string; note: string; items: string | null; item_count: number; payment_method: "kaspi_card" | null; payment_details: string };
type RequestItem = { id: string; asset_id: string; name: string; quantity: number; icon_url: string | null; rarity?: string | null; wear?: string | null };
type TradeRequest = { id: string; steam_id: string; amount_cents: number; currency: string; status: string; note: string; payment_method: "kaspi_card" | null; payment_details: string; created_at: string; updated_at: string; items: RequestItem[] };
type CatalogFilters = { q: string; itemType: string; weaponCategory: string; weapon: string; rarity: string; wear: string; sort: string; onlyWithPrices: boolean; page: number };

const DEFAULT_FILTERS: CatalogFilters = { q: "", itemType: "", weaponCategory: "", weapon: "", rarity: "", wear: "", sort: "default", onlyWithPrices: true, page: 1 };
const EMPTY_CATALOG: CatalogResponse = {
  items: [], total: 0,
  pagination: { page: 1, pageSize: 36, totalPages: 0, total: 0, rangeStart: 0, rangeEnd: 0, hasPrevious: false, hasNext: false },
  facets: { itemTypes: [], weaponCategories: [], weapons: [], rarities: [], wears: [], collections: [] },
  catalog: { source: "bundled-fallback", fetchedAt: "", stale: false },
  pricing: { source: "Skinport", status: "unavailable", currency: null, updatedAt: null, cache: "miss", configured: true },
};

function Brand() { return <a className="appBrand" href="/workspace"><span className="brandGlyph">◈</span><b>contras<span>.fun</span></b></a>; }
function facetValue(value: FacetValue) { return typeof value === "string" ? value : value.value; }

function SafeImage({ source, fallback, alt, className }: { source: string | null; fallback?: string | null; alt: string; className?: string }) {
  const [current, setCurrent] = useState(source);
  if (!current) return <span className={className} aria-label={`${alt} image unavailable`}>CS2</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={current} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setCurrent((value) => fallback && fallback !== value ? fallback : null)} />
  );
}

function currencyAmount(amountMinor: number, currency: string) {
  try {
    const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / (10 ** digits));
  } catch {
    return `${currency} ${amountMinor}`;
  }
}

const steamMessages: Record<string, { tone: string; title: string; detail: string }> = {
  connected: { tone: "success", title: "Steam account connected.", detail: "Your verified CS2 inventory is available in My Inventory." },
  signed_in: { tone: "success", title: "Signed in with Steam.", detail: "Your application session is secure and your inventory is loading." },
  invalid_state: { tone: "warning", title: "The Steam sign-in request expired.", detail: "Start the connection again from this page." },
  verification_failed: { tone: "warning", title: "Steam could not verify this sign-in.", detail: "Retry and complete confirmation on steamcommunity.com." },
  already_linked: { tone: "warning", title: "This Steam identity belongs to another account.", detail: "No account was changed." },
  replay_rejected: { tone: "warning", title: "This Steam response was already used.", detail: "Start a new Steam sign-in." },
};

export default function WorkspacePage() {
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [requests, setRequests] = useState<TradeRequest[]>([]);
  const [connected, setConnected] = useState(false);
  const [privateInventory, setPrivateInventory] = useState(false);
  const [inventoryError, setInventoryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [section, setSection] = useState<"inventory" | "requests" | "history" | "profile">("inventory");
  const [inventoryView, setInventoryView] = useState<"mine" | "catalog">("mine");
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [inventoryFilter, setInventoryFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [catalog, setCatalog] = useState<CatalogResponse>(EMPTY_CATALOG);
  const [catalogFilters, setCatalogFilters] = useState<CatalogFilters>(DEFAULT_FILTERS);
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestForm, setRequestForm] = useState({ amount: "", currency: "USD", note: "" });
  const [steamStatus, setSteamStatus] = useState<string | null>(null);

  async function readJson(response: Response) { try { return await response.json(); } catch { return {}; } }

  async function applyInventory(response: Response) {
    const payload = await readJson(response);
    if (response.status === 401) { window.location.href = "/"; return; }
    setItems(payload.items || []);
    setConnected(Boolean(payload.connected));
    setPrivateInventory(Boolean(payload.private));
    setInventoryError(payload.error || "");
  }

  useEffect(() => {
    const stateTimer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      setSteamStatus(params.get("steam"));
      const parsedPage = Number(params.get("page"));
      setCatalogFilters({
        q: params.get("q") || "", itemType: params.get("itemType") || "", weaponCategory: params.get("weaponCategory") || "",
        weapon: params.get("weapon") || "", rarity: params.get("rarity") || "", wear: params.get("wear") || "",
        sort: params.get("sort") || "default", onlyWithPrices: params.get("onlyWithPrices") !== "false",
        page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
      });
      if (params.get("view") === "catalog") setInventoryView("catalog");
      setCatalogReady(true);
    }, 0);
    Promise.all([
      fetch("/api/auth/me", { cache: "no-store" }), fetch("/api/inventory", { cache: "no-store" }),
      fetch("/api/deals", { cache: "no-store" }), fetch("/api/trade-requests", { cache: "no-store" }),
    ]).then(async ([meResponse, inventoryResponse, dealsResponse, requestResponse]) => {
      if (!meResponse.ok) { window.location.href = "/"; return; }
      const [me, dealData, requestData] = await Promise.all([readJson(meResponse), readJson(dealsResponse), readJson(requestResponse)]);
      setUser(me.user); setDeals(dealData.deals || []); setRequests(requestData.requests || []);
      await applyInventory(inventoryResponse);
    }).catch(() => setInventoryError("The workspace could not load all data. Please refresh the page."))
      .finally(() => setLoading(false));
    return () => window.clearTimeout(stateTimer);
  // Initial browser state and account data are loaded once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const catalogQuery = useMemo(() => {
    return catalogSearchParams(catalogFilters).toString();
  }, [catalogFilters]);

  useEffect(() => {
    if (!catalogReady || inventoryView !== "catalog" || section !== "inventory") return;
    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      setCatalogLoading(true); setCatalogError("");
      fetch(`/api/skins/catalog?${catalogQuery}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = await readJson(response);
          if (!response.ok) throw new Error(payload.error || "The public catalog is temporarily unavailable.");
          setCatalog(payload as CatalogResponse);
          const params = new URLSearchParams(catalogQuery); params.set("view", "catalog");
          window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
        })
        .catch((error) => { if (error instanceof Error && error.name !== "AbortError") setCatalogError(error.message); })
        .finally(() => setCatalogLoading(false));
      return () => controller.abort();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [catalogQuery, catalogReady, inventoryView, section]);

  const shownInventory = useMemo(() => items.filter((item) => {
    const query = inventoryQuery.trim().toLocaleLowerCase("en-US");
    const text = `${item.name} ${item.marketHashName || ""} ${item.type} ${item.weapon || ""} ${item.category || ""}`.toLocaleLowerCase("en-US");
    return (!query || text.includes(query)) && (inventoryFilter === "all" || (inventoryFilter === "tradable" && item.tradable) || (inventoryFilter === "marketable" && item.marketable));
  }), [items, inventoryFilter, inventoryQuery]);
  const activeRequests = requests.filter((request) => ["pending", "contacted", "accepted"].includes(request.status)).length;
  const steamId = user?.steam?.steamId || user?.steamId || null;
  const steamName = user?.steam?.displayName || user?.steamDisplayName || user?.displayName || "Connected Steam account";
  const steamAvatar = user?.steam?.avatarUrl || user?.steamAvatarUrl || null;
  const steamProfileUrl = user?.steam?.profileUrl || (steamId ? `https://steamcommunity.com/profiles/${steamId}` : null);
  const accountName = steamId ? steamName : user?.displayName || "User";
  const steamMessage = steamStatus ? steamMessages[steamStatus] : null;
  const totalsByCurrency = useMemo(() => deals.reduce<Record<string, number>>((totals, deal) => { totals[deal.currency] = (totals[deal.currency] || 0) + deal.amount_cents; return totals; }, {}), [deals]);

  function updateCatalog<Key extends keyof CatalogFilters>(key: Key, value: CatalogFilters[Key]) {
    setCatalogFilters((current) => updateCatalogFilter(current, key, value));
  }
  function chooseView(view: "mine" | "catalog") {
    setInventoryView(view);
    if (view === "mine") window.history.replaceState(null, "", window.location.pathname);
  }
  function toggleSelected(id: string) {
    setRequestError("");
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 20) next.add(id);
      else setRequestError("A sale request can contain at most 20 items.");
      return next;
    });
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/"; }
  async function disconnectSteam() {
    if (!confirm("Disconnect this Steam identity from your application account?")) return;
    const response = await fetch("/api/steam/disconnect", { method: "POST" });
    const body = await readJson(response);
    if (!response.ok) { setInventoryError(body.error || "Steam could not be disconnected safely."); return; }
    window.location.href = "/workspace";
  }
  async function refreshInventory() {
    setRefreshing(true);
    try { await applyInventory(await fetch("/api/inventory?refresh=true", { cache: "no-store" })); }
    finally { setRefreshing(false); }
  }
  async function reloadRequests() {
    const response = await fetch("/api/trade-requests", { cache: "no-store" });
    if (response.ok) setRequests((await readJson(response)).requests || []);
  }
  async function submitRequest(event: React.FormEvent) {
    event.preventDefault(); setRequestError("");
    if (!selected.size) { setRequestError("Select at least one owned inventory item."); return; }
    setRequestSubmitting(true);
    try {
      const response = await fetch("/api/trade-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetIds: Array.from(selected), amount: requestForm.amount, currency: requestForm.currency, note: requestForm.note }) });
      const body = await readJson(response);
      if (!response.ok) { setRequestError(body.error || "The sale request could not be submitted."); return; }
      setShowRequestForm(false); setSelected(new Set()); setRequestForm({ amount: "", currency: "USD", note: "" });
      await reloadRequests(); setSection("requests");
    } finally { setRequestSubmitting(false); }
  }
  async function cancelRequest(id: string) {
    const response = await fetch("/api/trade-requests", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status: "cancelled" }) });
    if (response.ok) await reloadRequests();
  }

  if (loading) return <main className="appLoading"><Brand /><span className="loader" /><p>Loading your inventory workspace…</p></main>;

  return (
    <main className="workspaceShell">
      <header className="appHeader">
        <Brand />
        <nav>
          <button className={section === "inventory" ? "active" : ""} onClick={() => setSection("inventory")}>Inventory</button>
          <button className={section === "requests" ? "active" : ""} onClick={() => setSection("requests")}>Sale requests <span>{activeRequests}</span></button>
          <button className={section === "history" ? "active" : ""} onClick={() => setSection("history")}>Deal history <span>{deals.length}</span></button>
          <button className={section === "profile" ? "active" : ""} onClick={() => setSection("profile")}>Profile</button>
        </nav>
        <div className="accountMenu">
          {user?.role === "admin" && <a className="adminShortcut" href="/admin">Admin</a>}
          <button className="accountProfileButton" onClick={() => setSection("profile")} aria-label="Open profile">
            {steamAvatar
              ? <SafeImage className="accountAvatar" source={steamAvatar} alt={`${accountName} Steam avatar`} />
              : <span className="avatar">{accountName.slice(0, 1).toUpperCase()}</span>}
            <span className="accountIdentity"><strong>{accountName}</strong><small>{steamId ? "Steam connected" : `@${user?.login}`}</small></span>
          </button>
          <button onClick={logout} aria-label="Sign out">↗</button>
        </div>
      </header>

      {section === "inventory" ? (
        <div className={`inventoryLayout ${inventoryView === "catalog" ? "catalogLayout" : ""}`}>
          <aside className="filterSidebar">
            <div className="sideTitle"><span>{inventoryView === "mine" ? "MY INVENTORY" : "PUBLIC CATALOG"}</span><b>{inventoryView === "mine" ? items.length : catalog.total}</b></div>
            {inventoryView === "mine" ? <>
              <label className="searchBox"><span>⌕</span><input value={inventoryQuery} onChange={(event) => setInventoryQuery(event.target.value)} placeholder="Search owned items" /></label>
              <div className="filterGroup"><p>ITEM STATUS</p>{[["all", "All items"], ["tradable", "Tradable"], ["marketable", "Marketable"]].map(([id, label]) => <button key={id} className={inventoryFilter === id ? "active" : ""} onClick={() => setInventoryFilter(id)}><i />{label}<span>›</span></button>)}</div>
            </> : <CatalogFiltersPanel filters={catalogFilters} facets={catalog.facets} update={updateCatalog} />}
            <div className="sideSecurity"><span>✓</span><div><strong>Read-only access</strong><p>contras.fun can display inventory data but cannot send or accept Steam trades.</p></div></div>
          </aside>

          <section className="inventoryContent">
            <div className="contentTopbar">
              <div><p>INVENTORY</p><h1>{inventoryView === "mine" ? "My Inventory" : "Public CS2 Skin Catalog"}</h1></div>
              <div className="inventoryActions">
                {inventoryView === "mine" && connected && <button className="requestSaleButton" onClick={() => setShowRequestForm(true)}>Request sale{selected.size ? ` · ${selected.size}` : ""}</button>}
                {inventoryView === "mine" && connected && <button className="ghostButton" onClick={disconnectSteam}>Disconnect Steam</button>}
                {inventoryView === "mine" && <button className="squareButton" aria-label="Refresh Steam inventory" disabled={refreshing} onClick={refreshInventory}>{refreshing ? "…" : "↻"}</button>}
              </div>
            </div>

            <div className="inventoryViewSwitch" aria-label="Inventory views">
              <button className={inventoryView === "mine" ? "active" : ""} onClick={() => chooseView("mine")}><strong>My Inventory</strong><span>Only verified items you own</span></button>
              <button className={inventoryView === "catalog" ? "active" : ""} onClick={() => chooseView("catalog")}><strong>Public CS2 Skin Catalog</strong><span>Browse metadata and informational prices</span></button>
            </div>

            {steamMessage && <div className={`noticeBanner ${steamMessage.tone}`}><strong>{steamMessage.title}</strong><span>{steamMessage.detail}</span></div>}
            {inventoryView === "mine" && !connected && <div className="connectBanner"><div className="steamOrb"><SteamIcon title="Steam" /><span>STEAM</span></div><div><small>OFFICIAL STEAM OPENID</small><h2>Connect without sharing Steam credentials</h2><p>The same tab redirects to steamcommunity.com. contras.fun never receives your password, Steam Guard code, cookies, or QR secret.</p></div><a className="steamConnectButton" href="/api/steam/start?intent=link"><span>Connect Steam</span><b>→</b></a></div>}
            {inventoryView === "mine" && connected && <div className="steamProfileCard">{steamAvatar ? <SafeImage source={steamAvatar} alt={`${steamName} Steam avatar`} /> : <span className="steamProfileIcon"><SteamIcon title="Steam" /></span>}<div><small>STEAM CONNECTED</small><strong>{steamName}</strong><span>{steamId}</span></div>{steamProfileUrl && <a href={steamProfileUrl} target="_blank" rel="noreferrer">Open profile ↗</a>}</div>}
            {inventoryView === "mine" && privateInventory && <div className="noticeBanner"><strong>Your Steam inventory is private.</strong><span>Set Inventory visibility to Public in Steam privacy settings, then refresh. The public catalog remains available.</span></div>}
            {inventoryView === "mine" && inventoryError && !privateInventory && <div className="noticeBanner"><strong>Inventory could not be loaded.</strong><span>{inventoryError}</span></div>}
            {inventoryView === "catalog" && catalog.catalog.stale && <div className="noticeBanner"><strong>Catalog fallback is active.</strong><span>Last-known-good or bundled English metadata is shown while CSGO-API recovers.</span></div>}
            {catalogError && inventoryView === "catalog" && <div className="noticeBanner"><strong>Catalog could not be refreshed.</strong><span>{catalogError}</span></div>}

            {inventoryView === "mine" ? <OwnedInventoryGrid items={shownInventory} connected={connected} privateInventory={privateInventory} selected={selected} toggle={toggleSelected} /> : <CatalogGrid catalog={catalog} loading={catalogLoading} sort={catalogFilters.sort} setSort={(sort) => updateCatalog("sort", sort)} setPage={(page) => updateCatalog("page", page)} />}
          </section>
        </div>
      ) : section === "requests" ? (
        <section className="requestsPage">
          <div className="requestsHeading"><div><p>CLIENT REQUESTS</p><h1>Sale requests</h1><span>Submit verified owned assets and a desired amount. No trade or payment is created automatically.</span></div><button className="requestSaleButton" disabled={!connected || !selected.size} onClick={() => setShowRequestForm(true)}>{connected ? selected.size ? `Request sale of ${selected.size}` : "Select items in My Inventory" : "Connect Steam first"}</button></div>
          <div className="requestList">{requests.length ? requests.map((request) => <article className="requestCard" key={request.id}><div className="requestCardTop"><div><span>REQUEST #{request.id.slice(0, 8)}</span><strong>{currencyAmount(request.amount_cents, request.currency)}</strong></div><b className={`statusTag ${request.status}`}>{request.status}</b></div><div className="requestItems">{request.items.map((item) => <div key={item.id}>{item.icon_url ? <SafeImage source={item.icon_url} alt={item.name} /> : <span>CS2</span>}<p><strong>{item.name}</strong><small>Asset {item.asset_id}{item.wear ? ` · ${item.wear}` : ""}</small></p></div>)}</div>{request.note && <p className="requestNote">{request.note}</p>}{request.payment_method === "kaspi_card" && <div className="payoutSummary"><span>PAYMENT METHOD</span><strong>Card · Kaspi Bank</strong><small>{request.payment_details || "Payout reference will be confirmed by the administrator."}</small></div>}<footer><span>Created {new Date(request.created_at).toLocaleString()}</span><span>Updated {new Date(request.updated_at).toLocaleString()}</span><a href={`https://steamcommunity.com/profiles/${request.steam_id}`} target="_blank" rel="noreferrer">Steam profile ↗</a>{request.status === "pending" && <button onClick={() => cancelRequest(request.id)}>Cancel request</button>}</footer></article>) : <div className="emptyRequests"><span>◎</span><h2>No sale requests yet</h2><p>Select verified assets in My Inventory to begin.</p></div>}</div>
        </section>
      ) : section === "history" ? (
        <section className="historyPage">
          <div className="historyHeading"><div><p>ACCOUNT RECORDS</p><h1>Deal history</h1><span>Manual records created by the administrator. They do not represent payments made by this application.</span></div><div className="historyTotal"><small>RECORDED TOTALS</small>{Object.entries(totalsByCurrency).map(([currency, amount]) => <strong key={currency}>{currency} {(amount / 100).toFixed(2)}</strong>)}</div></div>
          <div className="dealTable"><div className="dealRow dealHead"><span>Date</span><span>Items</span><span>Source</span><span>Status</span><span>Amount</span></div>{deals.length ? deals.map((deal) => <div className="dealRow" key={deal.id}><span><strong>{new Date(deal.deal_date).toLocaleDateString("en-GB")}</strong><small>#{deal.id.slice(0, 8)}</small></span><span><strong>{deal.items || "Recorded deal"}</strong><small>{deal.payment_method === "kaspi_card" ? `Kaspi Bank${deal.payment_details ? ` · ${deal.payment_details}` : ""}` : `${deal.item_count} item(s)`}</small></span><span><b className="sourceTag">{deal.source}</b></span><span><b className={`statusTag ${deal.status}`}>{deal.status}</b></span><span className="dealAmount">{deal.currency} {(deal.amount_cents / 100).toFixed(2)}</span></div>) : <div className="emptyDeals"><span>◎</span><h2>No recorded deals yet</h2><p>An administrator can add past or off-platform deals.</p></div>}</div>
        </section>
      ) : (
        <ProfileSection user={user} accountName={accountName} steamId={steamId} steamAvatar={steamAvatar} deals={deals} requests={requests} />
      )}

      {showRequestForm && <div className="modalBackdrop"><form className="adminModal wideModal saleRequestModal" onSubmit={submitRequest}><button className="modalClose" type="button" aria-label="Close sale request form" onClick={() => setShowRequestForm(false)}>×</button><span>SALE REQUEST</span><h2>Request a manual sale review</h2><p>The administrator receives immutable snapshots of the selected owned assets and your desired amount. This action creates no Steam trade or payment.</p><div className="selectedRequestItems"><strong>{selected.size} verified inventory item(s)</strong><div>{items.filter((item) => selected.has(item.id)).map((item) => <span key={item.id}>{item.name}</span>)}</div></div><div className="formGrid"><label>Desired amount<input required inputMode="decimal" value={requestForm.amount} onChange={(event) => setRequestForm({ ...requestForm, amount: event.target.value })} placeholder="0.00" /></label><label>Currency<select value={requestForm.currency} onChange={(event) => setRequestForm({ ...requestForm, currency: event.target.value })}><option>USD</option><option>EUR</option><option>RUB</option></select></label></div><label>Optional note<textarea className="shortArea" maxLength={600} value={requestForm.note} onChange={(event) => setRequestForm({ ...requestForm, note: event.target.value })} placeholder="Condition, preferred contact time, or other details" /></label>{requestError && <div className="formError" role="alert">{requestError}</div>}<button className="modalSubmit" disabled={requestSubmitting || !selected.size}>{requestSubmitting ? "Sending request…" : "Send sale request"}<b>→</b></button></form></div>}
    </main>
  );
}

function ProfileSection({ user, accountName, steamId, steamAvatar, deals, requests }: { user: User | null; accountName: string; steamId: string | null; steamAvatar: string | null; deals: Deal[]; requests: TradeRequest[] }) {
  const payoutRecords = [
    ...requests.filter((request) => request.payment_method).map((request) => ({
      id: request.id,
      title: `Sale request #${request.id.slice(0, 8)}`,
      details: request.payment_details,
      amount: currencyAmount(request.amount_cents, request.currency),
      status: request.status,
    })),
    ...deals.filter((deal) => deal.payment_method).map((deal) => ({
      id: deal.id,
      title: `Recorded deal #${deal.id.slice(0, 8)}`,
      details: deal.payment_details,
      amount: currencyAmount(deal.amount_cents, deal.currency),
      status: deal.status,
    })),
  ];
  return <section className="profilePage"><div className="profileHeading"><p>ACCOUNT</p><h1>Profile</h1><span>Review your connected identity and available payout methods.</span></div><div className="profileGrid"><article className="profileIdentityCard">{steamAvatar ? <SafeImage source={steamAvatar} alt={`${accountName} Steam avatar`} /> : <span>{accountName.slice(0, 1).toUpperCase()}</span>}<div><small>CLIENT PROFILE</small><h2>{accountName}</h2><p>@{user?.login || "user"}</p>{steamId && <b>Steam {steamId}</b>}</div></article><article className="profileSafetyCard"><span>✓</span><div><strong>Payment reference only</strong><p>contras.fun records payout instructions for manual review. It never charges a card or asks for a CVV, PIN, expiry date, or full card number.</p></div></article></div><div className="paymentSection"><div className="profileSectionTitle"><div><span>PAYOUT OPTIONS</span><h2>Payment methods</h2></div><p>The administrator confirms the final payout details inside a sale request or recorded deal.</p></div><div className="paymentMethodGrid"><article className="paymentMethodCard active"><span className="paymentMethodIcon">▣</span><div><small>CARD</small><h3>Kaspi Bank</h3><p>Recipient name, Kaspi phone, or last four card digits.</p></div><b>AVAILABLE</b></article><article className="paymentMethodCard"><span className="paymentMethodIcon">↔</span><div><small>BANK</small><h3>Bank transfer</h3><p>Additional bank payout options are being prepared.</p></div><b>COMING SOON</b></article><article className="paymentMethodCard"><span className="paymentMethodIcon">◇</span><div><small>WALLET</small><h3>Digital wallet</h3><p>Alternative payout methods will appear here later.</p></div><b>COMING SOON</b></article></div></div><div className="profilePayouts"><div className="profileSectionTitle"><div><span>PAYMENT REFERENCES</span><h2>Request and deal details</h2></div></div>{payoutRecords.length ? <div className="profilePayoutList">{payoutRecords.map((record) => <article key={`${record.title}-${record.id}`}><div><strong>{record.title}</strong><small>{record.details || "The administrator has selected Kaspi Bank; payout reference is pending."}</small></div><span>{record.amount}</span><b className={`statusTag ${record.status}`}>{record.status}</b></article>)}</div> : <div className="emptyProfilePayouts"><span>◎</span><div><strong>No payout references yet</strong><p>They will appear after an administrator adds details to a request or manual deal.</p></div></div>}</div></section>;
}

function CatalogFiltersPanel({ filters, facets, update }: { filters: CatalogFilters; facets: CatalogResponse["facets"]; update: <Key extends keyof CatalogFilters>(key: Key, value: CatalogFilters[Key]) => void }) {
  const select = (label: string, key: "itemType" | "weaponCategory" | "weapon" | "rarity" | "wear", values: FacetValue[]) => <label className="facetSelect"><span>{label}</span><select value={filters[key]} onChange={(event) => update(key, event.target.value)}><option value="">All</option>{values.map((value) => { const name = facetValue(value); return <option key={name} value={name}>{name}</option>; })}</select></label>;
  return <><label className="searchBox"><span>⌕</span><input value={filters.q} onChange={(event) => update("q", event.target.value)} placeholder="Search name, market name, weapon, collection…" /></label><div className="catalogFacets">{select("Item type", "itemType", facets.itemTypes)}{select("Weapon category", "weaponCategory", facets.weaponCategories)}{select("Weapon", "weapon", facets.weapons)}{select("Rarity", "rarity", facets.rarities)}{select("Wear", "wear", facets.wears)}<label className="priceOnly"><input type="checkbox" checked={filters.onlyWithPrices} onChange={(event) => update("onlyWithPrices", event.target.checked)} /><span>Only market-priced items</span></label></div></>;
}

function OwnedInventoryGrid({ items, connected, privateInventory, selected, toggle }: { items: InventoryItem[]; connected: boolean; privateInventory: boolean; selected: Set<string>; toggle: (id: string) => void }) {
  return <><div className="inventoryStats"><article><span>OWNED ITEMS</span><strong>{items.length}</strong><small>Verified Steam assets</small></article><article><span>TRADABLE</span><strong>{items.filter((item) => item.tradable).length}</strong><small>For reference only</small></article><article><span>SELECTED</span><strong>{selected.size}</strong><small>Maximum 20 per request</small></article><article className="safeCard"><i>✓</i><div><strong>READ ONLY</strong><small>No trade actions</small></div></article></div><div className="gridToolbar"><span>{items.length} shown · {selected.size ? `${selected.size} selected for sale review` : "Only owned assets can be selected"}</span></div><div className="inventoryGrid">{items.map((item) => <article className={`inventoryCard ${selected.has(item.id) ? "selectedForSale" : ""}`} key={item.id}><div className="cardFlags"><span style={{ background: `#${item.color}` }} /><b>{item.tradable ? "TRADABLE" : "OWNED"}</b></div><button className="selectForSale" onClick={() => toggle(item.id)} aria-label={`${selected.has(item.id) ? "Remove" : "Add"} ${item.name} ${selected.has(item.id) ? "from" : "to"} sale request`}>{selected.has(item.id) ? "✓" : "+"}</button><div className="inventoryImage"><SafeImage source={item.iconUrl} fallback={item.fallbackIconUrl} alt={item.name} /></div><strong>{item.weapon || item.name.split(" | ")[0]}</strong><p>{item.name.split(" | ")[1] || item.name}</p><small>{item.amount > 1 ? `Quantity ${item.amount}` : item.wear || item.type} · Asset {item.id}</small></article>)}{!items.length && <div className="emptyInventory"><span>⌕</span><h2>{privateInventory ? "Steam inventory is private" : connected ? "No matching owned items" : "Steam is not connected"}</h2><p>{privateInventory ? "Set Inventory visibility to Public in Steam privacy settings, then refresh." : connected ? "Try another search or filter." : "Connect through official Steam OpenID to load My Inventory."}</p></div>}</div></>;
}

function CatalogGrid({ catalog, loading, sort, setSort, setPage }: { catalog: CatalogResponse; loading: boolean; sort: string; setSort: (sort: string) => void; setPage: (page: number) => void }) {
  const pages = catalogPageWindow(catalog.pagination.page, catalog.pagination.totalPages);
  return <><div className="catalogToolbar"><span>{catalog.pagination.rangeStart}–{catalog.pagination.rangeEnd} of {catalog.pagination.total} results</span><label>Sort<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="default">Default</option><option value="price_asc">Price: Low to High</option><option value="price_desc">Price: High to Low</option><option value="name_asc">Name: A to Z</option><option value="rarity">Rarity</option></select></label></div>{loading && !catalog.items.length ? <div className="catalogLoading"><span className="loader" /><p>Loading the public CS2 catalog…</p></div> : <div className={`inventoryGrid catalogGrid ${loading ? "updating" : ""}`}>{catalog.items.map((item) => <article className="inventoryCard catalogCard" key={item.id}><div className="cardFlags"><span style={{ background: item.rarityColor.startsWith("#") ? item.rarityColor : `#${item.rarityColor}` }} /><b>{item.itemType}</b></div><div className="inventoryImage"><SafeImage source={item.image} alt={item.marketHashName || item.name} /></div><strong>{item.weapon || item.itemType}</strong><p>{item.name}</p><small>{item.rarity} · {item.wear || item.weaponCategory || item.category}</small><PriceLine price={item.price} /></article>)}{!catalog.items.length && !loading && <div className="emptyInventory"><span>⌕</span><h2>No catalog items match</h2><p>Clear a filter or try a different name, market hash name, weapon, or collection.</p></div>}</div>}<nav className="catalogPagination" aria-label="Catalog pagination"><span>{catalog.pagination.rangeStart}–{catalog.pagination.rangeEnd} of {catalog.pagination.total}</span><div><button disabled={!catalog.pagination.hasPrevious} onClick={() => setPage(catalog.pagination.page - 1)}>Previous</button>{pages.map((page, index) => page === "ellipsis" ? <span className="pageEllipsis" key={`ellipsis-${index}`}>…</span> : <button aria-current={page === catalog.pagination.page ? "page" : undefined} className={page === catalog.pagination.page ? "active" : ""} key={page} onClick={() => setPage(page)}>{page}</button>)}<button disabled={!catalog.pagination.hasNext} onClick={() => setPage(catalog.pagination.page + 1)}>Next</button></div></nav></>;
}

function PriceLine({ price }: { price: CatalogPrice }) {
  const presentation = catalogPricePresentation(price);
  return <div className={`catalogPrice ${presentation.available ? "" : "unavailable"} ${presentation.stale ? "stale" : ""}`}><strong>{presentation.amountLabel}</strong><span>{presentation.sourceLabel}</span>{presentation.updatedLabel && <small>{presentation.updatedLabel}</small>}</div>;
}
