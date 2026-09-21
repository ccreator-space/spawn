import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Textarea } from "poyraz-ui/atoms";
import { CalendarDays, ChartNoAxesCombined, ChevronLeft, ChevronRight, CircleDollarSign, Clapperboard, LogOut, Plus, Search, Users, X as CloseIcon } from "lucide-react";
import "poyraz-ui/preset.css";
import "./style.css";

type Currency = "TRY" | "USD";
type MoneyMetric = "contracted" | "received" | "credit" | "spent" | "outstanding";
type Money = Record<Currency, Record<MoneyMetric, number>>;
type Sponsor = { id: string; slug: string; name: string; website_url: string | null; logo_url: string | null; notes: string; published?: number; planned?: number; money?: Money };
type Publication = { id: string; sponsor_id: string | null; sponsor_name?: string | null; platform: string; format: string; slot_id: string | null; title: string; planned_date: string; published_date: string | null; status: "planned" | "published" | "cancelled"; url: string | null; fee_minor: number; currency: Currency; notes: string };
type Transaction = { id: string; sponsor_id: string | null; sponsor_name?: string | null; publication_id: string | null; kind: "income" | "expense" | "credit"; amount_minor: number; currency: Currency; occurred_on: string; note: string };
type Slot = { id: string; weekday: number; platform: string; format: string; label: string; date: string };
type Schedule = { monday: string; slots: Slot[]; publications: Publication[] };
type Dashboard = { sponsorCount: number; publicationCount: number; publishedCount: number; plannedCount: number; money: Money };
type Rate = { date: string; usdTry: number; source: string } | null;
type Page = "dashboard" | "calendar" | "sponsors" | "finance";

const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
const PLATFORMS = ["YouTube", "Instagram", "TikTok", "LinkedIn", "X"];
const emptyMoney: Money = { TRY: { contracted: 0, received: 0, credit: 0, spent: 0, outstanding: 0 }, USD: { contracted: 0, received: 0, credit: 0, spent: 0, outstanding: 0 } };
const trDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" });
const money = (minor: number, currency: Currency) => new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
const todayIstanbul = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shiftDate = (value: string, days: number) => { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const parseAmount = (value: string) => { const normalized = value.trim().replace(/\s/g, "").replace(/,/g, "."); const n = Number(normalized); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const convertedMinor = (data: Money, key: MoneyMetric, currency: Currency, rate: Rate) => {
  if (!rate) return data[currency][key];
  return currency === "TRY"
    ? data.TRY[key] + Math.round(data.USD[key] * rate.usdTry)
    : data.USD[key] + Math.round(data.TRY[key] / rate.usdTry);
};
const sourceBreakdown = (data: Money, key: MoneyMetric) => [
  data.TRY[key] ? money(data.TRY[key], "TRY") : "",
  data.USD[key] ? money(data.USD[key], "USD") : "",
].filter(Boolean).join(" + ") || money(0, "TRY");
const transactionLabel = (kind: Transaction["kind"]) => kind === "income" ? "Tahsilat" : kind === "credit" ? "Platform kredisi" : "Gider";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `İstek başarısız (${response.status})`);
  return body as T;
}
const post = <T,>(path: string, data: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(data) });
const patch = <T,>(path: string, data: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(data) });

function App() {
  const [user, setUser] = useState<{ email: string } | null | undefined>(undefined);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [page, setPage] = useState<Page>("dashboard");
  const [selectedSponsorId, setSelectedSponsorId] = useState<string | null>(null);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [rate, setRate] = useState<Rate>(null);
  const [week, setWeek] = useState(todayIstanbul);
  const [modal, setModal] = useState<"sponsor" | "publication" | "transaction" | null>(null);
  const [editingPublication, setEditingPublication] = useState<Publication | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [presetSlot, setPresetSlot] = useState<Slot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState<Currency>(() => localStorage.getItem("spawn-display-currency") === "USD" ? "USD" : "TRY");

  useEffect(() => { api<{ user: { email: string } }>("/me").then((r) => setUser(r.user)).catch(async () => {
    try { const status = await api<{ needsSetup: boolean }>("/setup-status"); setNeedsSetup(status.needsSetup); } catch { /* Login remains available if status cannot be checked. */ }
    setUser(null);
  }); }, []);
  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const [s, c, d, t] = await Promise.all([
        api<{ sponsors: Sponsor[] }>("/sponsors"),
        api<Schedule>(`/schedule?week=${week}`),
        api<Dashboard>("/dashboard"),
        api<{ transactions: Transaction[] }>("/transactions"),
      ]);
      setSponsors(s.sponsors); setSchedule(c); setDashboard(d); setTransactions(t.transactions);
    } catch (e) { setError((e as Error).message); }
  }, [user, week]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (user) api<{ rate: Rate }>("/rate").then((r) => setRate(r.rate)).catch(() => {}); }, [user]);
  useEffect(() => { localStorage.setItem("spawn-display-currency", displayCurrency); }, [displayCurrency]);

  const openPublication = (slot?: Slot, item?: Publication) => { setPresetSlot(slot || null); setEditingPublication(item || null); setError(""); setModal("publication"); };
  const openTransaction = (item?: Transaction) => { setEditingTransaction(item || null); setError(""); setModal("transaction"); };
  const closeModal = () => { setModal(null); setEditingPublication(null); setEditingTransaction(null); setPresetSlot(null); setError(""); };
  const afterSave = async () => { closeModal(); setRevision((n) => n + 1); await refresh(); };

  if (user === undefined) return <div className="loading-screen">Spawn yükleniyor…</div>;
  if (!user) return needsSetup ? <Setup onSetup={setUser} /> : <Login onLogin={setUser} />;
  const currentSponsor = sponsors.find((s) => s.id === selectedSponsorId) || null;
  const headline = page === "dashboard" ? "Genel bakış" : page === "calendar" ? "İçerik takvimi" : page === "finance" ? "Finans" : currentSponsor ? currentSponsor.name : "Sponsorlar";
  const menu = [
    { key: "dashboard" as Page, label: "Genel bakış", icon: ChartNoAxesCombined },
    { key: "calendar" as Page, label: "İçerik takvimi", icon: CalendarDays },
    { key: "sponsors" as Page, label: "Sponsorlar", icon: Users },
    { key: "finance" as Page, label: "Finans", icon: CircleDollarSign },
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-mark"><img className="brand-logo" src="/logo.png" alt="" /><span><strong>Spawn</strong><small>İçerik & iş ortaklıkları</small></span></div>
      
      <nav>{menu.map(({ key, label, icon: Icon }) => <button key={key} className={`nav-item ${page === key ? "active" : ""}`} onClick={() => { setPage(key); setSelectedSponsorId(null); if (key === "dashboard") setWeek(todayIstanbul()); }}><Icon size={18} /> {label}</button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-foot"><div className="avatar">PA</div><div className="user-meta"><strong>Poyraz</strong><small>{user.email}</small></div><button className="icon-button" title="Çıkış yap" onClick={async () => { await post("/logout", {}); setUser(null); }}><LogOut size={18} /></button></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><h1>{headline}</h1></div><div className="topbar-actions"><CurrencySwitch value={displayCurrency} onChange={setDisplayCurrency} /><span className="today-chip">{trDate(todayIstanbul())}</span><Button onClick={() => openPublication()}><Plus size={17} /> Yeni içerik</Button></div></header>
      {error && <div className="error-banner">{error}<button onClick={() => setError("")}><CloseIcon size={16} /></button></div>}
      {page === "dashboard" && <DashboardPage data={dashboard} schedule={schedule} sponsors={sponsors} rate={rate} displayCurrency={displayCurrency} onCalendar={() => setPage("calendar")} onSponsor={(id) => { setSelectedSponsorId(id); setPage("sponsors"); }} onAdd={() => openPublication()} />}
      {page === "calendar" && <CalendarPage schedule={schedule} onWeek={setWeek} onAdd={openPublication} />}
      {page === "sponsors" && (currentSponsor ? <SponsorDetail key={`${currentSponsor.id}-${revision}`} sponsor={currentSponsor} rate={rate} displayCurrency={displayCurrency} onBack={() => setSelectedSponsorId(null)} onEdit={() => { setError(""); setModal("sponsor"); }} onAddPublication={() => openPublication()} onAddSlotPublication={(slot) => openPublication(slot)} onAddTransaction={() => openTransaction()} onEditTransaction={openTransaction} onEditPublication={(item) => openPublication(undefined, item)} /> : <SponsorsPage sponsors={sponsors.filter((s) => s.name.toLocaleLowerCase("tr").includes(search.toLocaleLowerCase("tr")))} search={search} rate={rate} displayCurrency={displayCurrency} onSearch={setSearch} onSelect={setSelectedSponsorId} onAdd={() => { setError(""); setModal("sponsor"); }} />)}
      {page === "finance" && <FinancePage dashboard={dashboard} transactions={transactions} rate={rate} displayCurrency={displayCurrency} onAdd={() => openTransaction()} onEdit={openTransaction} />}
    </main>
    {modal && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}><div className="modal-panel"><div className="modal-head"><div><h2>{modal === "sponsor" ? currentSponsor ? "Sponsoru düzenle" : "Yeni sponsor" : modal === "publication" ? editingPublication ? "İçeriği düzenle" : "Yeni içerik" : editingTransaction ? "İşlemi düzenle" : "Yeni işlem"}</h2></div><button className="icon-button" onClick={closeModal}><CloseIcon size={21} /></button></div>
      {error && <div className="form-error">{error}</div>}
      {modal === "sponsor" && <SponsorForm sponsor={currentSponsor} busy={busy} onSubmit={async (data) => { setBusy(true); setError(""); try { if (currentSponsor) await patch(`/sponsors/${currentSponsor.id}`, data); else await post("/sponsors", data); await afterSave(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} />}
      {modal === "publication" && <PublicationForm sponsors={sponsors} slot={presetSlot} item={editingPublication} defaultSponsor={page === "sponsors" ? selectedSponsorId : null} busy={busy} onSubmit={async (data) => { setBusy(true); setError(""); try { if (editingPublication) await patch(`/publications/${editingPublication.id}`, data); else await post("/publications", data); await afterSave(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} />}
      {modal === "transaction" && <TransactionForm sponsors={sponsors} item={editingTransaction} defaultSponsor={page === "sponsors" ? selectedSponsorId : null} busy={busy} onSubmit={async (data) => { setBusy(true); setError(""); try { if (editingTransaction) await patch(`/transactions/${editingTransaction.id}`, data); else await post("/transactions", data); await afterSave(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} />}
    </div></div>}
  </div>;
}

function Setup({ onSetup }: { onSetup: (user: { email: string }) => void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <div className="login-page"><div className="login-card"><img className="brand-logo login-icon" src="/logo.png" alt="" /><h1>Çalışma alanını aç.</h1><p>Yönetici hesabını oluştur ve sponsorluk takvimini kullanmaya başla.</p><form onSubmit={async (e) => { e.preventDefault(); if (password !== confirm) { setError("Parolalar eşleşmiyor."); return; } setBusy(true); setError(""); try { const r = await post<{ user: { email: string } }>("/setup", { email, password }); onSetup(r.user); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}><label>E-posta</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /><label>Parola (en az 12 karakter)</label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} autoComplete="new-password" /><label>Parolayı tekrar gir</label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={12} autoComplete="new-password" />{error && <div className="form-error">{error}</div>}<Button type="submit" disabled={busy} className="full-button">{busy ? "Hesap oluşturuluyor…" : "Yönetici hesabı oluştur"}</Button></form><small>Bu ekran yalnızca ilk yerel açılışta görünür.</small></div></div>;
}

function Login({ onLogin }: { onLogin: (user: { email: string }) => void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <div className="login-page"><div className="login-card"><img className="brand-logo login-icon" src="/logo.png" alt="" /><h1>Tekrar hoş geldin.</h1><p>İçeriklerini ve sponsorluklarını tek yerden yönet.</p><form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(""); try { const r = await post<{ user: { email: string } }>("/login", { email, password }); onLogin(r.user); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }}><label>E-posta</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /><label>Parola</label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />{error && <div className="form-error">{error}</div>}<Button type="submit" disabled={busy} className="full-button">{busy ? "Giriş yapılıyor…" : "Giriş yap"}</Button></form><small>Yeni hesaplar uygulama yöneticisi tarafından oluşturulur.</small></div></div>;
}

function CurrencySwitch({ value, onChange }: { value: Currency; onChange: (value: Currency) => void }) {
  return <div className="currency-switch" aria-label="Gösterim para birimi">{(["TRY", "USD"] as const).map((currency) => <button type="button" key={currency} className={value === currency ? "active" : ""} aria-pressed={value === currency} onClick={() => onChange(currency)}>{currency === "TRY" ? "TL" : "USD"}</button>)}</div>;
}

function AmountCards({ data, rate, displayCurrency }: { data: Money; rate: Rate; displayCurrency: Currency }) {
  const values = [
    { label: "Anlaşılan", key: "contracted" as const, tone: "blue" },
    { label: "Tahsil edilen", key: "received" as const, tone: "green" },
    { label: "Platform kredisi", key: "credit" as const, tone: "purple" },
    { label: "Bekleyen alacak", key: "outstanding" as const, tone: "amber" },
    { label: "Gider", key: "spent" as const, tone: "rose" },
  ];
  return <><div className="stat-grid">{values.map(({ label, key, tone }) => <Card key={key} className={`stat-card tone-${tone}`}><CardContent><div className="stat-label">{label}</div><div className="stat-value">{money(convertedMinor(data, key, displayCurrency, rate), displayCurrency)}</div><div className="stat-secondary">Kayıtlar: {sourceBreakdown(data, key)}</div></CardContent></Card>)}</div>{rate ? <div className="rate-note">{rate.source} · {trDate(rate.date)} · 1 USD = {rate.usdTry.toLocaleString("tr-TR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} TL. Toplamlar seçili para birimine bu referans kuruyla çevrilir.</div> : <div className="rate-note rate-error">Canlı kur alınamadı. Kartlarda yalnızca seçili para birimindeki kayıtlar gösteriliyor.</div>}</>;
}

function DashboardPage({ data, schedule, sponsors, rate, displayCurrency, onCalendar, onSponsor, onAdd }: { data: Dashboard | null; schedule: Schedule | null; sponsors: Sponsor[]; rate: Rate; displayCurrency: Currency; onCalendar: () => void; onSponsor: (id: string) => void; onAdd: () => void }) {
  const upcoming = schedule?.publications.filter((p) => p.status === "planned").slice(0, 5) || [];
  return <div className="page-stack"><div className="welcome-panel"><div><h2>Her yayın yerli yerinde.</h2><p>Haftalık içerik düzenin, sponsorlukların ve gelirlerin tek bakışta.</p><Button onClick={onCalendar} variant="outline">Takvime git <ChevronRight size={16} /></Button></div><div className="welcome-numbers"><div><strong>3</strong><span>uzun video</span></div><div><strong>4</strong><span>YouTube Short</span></div><div><strong>25</strong><span>haftalık yayın yuvası</span></div></div></div>
    <div className="section-heading"><div><h2>Rakamlarla genel durum</h2></div></div><AmountCards data={data?.money || emptyMoney} rate={rate} displayCurrency={displayCurrency} />
    <div className="two-columns"><Card className="content-card"><CardHeader><div className="card-header-row"><div><CardTitle>Bu haftanın planı</CardTitle></div><Button size="sm" variant="outline" onClick={onCalendar}>Tümünü gör</Button></div></CardHeader><CardContent>{upcoming.length ? upcoming.map((item) => <div className="list-row" key={item.id}><span className={`platform-dot ${item.platform.toLowerCase()}`} /><div className="row-main"><strong>{item.title}</strong><small>{item.platform} · {item.sponsor_name || "Organik içerik"}</small></div><span className="row-date">{shortDate(item.planned_date)}</span></div>) : <Empty text="Henüz gerçek tarihli içerik eklenmedi." action="İçerik ekle" onAction={onAdd} />}</CardContent></Card>
      <Card className="content-card"><CardHeader><CardTitle>Sponsorların</CardTitle></CardHeader><CardContent>{sponsors.slice(0, 5).map((s) => <button className="sponsor-row" onClick={() => onSponsor(s.id)} key={s.id}><SponsorLogo sponsor={s} /><span><strong>{s.name}</strong><small>{s.published || 0} yayımlandı · {s.planned || 0} bekliyor</small></span><ChevronRight size={16} /></button>)}</CardContent></Card></div>
  </div>;
}

function CalendarPage({ schedule, onWeek, onAdd }: { schedule: Schedule | null; onWeek: (date: string) => void; onAdd: (slot?: Slot, item?: Publication) => void }) {
  if (!schedule) return <div className="loading-panel">Takvim yükleniyor…</div>;
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(schedule.monday, i));
  return <div className="page-stack"><div className="calendar-toolbar"><div><h2>{trDate(schedule.monday)} – {trDate(days[6]!)}</h2></div><div className="toolbar-buttons"><Button variant="outline" size="sm" onClick={() => onWeek(todayIstanbul())}>Bu hafta</Button><button className="icon-button bordered" onClick={() => onWeek(shiftDate(schedule.monday, -7))} aria-label="Önceki hafta"><ChevronLeft size={19} /></button><button className="icon-button bordered" onClick={() => onWeek(shiftDate(schedule.monday, 7))} aria-label="Sonraki hafta"><ChevronRight size={19} /></button></div></div>
    <div className="calendar-scroll"><div className="calendar-grid"><div className="grid-head day-head">Gün</div>{PLATFORMS.map((p) => <div key={p} className={`grid-head platform-head ${p.toLowerCase()}`}>{p}</div>)}{days.map((day, index) => <React.Fragment key={day}><div className="day-cell"><strong>{DAYS[index]}</strong><span>{shortDate(day)}</span></div>{PLATFORMS.map((platform) => <div key={`${day}-${platform}`} className="schedule-cell">{schedule.slots.filter((s) => s.date === day && s.platform === platform).map((slot) => { const item = schedule.publications.find((p) => p.planned_date === day && p.slot_id === slot.id && p.status !== "cancelled"); return <button key={slot.id} className={`slot-card ${item ? item.status : "empty"}`} onClick={() => onAdd(slot, item)}><span className="slot-top"><span className="slot-format">{slot.format}</span>{item ? <Badge variant="outline">{item.status === "published" ? "Yayında" : "Planlı"}</Badge> : <Plus size={15} />}</span><strong>{item?.title || slot.label}</strong>{item?.sponsor_name && <small>{item.sponsor_name}</small>}</button>; })}{schedule.publications.filter((p) => p.planned_date === day && p.platform === platform && !p.slot_id && p.status !== "cancelled").map((item) => <button key={item.id} className={`slot-card ${item.status}`} onClick={() => onAdd(undefined, item)}><span className="slot-format">Ek yayın</span><strong>{item.title}</strong></button>)}</div>)}</React.Fragment>)}</div></div><div className="calendar-footnote">Boş yuvalar haftalık düzenini gösterir; gerçek içerik olarak sayılmaz. Bir yuvaya tıklayarak planlayabilirsin.</div>
  </div>;
}

function SponsorsPage({ sponsors, search, rate, displayCurrency, onSearch, onSelect, onAdd }: { sponsors: Sponsor[]; search: string; rate: Rate; displayCurrency: Currency; onSearch: (v: string) => void; onSelect: (id: string) => void; onAdd: () => void }) {
  return <div className="page-stack"><div className="section-heading"><div><h2>Tüm sponsorlar</h2><p>Marka bazında içerikleri, ödemeleri ve giderleri izle.</p></div><Button onClick={onAdd}><Plus size={17} /> Sponsor ekle</Button></div><div className="search-box"><Search size={18} /><Input placeholder="Sponsor ara…" value={search} onChange={(e) => onSearch(e.target.value)} /></div><div className="sponsor-grid">{sponsors.map((s) => { const values = s.money || emptyMoney; return <button className="sponsor-tile" key={s.id} onClick={() => onSelect(s.id)}><div className="tile-top"><SponsorLogo sponsor={s} /><ChevronRight size={18} /></div><h3>{s.name}</h3><div className="tile-counts"><span>{s.published || 0} yayında</span><span>{s.planned || 0} bekliyor</span></div><div className="tile-money"><strong>{money(convertedMinor(values, "received", displayCurrency, rate), displayCurrency)}</strong><small>Tahsilat · {sourceBreakdown(values, "received")}</small>{(values.TRY.credit > 0 || values.USD.credit > 0) && <small>Platform kredisi · {sourceBreakdown(values, "credit")}</small>}</div></button>; })}</div>{!sponsors.length && <Empty text="Aradığın sponsor bulunamadı." />}</div>;
}

function SponsorDetail({ sponsor, rate, displayCurrency, onBack, onEdit, onAddPublication, onAddSlotPublication, onAddTransaction, onEditPublication, onEditTransaction }: { sponsor: Sponsor; rate: Rate; displayCurrency: Currency; onBack: () => void; onEdit: () => void; onAddPublication: () => void; onAddSlotPublication: (slot: Slot) => void; onAddTransaction: () => void; onEditPublication: (item: Publication) => void; onEditTransaction: (item: Transaction) => void }) {
  const [detail, setDetail] = useState<{ publications: Publication[]; transactions: Transaction[]; money: Money; published: number; planned: number } | null>(null);
  const [available, setAvailable] = useState<Slot[]>([]);
  useEffect(() => { api<typeof detail>(`/sponsors/${sponsor.id}`).then((r) => setDetail(r)).catch(() => {}); }, [sponsor.id]);
  useEffect(() => { api<{ slots: Slot[] }>("/available?platform=YouTube&format=long&limit=6").then((r) => setAvailable(r.slots)).catch(() => {}); }, [sponsor.id]);
  return <div className="page-stack"><div className="detail-heading"><button className="back-link" onClick={onBack}><ChevronLeft size={16} /> Sponsorlar</button><div className="detail-title"><SponsorLogo sponsor={sponsor} /><div><h2>{sponsor.name}</h2>{sponsor.website_url && <a href={sponsor.website_url} target="_blank" rel="noreferrer">Web sitesini aç ↗</a>}</div><Button variant="outline" size="sm" onClick={onEdit}>Düzenle</Button></div>{sponsor.notes && <p className="sponsor-note">{sponsor.notes}</p>}</div>
    <div className="count-strip"><div><strong>{detail?.publications.filter((p) => p.status !== "cancelled" && ["long", "short", "reel", "tiktok", "teaser"].includes(p.format)).length || 0}</strong><span>Anlaşılan video</span></div><div><strong>{detail?.published || 0}</strong><span>Yayımlanan</span></div><div><strong>{detail?.planned || 0}</strong><span>Bekleyen</span></div></div><AmountCards data={detail?.money || emptyMoney} rate={rate} displayCurrency={displayCurrency} />
    {available.length > 0 && <Card className="content-card"><CardHeader><CardTitle>Boş YouTube uzun video tarihleri</CardTitle></CardHeader><CardContent><div className="available-dates">{available.map((slot) => <button key={`${slot.date}-${slot.id}`} onClick={() => onAddSlotPublication(slot)}><strong>{shortDate(slot.date)}</strong><small>{slot.label}</small></button>)}</div></CardContent></Card>}
    <Card className="content-card"><CardHeader><div className="card-header-row"><div><CardTitle>Sponsorlu yayınlar</CardTitle></div><Button size="sm" onClick={onAddPublication}><Plus size={16} /> İçerik ekle</Button></div></CardHeader><CardContent>{detail?.publications.filter((p) => p.status !== "cancelled").length ? detail.publications.filter((p) => p.status !== "cancelled").map((p) => <button className="detail-list-row" key={p.id} onClick={() => onEditPublication(p)}><div><strong>{p.title}</strong><small>{p.platform} · {trDate(p.planned_date)} {p.url ? "· Bağlantı kayıtlı" : ""}</small></div><span className={`status-pill ${p.status}`}>{p.status === "published" ? "Yayında" : "Bekliyor"}</span><b>{money(p.fee_minor, p.currency)}</b><ChevronRight size={16} /></button>) : <Empty text="Bu sponsor için içerik henüz eklenmedi." action="İçerik ekle" onAction={onAddPublication} />}</CardContent></Card>
    <Card className="content-card"><CardHeader><div className="card-header-row"><div><CardTitle>Tahsilat, kredi ve giderler</CardTitle></div><Button variant="outline" size="sm" onClick={onAddTransaction}><Plus size={16} /> İşlem ekle</Button></div></CardHeader><CardContent>{detail?.transactions.length ? detail.transactions.map((t) => <button className="detail-list-row" key={t.id} onClick={() => onEditTransaction(t)}><div><strong>{t.note || transactionLabel(t.kind)}</strong><small>{transactionLabel(t.kind)} · {trDate(t.occurred_on)}</small></div><b className={t.kind === "income" ? "positive" : t.kind === "credit" ? "credit" : "negative"}>{t.kind === "expense" ? "−" : "+"}{money(t.amount_minor, t.currency)}</b><ChevronRight size={16} /></button>) : <Empty text="Henüz para hareketi kaydedilmedi." action="İşlem ekle" onAction={onAddTransaction} />}</CardContent></Card>
  </div>;
}

function FinancePage({ dashboard, transactions, rate, displayCurrency, onAdd, onEdit }: { dashboard: Dashboard | null; transactions: Transaction[]; rate: Rate; displayCurrency: Currency; onAdd: () => void; onEdit: (item: Transaction) => void }) {
  return <div className="page-stack"><div className="section-heading"><div><h2>Finansal özet</h2><p>Kararlaştırılan ücretler, tahsilatlar ve platform kredileri ayrı izlenir.</p></div><Button onClick={onAdd}><Plus size={17} /> İşlem ekle</Button></div><AmountCards data={dashboard?.money || emptyMoney} rate={rate} displayCurrency={displayCurrency} /><Card className="content-card"><CardHeader><CardTitle>Finans hareketleri</CardTitle></CardHeader><CardContent>{transactions.length ? transactions.map((t) => <button className="finance-row finance-button" key={t.id} onClick={() => onEdit(t)}><span className={`transaction-icon ${t.kind}`}>{t.kind === "income" ? "↓" : t.kind === "credit" ? "◆" : "↑"}</span><div className="row-main"><strong>{t.sponsor_name || "Genel gider"}</strong><small>{t.note || transactionLabel(t.kind)}</small></div><span className="row-date">{trDate(t.occurred_on)}</span><b className={t.kind === "income" ? "positive" : t.kind === "credit" ? "credit" : "negative"}>{t.kind === "expense" ? "−" : "+"}{money(t.amount_minor, t.currency)}</b></button>) : <Empty text="Henüz finans hareketi yok." action="İşlem ekle" onAction={onAdd} />}</CardContent></Card></div>;
}

function SponsorLogo({ sponsor }: { sponsor: Sponsor }) { return <span className={`sponsor-logo${sponsor.id === "atoms" ? " atoms-logo" : ""}`}>{sponsor.logo_url ? <img src={sponsor.logo_url} alt="" /> : sponsor.name.slice(0, 2).toUpperCase()}</span>; }
function Empty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) { return <div className="empty-state"><Clapperboard size={25} /><p>{text}</p>{action && onAction && <Button variant="outline" size="sm" onClick={onAction}>{action}</Button>}</div>; }

function SponsorForm({ sponsor, busy, onSubmit }: { sponsor: Sponsor | null; busy: boolean; onSubmit: (data: unknown) => Promise<void> }) {
  const [name, setName] = useState(sponsor?.name || ""); const [website, setWebsite] = useState(sponsor?.website_url || ""); const [notes, setNotes] = useState(sponsor?.notes || "");
  return <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void onSubmit({ name, website_url: website, notes }); }}><div className="field"><label>Marka adı *</label><Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Örn. Hostinger" /></div><div className="field"><label>Web sitesi</label><Input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" /></div><div className="field"><label>Not</label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Sponsorla ilgili kısa notlar" rows={4} /></div><Button type="submit" disabled={busy} className="full-button">{busy ? "Kaydediliyor…" : "Kaydet"}</Button></form>;
}

function PublicationForm({ sponsors, slot, item, defaultSponsor, busy, onSubmit }: { sponsors: Sponsor[]; slot: Slot | null; item: Publication | null; defaultSponsor: string | null; busy: boolean; onSubmit: (data: unknown) => Promise<void> }) {
  const [title, setTitle] = useState(item?.title || ""); const [date, setDate] = useState(item?.planned_date || slot?.date || todayIstanbul());
  const [platform, setPlatform] = useState(item?.platform || slot?.platform || "YouTube"); const [format, setFormat] = useState(item?.format || slot?.format || "long");
  const [sponsorId, setSponsorId] = useState(item?.sponsor_id || defaultSponsor || ""); const [fee, setFee] = useState(item ? (item.fee_minor / 100).toString() : "0");
  const [currency, setCurrency] = useState<Currency>(item?.currency || "TRY"); const [status, setStatus] = useState(item?.status || "planned");
  const [publishedDate, setPublishedDate] = useState(item?.published_date || item?.planned_date || slot?.date || todayIstanbul());
  const [url, setUrl] = useState(item?.url || ""); const [notes, setNotes] = useState(item?.notes || "");
  const lockedSlotId = item?.slot_id || slot?.id || null;
  return <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void onSubmit({ title, planned_date: date, published_date: status === "published" ? publishedDate : null, platform, format, slot_id: lockedSlotId && date === (item?.planned_date || slot?.date) ? lockedSlotId : null, sponsor_id: sponsorId || null, fee_minor: sponsorId ? parseAmount(fee) : 0, currency, status, url: url || null, notes }); }}>
    {slot && <div className="selected-slot"><CalendarDays size={17} /> {slot.platform} · {slot.label} · {trDate(slot.date)}</div>}
    <div className="field"><label>İçerik başlığı *</label><Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Video veya paylaşım başlığı" /></div>
    <div className="form-row"><div className="field"><label>Yayın tarihi *</label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div><div className="field"><label>Durum</label><select value={status} onChange={(e) => setStatus(e.target.value as Publication["status"])}><option value="planned">Planlandı</option><option value="published">Yayında</option><option value="cancelled">İptal</option></select></div></div>
    {lockedSlotId && date !== (item?.planned_date || slot?.date) && <div className="date-warning">Tarihe, platforma ve formata uyan haftalık yayın yuvası kaydederken otomatik seçilir.</div>}
    {status === "published" && <div className="field"><label>Gerçek yayın tarihi *</label><Input type="date" value={publishedDate} onChange={(e) => setPublishedDate(e.target.value)} required /></div>}
    <div className="form-row"><div className="field"><label>Platform</label><select value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={!!lockedSlotId}><option>YouTube</option><option>Instagram</option><option>TikTok</option><option>LinkedIn</option><option>X</option></select></div><div className="field"><label>Format</label><select value={format} onChange={(e) => setFormat(e.target.value)} disabled={!!lockedSlotId}>{["long", "short", "reel", "tiktok", "teaser", "carousel", "tip", "other"].map((v) => <option key={v}>{v}</option>)}</select></div></div>
    <div className="field"><label>Sponsor</label><select value={sponsorId} onChange={(e) => setSponsorId(e.target.value)}><option value="">Organik içerik</option>{sponsors.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select></div>
    {sponsorId && <div className="form-row"><div className="field"><label>Video başına ücret</label><Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0,00" /></div><div className="field"><label>Para birimi</label><select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}><option value="TRY">TL</option><option value="USD">USD</option></select></div></div>}
    <div className="field"><label>Yayın bağlantısı {status === "published" && "*"}</label><Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required={status === "published"} placeholder="https://" /></div><div className="field"><label>Not</label><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div><Button type="submit" disabled={busy} className="full-button">{busy ? "Kaydediliyor…" : "İçeriği kaydet"}</Button>
  </form>;
}

function TransactionForm({ sponsors, item, defaultSponsor, busy, onSubmit }: { sponsors: Sponsor[]; item: Transaction | null; defaultSponsor: string | null; busy: boolean; onSubmit: (data: unknown) => Promise<void> }) {
  const [kind, setKind] = useState<Transaction["kind"]>(item?.kind || "income"); const [sponsorId, setSponsorId] = useState(item?.sponsor_id || defaultSponsor || "");
  const [amount, setAmount] = useState(item ? (item.amount_minor / 100).toString() : ""); const [currency, setCurrency] = useState<Currency>(item?.currency || "TRY"); const [date, setDate] = useState(item?.occurred_on || todayIstanbul()); const [note, setNote] = useState(item?.note || "");
  const [publicationId, setPublicationId] = useState(item?.publication_id || "");
  const [publications, setPublications] = useState<Publication[]>([]);
  useEffect(() => { if (!sponsorId) { setPublications([]); return; } api<{ publications: Publication[] }>(`/publications?sponsor=${encodeURIComponent(sponsorId)}`).then((r) => setPublications(r.publications)).catch(() => setPublications([])); }, [sponsorId]);
  const eligible = publications.filter((p) => p.currency === currency && p.status !== "cancelled");
  return <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void onSubmit({ kind, sponsor_id: sponsorId || null, publication_id: publicationId || null, amount_minor: parseAmount(amount), currency, occurred_on: date, note }); }}><div className="field"><label>İşlem türü</label><select value={kind} onChange={(e) => setKind(e.target.value as Transaction["kind"])}><option value="income">Tahsilat (gelen)</option><option value="credit">Platform kredisi</option><option value="expense">Gider (giden)</option></select></div><div className="field"><label>Sponsor {kind !== "expense" && "*"}</label><select value={sponsorId} onChange={(e) => { setSponsorId(e.target.value); setPublicationId(""); }} required={kind !== "expense"}><option value="">{kind === "expense" ? "Genel gider" : "Sponsor seç"}</option>{sponsors.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select></div><div className="form-row"><div className="field"><label>Tutar *</label><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="0,00" /></div><div className="field"><label>Para birimi</label><select value={currency} onChange={(e) => { setCurrency(e.target.value as Currency); setPublicationId(""); }}><option value="TRY">TL</option><option value="USD">USD</option></select></div></div>{sponsorId && <div className="field"><label>İlgili video (isteğe bağlı)</label><select value={publicationId} onChange={(e) => setPublicationId(e.target.value)}><option value="">Genel sponsor işlemi</option>{eligible.map((p) => <option value={p.id} key={p.id}>{p.title} · {shortDate(p.planned_date)}</option>)}</select></div>}<div className="field"><label>İşlem tarihi *</label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div><div className="field"><label>Açıklama</label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "credit" ? "Örn. Hosting kredisi" : "Örn. Eylül video ödemesi"} /></div><Button type="submit" disabled={busy} className="full-button">{busy ? "Kaydediliyor…" : "İşlemi kaydet"}</Button></form>;
}

createRoot(document.getElementById("root")!).render(<App />);
