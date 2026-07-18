"use client";
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useMemo, useState } from "react";

type User = { id: string; login: string; display_name: string; role: string; status: string; steam_id: string | null; created_at: string; last_login_at: string | null; deal_count: number; deal_total: number };
type Deal = { id: string; user_id: string; login: string; display_name: string; deal_date: string; amount_cents: number; currency: string; status: string; source: string; note: string; items: string | null; payment_method: "kaspi_card" | null; payment_details: string };
type TradeRequestItem = { id: string; asset_id: string; name: string; market_hash_name?: string | null; quantity: number; icon_url: string | null; category?: string | null; rarity?: string | null; wear?: string | null };
type TradeRequest = { id: string; user_id: string; steam_id: string; login: string | null; display_name: string | null; amount_cents: number; currency: string; status: string; note: string; payment_method: "kaspi_card" | null; payment_details: string; created_at: string; updated_at: string; items: TradeRequestItem[] };

const requestTransitions: Record<string, string[]> = {
  pending: ["contacted", "accepted", "rejected"],
  contacted: ["accepted", "rejected"],
  accepted: ["completed", "rejected"],
  rejected: [],
  completed: [],
  cancelled: [],
};

function requestStatusOptions(status: string) {
  return [status, ...(requestTransitions[status] || [])];
}

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]); const [deals, setDeals] = useState<Deal[]>([]); const [requests, setRequests] = useState<TradeRequest[]>([]); const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"overview" | "users" | "requests" | "deals">("overview"); const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const [showUserForm, setShowUserForm] = useState(false); const [showDealForm, setShowDealForm] = useState(false);
  const [userForm, setUserForm] = useState({ login: "", displayName: "", password: "", role: "user" });
  const [dealForm, setDealForm] = useState({ userId: "", dealDate: new Date().toISOString().slice(0,10), amount: "", currency: "USD", status: "completed", items: "", note: "", paymentMethod: "kaspi_card", paymentDetails: "" });

  async function load() {
    const me = await fetch("/api/auth/me"); if (!me.ok) { window.location.href = "/"; return; }
    const meData = await me.json(); if (meData.user.role !== "admin") { window.location.href = "/workspace"; return; }
    const [userResponse, dealResponse, requestResponse] = await Promise.all([fetch("/api/admin/users"), fetch("/api/admin/deals"), fetch("/api/admin/trade-requests", { cache: "no-store" })]);
    if (!userResponse.ok || !dealResponse.ok || !requestResponse.ok) {
      setError("The admin data could not be loaded. Please refresh the page.");
    }
    if (userResponse.ok) setUsers((await userResponse.json()).users || []); if (dealResponse.ok) setDeals((await dealResponse.json()).deals || []); if (requestResponse.ok) setRequests((await requestResponse.json()).requests || []); setLoading(false);
  }
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const currencies = useMemo(() => new Set(deals.map((deal) => deal.currency)), [deals]);
  function flash(message: string) { setNotice(message); setTimeout(() => setNotice(""), 3500); }

  async function createUser(event: FormEvent) {
    event.preventDefault(); setError(""); const response = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(userForm) }); const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error || "Could not create user"); return; } setShowUserForm(false); setUserForm({ login: "", displayName: "", password: "", role: "user" }); flash("Access account created"); await load();
  }
  async function toggleUser(user: User) {
    const status = user.status === "active" ? "blocked" : "active"; const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: user.id, status }) });
    if (response.ok) { flash(status === "active" ? "User activated" : "User blocked"); await load(); }
  }
  async function createDeal(event: FormEvent) {
    event.preventDefault(); setError(""); const items = dealForm.items.split("\n").map((name) => ({ name: name.trim(), quantity: 1 })).filter((item) => item.name);
    const response = await fetch("/api/admin/deals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...dealForm, amount: Number(dealForm.amount), items }) }); const body = await response.json();
    if (!response.ok) { setError(body.error || "Could not create deal"); return; } setShowDealForm(false); setDealForm({ userId: "", dealDate: new Date().toISOString().slice(0,10), amount: "", currency: "USD", status: "completed", items: "", note: "", paymentMethod: "kaspi_card", paymentDetails: "" }); flash("Deal added to client history"); await load();
  }
  async function deleteDeal(id: string) { if (!confirm("Delete this recorded deal?")) return; const response = await fetch(`/api/admin/deals?id=${encodeURIComponent(id)}`, { method: "DELETE" }); if (response.ok) { flash("Deal deleted"); await load(); } }
  async function updateRequest(id: string, status: string) { const response = await fetch("/api/admin/trade-requests", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) }); if (response.ok) { flash(`Request marked ${status}`); await load(); } }
  async function saveRequestPayment(id: string, paymentMethod: string, paymentDetails: string) {
    setError("");
    const response = await fetch("/api/admin/trade-requests", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, paymentMethod, paymentDetails }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error || "Could not save payout details"); return false; }
    flash("Payout details saved"); await load(); return true;
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/"; }

  if (loading) return <main className="appLoading"><span className="appBrand"><span className="brandGlyph">◈</span><b>contras<span>.fun</span></b></span><span className="loader" /><p>Opening admin console…</p></main>;
  return <main className="adminShell">
    <aside className="adminSidebar">
      <a className="appBrand" href="/admin"><span className="brandGlyph">◈</span><b>contras<span>.fun</span></b></a><small>ADMIN CONSOLE</small>
      <nav><button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}><i>⌂</i>Overview</button><button className={view === "users" ? "active" : ""} onClick={() => setView("users")}><i>♙</i>Access users<span>{users.length}</span></button><button className={view === "requests" ? "active" : ""} onClick={() => setView("requests")}><i>◇</i>Sale requests<span>{requests.filter((request) => request.status === "pending").length}</span></button><button className={view === "deals" ? "active" : ""} onClick={() => setView("deals")}><i>≡</i>Manual deals<span>{deals.length}</span></button></nav>
      <div className="adminBottom"><a href="/workspace">↗ Open client view</a><button onClick={logout}>Sign out</button></div>
    </aside>
    <section className="adminContent">
      <header className="adminTopbar"><div><p>CONTROL CENTER</p><h1>{view === "overview" ? "Dashboard" : view === "users" ? "Access users" : view === "requests" ? "Sale requests" : "Manual deals"}</h1></div><div><span className="liveDot"><i /> Secure admin session</span><div className="adminAvatar">A</div></div></header>
      {notice && <div className="toast">✓ {notice}</div>}
      {error && !showUserForm && !showDealForm && <div className="noticeBanner"><strong>Admin action failed.</strong><span>{error}</span></div>}
      {view === "overview" && <>
        <div className="adminStats"><article><span>TOTAL USERS</span><strong>{users.length}</strong><small>{users.filter((user) => user.status === "active").length} active accounts</small></article><article><span>STEAM CONNECTED</span><strong>{users.filter((user) => user.steam_id).length}</strong><small>{users.length ? Math.round(users.filter((user) => user.steam_id).length / users.length * 100) : 0}% of users</small></article><article><span>PENDING REQUESTS</span><strong>{requests.filter((request) => request.status === "pending").length}</strong><small>Client sale requests</small></article><article><span>RECORDED DEALS</span><strong>{deals.length}</strong><small>{currencies.size > 1 ? "Multiple currencies" : currencies.size === 1 ? `${Array.from(currencies)[0]} records` : "No recorded value"}</small></article></div>
        <div className="quickActions"><button onClick={() => { setShowUserForm(true); setView("users"); }}><span>＋</span><div><strong>Create access account</strong><small>Issue a new login and password</small></div><b>→</b></button><button onClick={() => { setShowDealForm(true); setView("deals"); }}><span>＋</span><div><strong>Add a past deal</strong><small>Record any off-platform transaction</small></div><b>→</b></button></div>
        <section className="adminPanel"><div className="panelTitle"><div><span>RECENT ACTIVITY</span><h2>Latest recorded deals</h2></div><button onClick={() => setView("deals")}>View all</button></div><DealsTable deals={deals.slice(0,6)} onDelete={deleteDeal} /></section>
      </>}
      {view === "users" && <section className="adminPanel mainPanel"><div className="panelTitle"><div><span>CLIENT ACCESS</span><h2>Users and credentials</h2><p>Create accounts yourself. Existing passwords are never visible and can only be replaced.</p></div><button className="primaryAdminButton" onClick={() => setShowUserForm(true)}>＋ New user</button></div>
        <div className="userTable"><div className="userRow tableHead"><span>User</span><span>Steam</span><span>Deals</span><span>Last sign in</span><span>Status</span><span /></div>{users.map((user) => <div className="userRow" key={user.id}><span><i>{user.display_name.slice(0,1).toUpperCase()}</i><div><strong>{user.display_name}</strong><small>@{user.login} · {user.role}</small></div></span><span>{user.steam_id ? <a className="connectedTag" href={`https://steamcommunity.com/profiles/${user.steam_id}`} target="_blank" rel="noreferrer">Connected</a> : <b className="notConnectedTag">Not connected</b>}</span><span><strong>{user.deal_count}</strong><small>recorded deals</small></span><span><strong>{user.last_login_at ? new Date(user.last_login_at).toLocaleDateString() : "Never"}</strong></span><span><b className={`statusTag ${user.status}`}>{user.status}</b></span><span><button className="rowAction" onClick={() => toggleUser(user)}>{user.status === "active" ? "Block" : "Activate"}</button></span></div>)}</div>
      </section>}
      {view === "requests" && <section className="adminPanel mainPanel"><div className="panelTitle"><div><span>CLIENT INTENT</span><h2>Incoming sale requests</h2><p>Review owned asset snapshots, desired amount and the verified Steam profile before contacting the client.</p></div></div><div className="adminRequestList">{requests.length ? requests.map((request) => <article className="adminRequestCard" key={request.id}><div className="adminRequestHeader"><div><span>#{request.id.slice(0,8)} · Created {new Date(request.created_at).toLocaleString()} · Updated {new Date(request.updated_at).toLocaleString()}</span><h3>{request.display_name || "Client"} <small>@{request.login || request.user_id}</small></h3></div><strong>{request.currency} {(request.amount_cents / 100).toFixed(2)}</strong><b className={`statusTag ${request.status}`}>{request.status}</b></div><div className="adminRequestItems">{request.items.map((item) => <div key={item.id}>{item.icon_url ? <img src={item.icon_url} alt={item.name} loading="lazy" referrerPolicy="no-referrer" /> : <span>CS2</span>}<p>{item.name}<small>Asset {item.asset_id}{item.wear ? ` · ${item.wear}` : ""}{item.rarity ? ` · ${item.rarity}` : ""}</small></p></div>)}</div>{request.note && <p className="adminRequestNote">{request.note}</p>}<RequestPaymentEditor request={request} onSave={saveRequestPayment} /><footer><a href={`https://steamcommunity.com/profiles/${request.steam_id}`} target="_blank" rel="noreferrer">Open Steam profile ↗</a><select aria-label={`Update request ${request.id} status`} value={request.status} disabled={!requestTransitions[request.status]?.length} onChange={(event) => updateRequest(request.id, event.target.value)}>{requestStatusOptions(request.status).map((status) => <option key={status} value={status}>{status.slice(0, 1).toUpperCase() + status.slice(1)}</option>)}</select></footer></article>) : <div className="emptyAdmin"><span>◎</span><p>No sale requests yet.</p></div>}</div></section>}
      {view === "deals" && <section className="adminPanel mainPanel"><div className="panelTitle"><div><span>HISTORY MANAGEMENT</span><h2>Manually recorded deals</h2><p>Add old and off-platform transactions to the selected client&apos;s history.</p></div><button className="primaryAdminButton" onClick={() => setShowDealForm(true)}>＋ Add deal</button></div><DealsTable deals={deals} onDelete={deleteDeal} /></section>}
    </section>
    {showUserForm && <div className="modalBackdrop"><form className="adminModal" onSubmit={createUser}><button className="modalClose" type="button" onClick={() => setShowUserForm(false)}>×</button><span>ACCESS MANAGEMENT</span><h2>Create user account</h2><p>Give these credentials directly to your client. The password will be stored as a secure hash.</p><label>Display name<input required value={userForm.displayName} onChange={(e) => setUserForm({...userForm, displayName:e.target.value})} placeholder="Client name" /></label><label>Login<input required value={userForm.login} onChange={(e) => setUserForm({...userForm, login:e.target.value})} placeholder="client.login" /></label><label>Temporary password<input required minLength={10} value={userForm.password} onChange={(e) => setUserForm({...userForm, password:e.target.value})} placeholder="At least 10 characters" /></label><label>Role<select value={userForm.role} onChange={(e) => setUserForm({...userForm, role:e.target.value})}><option value="user">Client</option><option value="admin">Administrator</option></select></label>{error && <div className="formError">{error}</div>}<button className="modalSubmit">Create access account <b>→</b></button></form></div>}
    {showDealForm && <div className="modalBackdrop"><form className="adminModal wideModal" onSubmit={createDeal}><button className="modalClose" type="button" onClick={() => setShowDealForm(false)}>×</button><span>MANUAL HISTORY</span><h2>Add completed deal</h2><p>The deal will immediately appear in the selected client&apos;s history.</p><div className="formGrid"><label>Client<select required value={dealForm.userId} onChange={(e) => setDealForm({...dealForm,userId:e.target.value})}><option value="">Select user</option>{users.map((user) => <option key={user.id} value={user.id}>{user.display_name} (@{user.login})</option>)}</select></label><label>Deal date<input required type="date" value={dealForm.dealDate} onChange={(e) => setDealForm({...dealForm,dealDate:e.target.value})} /></label><label>Amount<input required min="0" step="0.01" type="number" value={dealForm.amount} onChange={(e) => setDealForm({...dealForm,amount:e.target.value})} placeholder="0.00" /></label><label>Currency<select value={dealForm.currency} onChange={(e) => setDealForm({...dealForm,currency:e.target.value})}><option>USD</option><option>EUR</option><option>RUB</option></select></label></div><label>Items — one per line<textarea value={dealForm.items} onChange={(e) => setDealForm({...dealForm,items:e.target.value})} placeholder={"AK-47 | Redline (Field-Tested)\nAWP | Asiimov (Battle-Scarred)"} /></label><div className="formGrid"><label>Payment method<select value={dealForm.paymentMethod} onChange={(e) => setDealForm({...dealForm,paymentMethod:e.target.value})}><option value="kaspi_card">Card · Kaspi Bank</option><option value="">Not specified</option></select></label><label>Payout reference<input maxLength={240} value={dealForm.paymentDetails} onChange={(e) => setDealForm({...dealForm,paymentDetails:e.target.value})} placeholder="Recipient, Kaspi phone, or last 4 digits" /></label></div><p className="paymentSafetyHint">Never enter a full card number, CVV, PIN, or expiry date.</p><label>Internal note<textarea className="shortArea" value={dealForm.note} onChange={(e) => setDealForm({...dealForm,note:e.target.value})} placeholder="Optional note about the transaction" /></label>{error && <div className="formError">{error}</div>}<button className="modalSubmit">Add to client history <b>→</b></button></form></div>}
  </main>;
}

function DealsTable({ deals, onDelete }: { deals: Deal[]; onDelete: (id: string) => void }) { return <div className="adminDealTable"><div className="adminDealRow tableHead"><span>Client</span><span>Items</span><span>Date</span><span>Status</span><span>Amount</span><span /></div>{deals.length ? deals.map((deal) => <div className="adminDealRow" key={deal.id}><span><strong>{deal.display_name}</strong><small>@{deal.login}</small></span><span><strong>{deal.items || "Recorded transaction"}</strong><small>{deal.payment_method === "kaspi_card" ? `Kaspi Bank${deal.payment_details ? ` · ${deal.payment_details}` : ""}` : deal.note || "Manual entry"}</small></span><span>{new Date(deal.deal_date).toLocaleDateString("en-GB")}</span><span><b className={`statusTag ${deal.status}`}>{deal.status}</b></span><span className="dealAmount">{deal.currency} {(deal.amount_cents/100).toFixed(2)}</span><span><button className="deleteDeal" aria-label={`Delete deal ${deal.id}`} onClick={() => onDelete(deal.id)}>×</button></span></div>) : <div className="emptyAdmin"><span>◎</span><p>No deals recorded yet.</p></div>}</div>; }

function RequestPaymentEditor({ request, onSave }: { request: TradeRequest; onSave: (id: string, paymentMethod: string, paymentDetails: string) => Promise<boolean> }) {
  const [method, setMethod] = useState<string>(request.payment_method || "kaspi_card");
  const [details, setDetails] = useState(request.payment_details || "");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try { await onSave(request.id, method, details); }
    finally { setSaving(false); }
  }
  return <div className="adminPaymentEditor"><div><strong>Payout details</strong><small>Only recipient name, Kaspi phone, or last four card digits.</small></div><select aria-label={`Payment method for request ${request.id}`} value={method} onChange={(event) => setMethod(event.target.value)}><option value="kaspi_card">Card · Kaspi Bank</option><option value="">Not specified</option></select><input aria-label={`Payout reference for request ${request.id}`} maxLength={240} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Recipient, phone, or last 4 digits" /><button type="button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save details"}</button></div>;
}
