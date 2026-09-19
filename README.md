<div align="center">
  <img src="public/logo.png" alt="Spawn logosu" width="104" />
  <h1>Spawn</h1>
  <p>İçerik takvimi, sponsorluk anlaşmaları ve ödemeler için kişisel çalışma alanı.</p>
  <p><strong>Self-hosted · React · Poyraz UI · Hono · SQLite</strong></p>
</div>

Spawn; YouTube, Instagram, TikTok, LinkedIn ve X yayınlarını haftalık bir düzende planlamak ve sponsorlu içeriklerin finansal durumunu izlemek için geliştirildi. Çekim takvimi, e-posta içe aktarımı ve banka bağlantısı içermez; gerçek yayın ve ödeme kayıtları kullanıcı tarafından girilir.

## Neler yapar?

| Alan | Özellikler |
| --- | --- |
| İçerik takvimi | Sabit haftalık yayın yuvaları, planlanan/yayımlanan/iptal edilen içerikler, yayın bağlantıları |
| Sponsorlar | Marka sayfası, anlaşılmış ve yayımlanmış video sayıları, sıradaki boş YouTube uzun video tarihleri |
| Finans | Video başına sabit ücret, kısmi tahsilat, sponsor giderleri, bekleyen alacak; TL ve USD ayrı kayıtlar |
| Kur gösterimi | ECB referans kuruyla yaklaşık TL/USD toplamları; banka kuru veya muhasebe kaydı yerine geçmez |
| Güvenlik | Parola karması, HTTP-only oturum çerezi, giriş denemesi sınırı ve sunucu tarafı doğrulama |
| Veri | Tek SQLite dosyası, şema geçişi, bütünlük kontrollü çevrimiçi yedek |

Arayüz [Poyraz UI](https://www.npmjs.com/package/poyraz-ui) bileşenleriyle hazırlanmıştır. Yedi başlangıç markası ile Atoms.dev ve Abacus.ai örnek marka listesine eklenir; hiçbir ücret, ödeme veya geçmiş video uydurulmaz.

## Yerelde çalıştırma

Node.js 22+ ve pnpm 11 gerekir.

```sh
pnpm install
pnpm dev
```

Arayüz `http://localhost:5173`, API `http://localhost:3001` adresindedir. İlk yerel açılışta yönetici hesabını tarayıcıdan oluştur. Derlenmiş sürümü tek portta çalıştırmak için:

```sh
pnpm build
pnpm start
```

Bu durumda arayüz ve API `http://localhost:3001` adresindedir. Yerel kayıtlar `data/sponsor.db` dosyasında tutulur; `data/` Git deposuna ve Docker imajına dahil edilmez.

## Dokploy ile yayınlama

Dokploy'da yeni bir **Application** oluşturup bu depoyu `main` dalından bağla; build türü olarak **Dockerfile** seç. Uygulamayı tek replika ile çalıştır ve şu ayarları yap:

| Ayar | Değer |
| --- | --- |
| Ortam | `NODE_ENV=production`, `PORT=3001`, `DATA_DIR=/app/data`, `APP_ORIGIN=https://<alan-adın>` |
| Kalıcı alan | Adlandırılmış Docker volume → `/app/data` |
| Domain | Konteyner portu `3001`, HTTPS için Let's Encrypt |

İlk kurulumda aynı volume içinde veritabanı ve yönetici hesabı oluşturulmalıdır. Bunun için ilk dağıtımda geçici bir **Run Command** kullan: komut `/bin/sh`, argümanlar `-c` ve `node -e "import('./dist/server/db.js').then(m => { const db = m.openDb(); db.close(); })" && exec node dist/server/index.js`. Konteyner çalışınca terminalinden `node /app/dist/server/create-admin.js sen@ornek.com` komutuyla hesabı oluştur; parola etkileşimli olarak gizli istenir. Ardından geçici Run Command ayarını kaldırıp varsayılan Dockerfile komutuyla yeniden dağıt. Üretim uygulaması eksik veritabanıyla bilinçli olarak başlamaz; yanlış volume bağlaması boş bir hesapla sessizce açılmaz.

Yeni bir sürümü dağıtmadan önce `node /app/dist/server/backup.js` ile çalışan SQLite veritabanının tutarlı bir yedeğini al. Dokploy **Schedules** bölümünde bu komutu günlük çalıştırabilirsin. Yedekler volume içindeki `backups/` dizininde kalır; ayrıca sunucu dışında da saklanmalıdır. Yeni imaj oluşturulurken mevcut volume'u değiştirme veya silme.

## Docker Compose ile VPS kurulumu

1. `.env.example` dosyasını `.env` olarak kopyala ve `APP_DOMAIN` değerini sunucunun alan adına ayarla. DNS kaydını VPS'e yönlendir; 80 ve 443 portlarını aç.
2. Kalıcı veri dizinini oluştur: `mkdir -p data`. Konteyner kullanıcısı için dizin sahipliğini `10001:10001` yap.
3. `docker compose build app` çalıştır.
4. `docker compose run --rm app node dist/server/create-admin.js sen@ornek.com` ile ilk yönetici hesabını oluştur. Parola terminalde gizli istenir.
5. `docker compose up -d` çalıştır. Caddy HTTPS sertifikasını yönetir.

Yalnızca Caddy dışarı açılır; uygulamanın 3001 portu dışarı yayımlanmaz. Üretim sunucusu mevcut veri tabanı dosyası olmadan başlamaz. Böylece yanlış veya boş bir veri bağlaması, hesapların silinmiş gibi görünmesine yol açmak yerine açık bir hatayla durur. Aynı SQLite dosyasına birden fazla uygulama replikası bağlama.

### Güncelleme

Çalışan uygulamayı proje dizininden güncelle:

```sh
sh scripts/update.sh
```

Betik, yeni imajı kurmadan önce SQLite yedeği alır ve bütünlüğünü denetler. `data/` dizini konteyner dışında kaldığı için imaj yenilemesi verileri silmez. Son yedeği ayrıca VPS dışındaki güvenli bir konuma kopyala. Güncellemeden sonra giriş yapıp sponsor, içerik ve finans kayıtlarını kontrol et.

### Yedek ve geri yükleme

```sh
docker compose exec -T app node dist/server/backup.js
```

Yedek `data/backups/` altına yazılır ve bütünlük kontrolünden geçer. Düzenli VPS dışı yedek ve geri yükleme sınaması önerilir. Geri yüklerken uygulamayı durdur, mevcut `data/` dizinini tarihli bir adla kenara al, doğrulanmış `.db` yedeğini yeni `data/sponsor.db` olarak kopyala, dizin sahipliğini `10001:10001` yap ve uygulamayı yeniden başlat. Çalışan SQLite veritabanından yalnızca `.db` dosyasını doğrudan kopyalama; WAL içindeki son işlemler eksik kalabilir.

## Geliştirme kontrolleri

```sh
pnpm typecheck
pnpm test
pnpm build
```

Haftalık düzen, ilk hesap kurulumu, sponsor/ödeme hesapları ve veri tabanını yeniden açınca kayıtların korunması test edilir.
