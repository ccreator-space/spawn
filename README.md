<div align="center">
  <img src="public/logo.png" alt="Spawn logosu" width="104" />
  <h1>Spawn</h1>
  <p>İçerik takvimi, sponsorluk anlaşmaları ve ödemeler için self-hosted çalışma alanı.</p>
  <p><strong>Self-hosted · React · Poyraz UI · Hono · SQLite</strong></p>
</div>

## Problem

Birden fazla platformda düzenli içerik üretirken yayın takvimi, sponsor teslimleri ve ödemeler kısa sürede farklı tabloların ve mesajların arasına dağılıyor. Hangi içeriğin yayımlandığını, hangi anlaşmanın tamamlandığını ve hangi ödemenin beklendiğini tek bakışta görmek zorlaşıyor.

## Çözüm

Spawn; YouTube, Instagram, TikTok, LinkedIn ve X içeriklerini haftalık takvimde toplar. Sponsor anlaşmalarını ilgili yayınlar ve finans hareketleriyle aynı çalışma alanında buluşturur. Böylece planlanan içerikten tahsilata kadar bütün süreç tek yerden takip edilir.

## Neler yapar?

| Alan | Özellikler |
| --- | --- |
| İlk kurulum | Platform ikonlarıyla haftalık takvim, sponsorlar, geçmiş içerikler ve finans kayıtları için onboarding |
| İçerik takvimi | Sabit haftalık yayın düzeni, içerik durumu ve yayın bağlantıları |
| Sponsorlar | Her marka için anlaşma, yayın, ödeme ve kalan teslim özeti |
| Finans | Video başına ücret, nakit tahsilat, platform kredisi, gider ve bekleyen alacak takibi |
| Kur gösterimi | Doviz.dev üzerinden TCMB USD/TL kuru; tek tuşla TL veya USD toplamları |
| Güvenlik | Parola karması, HTTP-only oturum çerezi, giriş denemesi sınırı ve sunucu tarafı doğrulama |
| Veri | Tek SQLite dosyası, şema geçişi, bütünlük kontrollü çevrimiçi yedek |

## Yerelde çalıştırma

Node.js 22+ ve pnpm 11 gerekir.

```sh
pnpm install
pnpm dev
```

Arayüz `http://localhost:5173`, API `http://localhost:3001` adresindedir. İlk yerel açılışta yönetici hesabını tarayıcıdan oluştur. Ardından onboarding ekranında çalışma alanını, haftalık yayın düzenini ve isteğe bağlı başlangıç kayıtlarını gir. Yeni kurulumlar boş başlar; örnek sponsor veya sabit takvim verisi eklenmez. Derlenmiş sürümü tek portta çalıştırmak için:

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

İlk kurulumda aynı volume içinde veritabanı ve yönetici hesabı oluşturulmalıdır. Bunun için ilk dağıtımda geçici bir **Run Command** kullan: komut `/bin/sh`, argümanlar `-c` ve `node -e "import('./dist/server/db.js').then(m => { const db = m.openDb(); db.close(); })" && exec node dist/server/index.js`. Konteyner çalışınca terminalinden `node /app/dist/server/create-admin.js sen@ornek.com` komutuyla hesabı oluştur; parola etkileşimli olarak gizli istenir. Ardından geçici Run Command ayarını kaldırıp varsayılan Dockerfile komutuyla yeniden dağıt. İlk girişte onboarding ekranı açılır. Üretim uygulaması eksik veritabanıyla bilinçli olarak başlamaz; yanlış volume bağlaması boş bir hesapla sessizce açılmaz.

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

Onboarding, haftalık düzen, ilk hesap kurulumu, sponsor/ödeme hesapları, şema geçişleri ve veri tabanını yeniden açınca kayıtların korunması test edilir.
