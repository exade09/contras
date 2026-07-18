"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { SteamIcon } from "./components/steam-icon";

const demoSkins = [
  { weapon: "AK-47", name: "Neon Rider", wear: "Minimal Wear", tone: "pink", image: "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwlcK3wiFO0POlV6poL_6sHG6UxPxJvOhuRz39xkQhsTnVzoygdy7Ea1UoCZQkRe9bs0brl9TvN-m0tVHYjY5CyS35jjQJsHhk4o5zcA" },
  { weapon: "AWP", name: "Containment Breach", wear: "Field-Tested", tone: "green", image: "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyLwiYbf_jdk7uW-V7JkMuWAMWuZxuZi_rQ6SXq1xURysj_Vw4uhJHOVPQ8oCZt4QrRbtRi6ldPlPu_g4FHaiYNbjXKpcPI_17A" },
  { weapon: "M4A1-S", name: "Printstream", wear: "Factory New", tone: "white", image: "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL8ypexwjFS4_ega6F_H_OGMWrEwL9lj_F7Rienhgk1tjyIpYPwJiPTcAAoCpsiEO5ZsUbpm9C2Zuni4VHW3o5EzSX62HxP7Sg96-hWVqYi_6TJz1aW0nxrkGs" },
  { weapon: "Karambit", name: "Doppler", wear: "Factory New", tone: "blue", image: "https://community.akamai.steamstatic.com/economy/image/i0CoZ81Ui0m-9KwlBY1L_18myuGuq1wfhWSaZgMttyVfPaERSR0Wqmu7LAocGIGz3UqlXOLrxM-vMGmW8VNxu5Dx60noTyL6kJ_m-B1Q7uCvZaZkNM-SA1iSze91u_FsTju_qhAmoT-Jn4bjJC_4Ml93UtZuRLQPsBawkNfiMbnl5AKMiopCnin7iCJBv31j4rkBBKEg-6zUjV3GY6p9v8dpLWT3Fg" },
];

function Logo() {
  return (
    <Link className="logo" href="/" aria-label="contras.fun home">
      <span className="logoMark"><span /></span>
      <span>contras<span>.fun</span></span>
    </Link>
  );
}

function SkinCard({ skin, index }: { skin: typeof demoSkins[number]; index: number }) {
  return (
    <article className={`floatSkin floatSkin${index + 1} skin-${skin.tone}`}>
      <div className="skinTop"><span>PUBLIC DATA</span><i /></div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="weaponArt" src={skin.image} alt={`${skin.weapon} ${skin.name} CS2 skin`} loading="eager" referrerPolicy="no-referrer" />
      <div className="skinInfo">
        <strong>{skin.weapon}</strong>
        <span>{skin.name}</span>
        <small>{skin.wear}</small>
      </div>
    </article>
  );
}

export default function Home() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [steamError, setSteamError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const status = new URLSearchParams(window.location.search).get("steam");
      const messages: Record<string, string> = {
        invalid_state: "The Steam sign-in request expired. Please start again.",
        verification_failed: "Steam could not verify this sign-in. Please retry on the official Steam page.",
        replay_rejected: "This Steam response was already used. Please start a new sign-in.",
        already_linked: "This Steam identity is already linked to another application account.",
      };
      setSteamError(status ? messages[status] || "Steam sign-in could not be completed." : "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!login.trim() || !password) {
      setError("Enter the access login and password issued by the administrator.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Access denied");
      window.location.href = body.role === "admin" ? "/admin" : "/workspace";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Access denied");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="landingShell">
      <header className="siteHeader">
        <Logo />
        <nav aria-label="Main navigation">
          <a href="#inventory">Inventory</a>
          <a href="#security">Security</a>
          <a href="#how">How it works</a>
        </nav>
        <div className="headerActions">
          <span className="statusPill"><i /> Official Steam sign-in</span>
          <a className="signInMini" href="#access">Sign in</a>
        </div>
      </header>

      <section className="landingHero" id="inventory">
        <div className="gridGlow" />
        <div className="heroCopy">
          <div className="eyebrow"><span>INVENTORY &amp; SALE REQUESTS</span><i /></div>
          <h1>Your skins.<br /><em>One clean view.</em></h1>
          <p>
            Sign in with the access details issued by your administrator, connect
            Steam through the official page, and see every CS2 item in one place.
          </p>
          <div className="heroProof">
            <div><strong>Read only</strong><span>No trade actions</span></div>
            <div><strong>Official OpenID</strong><span>No Steam password</span></div>
            <div><strong>Full history</strong><span>Recorded deals</span></div>
          </div>
        </div>

        <div className="skinStage" aria-hidden="true">
          <div className="stageRing ring1" />
          <div className="stageRing ring2" />
          {demoSkins.map((skin, index) => <SkinCard key={skin.name} skin={skin} index={index} />)}
          <div className="inventoryBadge">
            <span>PUBLIC SKIN CATALOG</span>
            <strong>Complete</strong>
            <small><i /> English metadata</small>
          </div>
        </div>

        <aside className="accessCard" id="access">
          <div className="accessHeader">
            <span className="accessIcon"><SteamIcon /></span>
            <div><small>PRIVATE ACCESS</small><h2>Welcome back</h2></div>
          </div>
          <p className="accessLead">Use credentials issued by an administrator, or continue through official Steam OpenID.</p>
          {steamError && <div className="formError" role="alert">{steamError}</div>}
          <form onSubmit={submit}>
            <label>
              <span>Access login</span>
              <input autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Your login" />
            </label>
            <label>
              <span>Password</span>
              <div className="passwordField">
                <input autoComplete="current-password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button>
              </div>
            </label>
            {error && <div className="formError" role="alert">{error}</div>}
            <button className="accessButton" disabled={loading} type="submit">
              <span>{loading ? "Checking access…" : "Continue"}</span><b>→</b>
            </button>
          </form>
          <div className="authDivider"><span>or</span></div>
          <a className="steamAuthButton" href="/api/steam/start?intent=login">
            <SteamIcon />
            <span>Continue with Steam</span>
          </a>
          <div className="securityNote" id="security">
            <span>✓</span>
            <p><strong>Steam-safe sign in</strong>Your Steam password is only entered on Steam&apos;s official website. contras.fun never sees or stores it.</p>
          </div>
        </aside>
      </section>

      <footer className="landingFooter" id="how">
        <span>© 2026 contras.fun</span>
        <p>Inventory viewing and manually recorded deal history. No automated trading.</p>
        <div><a href="#security">Privacy</a><a href="#security">Terms</a></div>
      </footer>
    </main>
  );
}
