import { useMemo, useState } from "react";
import { Button, Card, CardContent, Input } from "poyraz-ui/atoms";
import { ArrowLeft, ArrowRight, AtSign, Building2, CalendarPlus, Check, History, Instagram, Linkedin, Music2, Plus, Trash2, Youtube } from "lucide-react";

type Currency = "TRY" | "USD";
type Platform = "YouTube" | "Instagram" | "TikTok" | "LinkedIn" | "X";
type SlotDraft = { client_id: string; weekday: number; platform: Platform; format: string; label: string };
type SponsorDraft = { client_id: string; name: string; website_url: string; logo_url: string; notes: string };
type PublicationDraft = { client_id: string; sponsor_ref: string; title: string; platform: Platform; format: string; planned_date: string; published_date: string; status: "planned" | "published"; url: string; fee: string; currency: Currency; notes: string };
type TransactionDraft = { client_id: string; sponsor_ref: string; kind: "income" | "expense" | "credit"; amount: string; currency: Currency; occurred_on: string; note: string };

export type OnboardingStatus = { completed: boolean; workspaceName: string; slotCount: number; sponsorCount: number };

const DAYS = [
  { value: 1, label: "Pazartesi" }, { value: 2, label: "Salı" }, { value: 3, label: "Çarşamba" },
  { value: 4, label: "Perşembe" }, { value: 5, label: "Cuma" }, { value: 6, label: "Cumartesi" }, { value: 0, label: "Pazar" },
];
const PLATFORMS: Array<{ value: Platform; label: string }> = [
  { value: "YouTube", label: "YouTube" }, { value: "Instagram", label: "Instagram" }, { value: "TikTok", label: "TikTok" },
  { value: "LinkedIn", label: "LinkedIn" }, { value: "X", label: "X" },
];
const FORMATS: Record<Platform, string[]> = {
  YouTube: ["long", "short"], Instagram: ["reel", "carousel"], TikTok: ["tiktok"], LinkedIn: ["teaser", "carousel", "tip", "post"], X: ["tip", "post"],
};
const TEMPLATE: Omit<SlotDraft, "client_id">[] = [
  { weekday: 1, platform: "YouTube", format: "long", label: "Haftanın uzun videosu" },
  { weekday: 2, platform: "Instagram", format: "reel", label: "Reel" },
  { weekday: 2, platform: "TikTok", format: "tiktok", label: "TikTok videosu" },
  { weekday: 3, platform: "LinkedIn", format: "post", label: "LinkedIn paylaşımı" },
  { weekday: 5, platform: "YouTube", format: "long", label: "Haftanın ikinci videosu" },
  { weekday: 6, platform: "YouTube", format: "short", label: "Uzun videodan Short" },
  { weekday: 6, platform: "Instagram", format: "reel", label: "Hafta sonu Reeli" },
  { weekday: 0, platform: "X", format: "post", label: "Haftalık not" },
];
const uid = () => crypto.randomUUID();
const today = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const parseMinor = (value: string) => Math.round(Number(value.replace(",", ".")) * 100);

function PlatformIcon({ platform, size = 19 }: { platform: Platform; size?: number }) {
  if (platform === "YouTube") return <Youtube size={size} />;
  if (platform === "Instagram") return <Instagram size={size} />;
  if (platform === "TikTok") return <Music2 size={size} />;
  if (platform === "LinkedIn") return <Linkedin size={size} />;
  return <AtSign size={size} />;
}

export function Onboarding({ initialName, onComplete }: { initialName: string; onComplete: (status: OnboardingStatus) => void }) {
  const [step, setStep] = useState(0);
  const [workspaceName, setWorkspaceName] = useState(initialName || "İçerik Stüdyom");
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [sponsors, setSponsors] = useState<SponsorDraft[]>([]);
  const [publications, setPublications] = useState<PublicationDraft[]>([]);
  const [transactions, setTransactions] = useState<TransactionDraft[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [slotDay, setSlotDay] = useState(1); const [slotPlatform, setSlotPlatform] = useState<Platform>("YouTube");
  const [slotFormat, setSlotFormat] = useState("long"); const [slotLabel, setSlotLabel] = useState("");
  const [sponsorForm, setSponsorForm] = useState({ name: "", website_url: "", logo_url: "", notes: "" });
  const [publicationForm, setPublicationForm] = useState<Omit<PublicationDraft, "client_id">>({ sponsor_ref: "", title: "", platform: "YouTube", format: "long", planned_date: today(), published_date: today(), status: "published", url: "", fee: "0", currency: "TRY", notes: "" });
  const [transactionForm, setTransactionForm] = useState<Omit<TransactionDraft, "client_id">>({ sponsor_ref: "", kind: "income", amount: "", currency: "TRY", occurred_on: today(), note: "" });

  const groupedSlots = useMemo(() => DAYS.map((day) => ({ ...day, slots: slots.filter((slot) => slot.weekday === day.value) })), [slots]);
  const steps = ["Takvim", "Sponsorlar", "Geçmiş kayıtlar", "Tamamla"];
  const goNext = () => {
    setError("");
    if (step === 0 && !workspaceName.trim()) return setError("Çalışma alanına bir ad ver.");
    if (step === 0 && slots.length === 0) return setError("Takvime en az bir yayın yuvası ekle.");
    setStep((value) => Math.min(3, value + 1));
  };
  const addSlot = () => {
    if (slots.some((slot) => slot.weekday === slotDay && slot.platform === slotPlatform && slot.format === slotFormat)) return setError("Bu gün, platform ve format için zaten bir yuva var.");
    const label = slotLabel.trim() || `${slotPlatform} ${slotFormat}`;
    setSlots((items) => [...items, { client_id: uid(), weekday: slotDay, platform: slotPlatform, format: slotFormat, label }]);
    setSlotLabel(""); setError("");
  };
  const addSponsor = () => {
    if (!sponsorForm.name.trim()) return setError("Sponsor adını gir.");
    const clientId = uid();
    setSponsors((items) => [...items, { client_id: clientId, ...sponsorForm, name: sponsorForm.name.trim() }]);
    setSponsorForm({ name: "", website_url: "", logo_url: "", notes: "" });
    if (!publicationForm.sponsor_ref) setPublicationForm((form) => ({ ...form, sponsor_ref: clientId }));
    if (!transactionForm.sponsor_ref) setTransactionForm((form) => ({ ...form, sponsor_ref: clientId }));
    setError("");
  };
  const addPublication = () => {
    if (!publicationForm.title.trim()) return setError("İçerik başlığını gir.");
    if (publicationForm.status === "published" && !publicationForm.url.trim()) return setError("Yayımlanmış içeriğin bağlantısını gir.");
    if (!Number.isFinite(parseMinor(publicationForm.fee)) || parseMinor(publicationForm.fee) < 0) return setError("Geçerli bir içerik ücreti gir.");
    setPublications((items) => [...items, { client_id: uid(), ...publicationForm, title: publicationForm.title.trim() }]);
    setPublicationForm((form) => ({ ...form, title: "", url: "", fee: "0", notes: "" })); setError("");
  };
  const addTransaction = () => {
    if ((transactionForm.kind === "income" || transactionForm.kind === "credit") && !transactionForm.sponsor_ref) return setError("Tahsilat veya kredi için sponsor seç.");
    if (!Number.isFinite(parseMinor(transactionForm.amount)) || parseMinor(transactionForm.amount) <= 0) return setError("Geçerli bir tutar gir.");
    setTransactions((items) => [...items, { client_id: uid(), ...transactionForm }]);
    setTransactionForm((form) => ({ ...form, amount: "", note: "" })); setError("");
  };
  const finish = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/onboarding", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        workspace_name: workspaceName.trim(), slots: slots.map(({ client_id: _clientId, ...slot }) => slot), sponsors,
        publications: publications.map(({ client_id: _clientId, fee, ...item }) => ({ ...item, fee_minor: item.sponsor_ref ? parseMinor(fee) : 0, published_date: item.status === "published" ? item.published_date : null, url: item.url || null })),
        transactions: transactions.map(({ client_id: _clientId, amount, ...item }) => ({ ...item, amount_minor: parseMinor(amount) })),
      }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Kurulum tamamlanamadı.");
      onComplete({ completed: true, workspaceName: body.workspaceName, slotCount: body.counts.slots, sponsorCount: body.counts.sponsors });
    } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  };

  return <div className="onboarding-page"><div className="onboarding-shell">
    <div className="onboarding-brand"><img src="/logo.png" alt="" /><div><strong>Spawn</strong><span>İçerik ve sponsorluk alanını kur</span></div></div>
    <div className="onboarding-progress">{steps.map((label, index) => <div key={label} className={index <= step ? "active" : ""}><span>{index < step ? <Check size={14} /> : index + 1}</span><small>{label}</small></div>)}</div>
    <Card className="onboarding-card"><CardContent>
      {step === 0 && <div className="onboarding-step"><div className="step-title"><CalendarPlus size={24} /><div><h1>Haftalık içerik düzenini kur</h1><p>Hangi gün, hangi platformda, hangi formatı paylaştığını yerleştir.</p></div></div>
        <div className="field"><label>Çalışma alanı adı</label><Input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Örn. Deniz'in İçerik Stüdyosu" /></div>
        <div className="platform-picker">{PLATFORMS.map(({ value, label }) => <button type="button" key={value} className={`${value.toLowerCase()} ${slotPlatform === value ? "active" : ""}`} onClick={() => { setSlotPlatform(value); setSlotFormat(FORMATS[value][0]!); }}><PlatformIcon platform={value} /><span>{label}</span></button>)}</div>
        <div className="slot-builder"><div className="field"><label>Gün</label><select value={slotDay} onChange={(event) => setSlotDay(Number(event.target.value))}>{DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></div><div className="field"><label>Format</label><select value={slotFormat} onChange={(event) => setSlotFormat(event.target.value)}>{FORMATS[slotPlatform].map((format) => <option key={format}>{format}</option>)}</select></div><div className="field grow"><label>Takvimde görünecek ad</label><Input value={slotLabel} onChange={(event) => setSlotLabel(event.target.value)} placeholder="Örn. Haftalık uzun video" /></div><Button type="button" onClick={addSlot}><Plus size={16} /> Ekle</Button></div>
        <div className="template-actions"><Button type="button" variant="outline" size="sm" onClick={() => setSlots(TEMPLATE.map((slot) => ({ ...slot, client_id: uid() })))}>Örnek planı kullan</Button>{slots.length > 0 && <button type="button" onClick={() => setSlots([])}>Takvimi temizle</button>}</div>
        <div className="week-preview">{groupedSlots.map((day) => <div className="preview-day" key={day.value}><strong>{day.label}</strong><div>{day.slots.length ? day.slots.map((slot) => <span className={`preview-slot ${slot.platform.toLowerCase()}`} key={slot.client_id}><PlatformIcon platform={slot.platform} size={15} /><span>{slot.label}<small>{slot.platform} · {slot.format}</small></span><button type="button" aria-label="Yuvayı kaldır" onClick={() => setSlots((items) => items.filter((item) => item.client_id !== slot.client_id))}><Trash2 size={14} /></button></span>) : <em>Boş</em>}</div></div>)}</div>
      </div>}

      {step === 1 && <div className="onboarding-step"><div className="step-title"><Building2 size={24} /><div><h1>Sponsorlarını ekle</h1><p>Marka adı, sitesi ve logosu sponsor kartlarında kullanılır. Bu adım isteğe bağlıdır.</p></div></div>
        <div className="onboarding-form-grid"><div className="field"><label>Marka adı</label><Input value={sponsorForm.name} onChange={(event) => setSponsorForm({ ...sponsorForm, name: event.target.value })} placeholder="Örn. Acme" /></div><div className="field"><label>Web sitesi</label><Input type="url" value={sponsorForm.website_url} onChange={(event) => setSponsorForm({ ...sponsorForm, website_url: event.target.value })} placeholder="https://" /></div><div className="field"><label>Logo bağlantısı</label><Input type="url" value={sponsorForm.logo_url} onChange={(event) => setSponsorForm({ ...sponsorForm, logo_url: event.target.value })} placeholder="https://.../logo.png" /></div><div className="field"><label>Not</label><Input value={sponsorForm.notes} onChange={(event) => setSponsorForm({ ...sponsorForm, notes: event.target.value })} placeholder="İletişim veya anlaşma notu" /></div></div>
        <Button type="button" onClick={addSponsor}><Plus size={16} /> Sponsoru listeye ekle</Button>
        <div className="onboarding-list">{sponsors.map((sponsor) => <div key={sponsor.client_id} className="onboarding-list-row">{sponsor.logo_url ? <img src={sponsor.logo_url} alt="" /> : <span>{sponsor.name.slice(0, 2).toUpperCase()}</span>}<div><strong>{sponsor.name}</strong><small>{sponsor.website_url || "Web sitesi eklenmedi"}</small></div><button type="button" onClick={() => setSponsors((items) => items.filter((item) => item.client_id !== sponsor.client_id))}><Trash2 size={16} /></button></div>)}{!sponsors.length && <div className="onboarding-empty">Sponsorları daha sonra da ekleyebilirsin.</div>}</div>
      </div>}

      {step === 2 && <div className="onboarding-step"><div className="step-title"><History size={24} /><div><h1>Geçmişini içeri al</h1><p>Yayımlanmış veya planlanmış içeriklerini ve finans hareketlerini başlangıçta ekleyebilirsin.</p></div></div>
        <section className="history-section"><h2>İçerik</h2><div className="onboarding-form-grid"><div className="field wide"><label>Başlık</label><Input value={publicationForm.title} onChange={(event) => setPublicationForm({ ...publicationForm, title: event.target.value })} /></div><div className="field"><label>Sponsor</label><select value={publicationForm.sponsor_ref} onChange={(event) => setPublicationForm({ ...publicationForm, sponsor_ref: event.target.value })}><option value="">Organik içerik</option>{sponsors.map((sponsor) => <option key={sponsor.client_id} value={sponsor.client_id}>{sponsor.name}</option>)}</select></div><div className="field"><label>Platform</label><select value={publicationForm.platform} onChange={(event) => { const platform = event.target.value as Platform; setPublicationForm({ ...publicationForm, platform, format: FORMATS[platform][0]! }); }}>{PLATFORMS.map((platform) => <option key={platform.value}>{platform.value}</option>)}</select></div><div className="field"><label>Format</label><select value={publicationForm.format} onChange={(event) => setPublicationForm({ ...publicationForm, format: event.target.value })}>{FORMATS[publicationForm.platform].map((format) => <option key={format}>{format}</option>)}</select></div><div className="field"><label>Takvim tarihi</label><Input type="date" value={publicationForm.planned_date} onChange={(event) => setPublicationForm({ ...publicationForm, planned_date: event.target.value })} /></div><div className="field"><label>Durum</label><select value={publicationForm.status} onChange={(event) => setPublicationForm({ ...publicationForm, status: event.target.value as PublicationDraft["status"] })}><option value="published">Yayında</option><option value="planned">Planlandı</option></select></div>{publicationForm.status === "published" && <div className="field"><label>Gerçek yayın tarihi</label><Input type="date" value={publicationForm.published_date} onChange={(event) => setPublicationForm({ ...publicationForm, published_date: event.target.value })} /></div>}<div className="field"><label>Bağlantı</label><Input type="url" value={publicationForm.url} onChange={(event) => setPublicationForm({ ...publicationForm, url: event.target.value })} placeholder="https://" /></div><div className="field"><label>Ücret</label><Input inputMode="decimal" value={publicationForm.fee} onChange={(event) => setPublicationForm({ ...publicationForm, fee: event.target.value })} /></div><div className="field"><label>Para birimi</label><select value={publicationForm.currency} onChange={(event) => setPublicationForm({ ...publicationForm, currency: event.target.value as Currency })}><option value="TRY">TL</option><option value="USD">USD</option></select></div></div><Button type="button" variant="outline" onClick={addPublication}><Plus size={16} /> İçeriği ekle</Button>
          {publications.map((item) => <div className="compact-entry" key={item.client_id}><PlatformIcon platform={item.platform} size={16} /><span><strong>{item.title}</strong><small>{item.planned_date} · {item.status === "published" ? "Yayında" : "Planlı"}</small></span><button type="button" onClick={() => setPublications((items) => items.filter((entry) => entry.client_id !== item.client_id))}><Trash2 size={15} /></button></div>)}</section>
        <section className="history-section"><h2>Finans hareketi</h2><div className="onboarding-form-grid"><div className="field"><label>Tür</label><select value={transactionForm.kind} onChange={(event) => setTransactionForm({ ...transactionForm, kind: event.target.value as TransactionDraft["kind"] })}><option value="income">Tahsilat</option><option value="credit">Platform kredisi</option><option value="expense">Gider</option></select></div><div className="field"><label>Sponsor</label><select value={transactionForm.sponsor_ref} onChange={(event) => setTransactionForm({ ...transactionForm, sponsor_ref: event.target.value })}><option value="">{transactionForm.kind === "expense" ? "Genel gider" : "Sponsor seç"}</option>{sponsors.map((sponsor) => <option key={sponsor.client_id} value={sponsor.client_id}>{sponsor.name}</option>)}</select></div><div className="field"><label>Tutar</label><Input inputMode="decimal" value={transactionForm.amount} onChange={(event) => setTransactionForm({ ...transactionForm, amount: event.target.value })} /></div><div className="field"><label>Para birimi</label><select value={transactionForm.currency} onChange={(event) => setTransactionForm({ ...transactionForm, currency: event.target.value as Currency })}><option value="TRY">TL</option><option value="USD">USD</option></select></div><div className="field"><label>Tarih</label><Input type="date" value={transactionForm.occurred_on} onChange={(event) => setTransactionForm({ ...transactionForm, occurred_on: event.target.value })} /></div><div className="field wide"><label>Açıklama</label><Input value={transactionForm.note} onChange={(event) => setTransactionForm({ ...transactionForm, note: event.target.value })} /></div></div><Button type="button" variant="outline" onClick={addTransaction}><Plus size={16} /> Finans hareketini ekle</Button>
          {transactions.map((item) => <div className="compact-entry" key={item.client_id}><span className="entry-kind">{item.kind === "income" ? "↓" : item.kind === "credit" ? "◆" : "↑"}</span><span><strong>{item.note || (item.kind === "income" ? "Tahsilat" : item.kind === "credit" ? "Platform kredisi" : "Gider")}</strong><small>{item.amount} {item.currency} · {item.occurred_on}</small></span><button type="button" onClick={() => setTransactions((items) => items.filter((entry) => entry.client_id !== item.client_id))}><Trash2 size={15} /></button></div>)}</section>
      </div>}

      {step === 3 && <div className="onboarding-step final-step"><div className="finish-icon"><Check size={30} /></div><h1>{workspaceName} hazır</h1><p>Kaydettiğinde takvimin ve başlangıç kayıtların tek işlemde oluşturulacak.</p><div className="setup-summary"><div><strong>{slots.length}</strong><span>haftalık yuva</span></div><div><strong>{sponsors.length}</strong><span>sponsor</span></div><div><strong>{publications.length}</strong><span>içerik</span></div><div><strong>{transactions.length}</strong><span>finans hareketi</span></div></div><Button type="button" disabled={busy} onClick={() => void finish()}>{busy ? "Kuruluyor…" : "Çalışma alanını oluştur"}</Button></div>}
      {error && <div className="form-error onboarding-error">{error}</div>}
      <div className="onboarding-nav">{step > 0 ? <Button type="button" variant="outline" onClick={() => { setStep((value) => value - 1); setError(""); }}><ArrowLeft size={16} /> Geri</Button> : <span />}{step < 3 && <Button type="button" onClick={goNext}>{step === 1 ? "Sponsorları kaydet" : step === 2 ? "Özeti gör" : "Devam et"} <ArrowRight size={16} /></Button>}</div>
    </CardContent></Card>
  </div></div>;
}
