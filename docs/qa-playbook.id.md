# Panduan QA — AW Browser Cleaner

English: [qa-playbook.md](qa-playbook.md)

Skenario praktis untuk penguji, QA engineer, dan tim dukungan yang memakai AW Browser Cleaner untuk mereset status satu situs di antara dua putaran uji. Setiap skenario menyebut tujuan, preset, langkah, hasil yang diharapkan, dan cara melampirkan laporan bukti ke tiket.

## Daftar isi

- [Prinsip lingkup](#prinsip-lingkup)
- [Sebelum mulai](#sebelum-mulai)
- [Laporan bukti](#laporan-bukti)
- [Preset kustom: Client state only](#preset-kustom-client-state-only)
- [Skenario 1: Logout dan session fixation](#skenario-1-logout-dan-session-fixation)
- [Skenario 2: Kunjungan pertama, onboarding, dan persetujuan cookie](#skenario-2-kunjungan-pertama-onboarding-dan-persetujuan-cookie)
- [Skenario 3: Verifikasi deploy dan cache busting](#skenario-3-verifikasi-deploy-dan-cache-busting)
- [Skenario 4: Pembaruan Service Worker dan PWA](#skenario-4-pembaruan-service-worker-dan-pwa)
- [Skenario 5: Migrasi skema IndexedDB](#skenario-5-migrasi-skema-indexeddb)
- [Skenario 6: Beberapa environment pada satu registrable domain](#skenario-6-beberapa-environment-pada-satu-registrable-domain)
- [Skenario 7: Aplikasi dan API pada origin berbeda](#skenario-7-aplikasi-dan-api-pada-origin-berbeda)
- [Skenario 8: Pembersihan sejak sesi uji](#skenario-8-pembersihan-sejak-sesi-uji)
- [Skenario 9: Serah terima otomasi lewat Test Mode](#skenario-9-serah-terima-otomasi-lewat-test-mode)
- [Referensi desain](#referensi-desain)

## Prinsip lingkup

Ekstensi hanya membersihkan **origin persis** (`scheme://host:port`). Ia tidak pernah menyentuh riwayat penjelajahan, unduhan, kata sandi tersimpan, data formulir, atau situs lain, dan tidak punya mode "semua kecuali". `https://app.example.test` dan `https://app.example.test:8443` adalah origin yang berbeda; begitu juga `http` dan `https`.

Cookie adalah satu-satunya tempat browser tidak mengikuti origin. Cookie dibatasi oleh host dan path, bukan port (RFC 6265 §8.5), dan cookie dengan atribut `Domain` dibagikan ke seluruh subdomain. Karena itu **Mode Cookie Presisi** (bawaan) hanya menghapus cookie yang berlaku untuk host target dan mempertahankan cookie domain bersama kecuali Anda mencentangnya, dan mode domain-wide membutuhkan konfirmasi merah. Baca layar hasil: layar itu menyebut berapa cookie bersama yang sengaja dipertahankan.

## Sebelum mulai

- Buka halaman yang ingin direset di tab aktif, lalu buka ekstensi. Origin target terisi dari tab. Pada halaman `chrome://` dan Chrome Web Store, ekstensi menampilkan layar "halaman tidak didukung" tempat Anda bisa mengetik target secara manual.
- Saat pertama kali membersihkan cookie untuk sebuah origin dalam Mode Cookie Presisi, Chrome meminta Anda memberi akses ke satu origin itu ("Izinkan akses membaca cookie"). Anda bisa mencabutnya di **Options → Izin per origin**. Tanpa izin itu langkah cookie gagal dengan `COOKIE_PERMISSION_MISSING`; tidak ada fallback ke domain-wide.
- Nilai cookie tidak pernah ditampilkan oleh ekstensi. Jika skenario perlu membandingkan session identifier, pakai DevTools browser (Application → Cookies) dan catat hanya apakah nilainya berubah, bukan nilainya.
- Preset bawaan: **Keluar akun** (cookie + Session Storage, lalu muat ulang), **Mulai dari awal** (cookie, Session Storage, Local Storage, IndexedDB, File Systems, Cache Storage, Service Workers, lalu membuka halaman awal; cache HTTP dipertahankan), **Atasi berkas usang** (cache HTTP, Cache Storage, Service Workers, lalu muat ulang tanpa cache; login tetap) dan **Semuanya** (semua jenis yang didukung, hanya untuk origin ini, lalu muat ulang tanpa cache).
- Pintasan: `Alt+Shift+K` menjalankan preset terakhir dan `Alt+Shift+L` menjalankan **Keluar akun** pada tab saat ini (ubah di `chrome://extensions/shortcuts`). Menu konteks "Bersihkan origin ini dengan preset…" menampilkan semua preset. Rencana yang akan menghapus cookie domain-wide tidak pernah dijalankan dari pintasan atau menu; popup dibuka untuk konfirmasi.

## Laporan bukti

Setelah setiap pembersihan, layar hasil menampilkan tabel sebelum/sesudah (hanya jumlah) dan tiga aksi:

- **Salin ringkasan** menaruh teks pendek di clipboard. Tempel ke komentar tiket.
- **Ekspor JSON** menyimpan laporan lengkap. Lampirkan ke tiket.
- **Markdown** menyimpan laporan yang sama sebagai berkas `.md` yang mudah dibaca. Tempel atau lampirkan.

Nama berkas mengikuti pola `aw-cleaner-<host>-<YYYYMMDD-HHmmss>.json` (dan `.md`). Host ditulis huruf kecil, port ditambahkan dengan tanda hubung, dan waktu memakai waktu lokal. Contoh: `aw-cleaner-staging.example.test-20261023-091500.json`, `aw-cleaner-localhost-3000-20261023-091500.json`.

Laporan hanya berisi jumlah dan metadata. Layar menyatakan "Nilai cookie tidak pernah ditampilkan" dan laporan menyatakan "No cookie values or storage contents" (laporan berbahasa Inggris), jadi laporan aman dilampirkan ke pelacak publik. Definisi bidang: [data-dictionary.md](data-dictionary.md).

Options → **Riwayat & bukti** menyimpan 20 pembersihan terakhir di perangkat (bisa dimatikan dan dihapus) dan bisa mengekspornya sebagai satu berkas JSON.

## Preset kustom: Client state only

Contoh terdokumentasi dari issue #34: bersihkan apa yang disimpan halaman di browser, pertahankan login.

| Pengaturan | Nilai |
| --- | --- |
| Nama | Client state only |
| Tipe data | Session Storage, Local Storage, IndexedDB |
| Cookie | tidak ada yang dipilih (mode cookie tidak berpengaruh) |
| Setelah membersihkan | Muat ulang |

Buat di **Options → Preset → Preset baru** (id menjadi `client-state-only`), atau impor berkas berikut dengan **Impor JSON**:

```json
{
  "format": "aw-browser-cleaner-presets",
  "version": 1,
  "exportedAt": "2026-10-23T08:00:00.000Z",
  "presets": [
    {
      "id": "client-state-only",
      "name": "Client state only",
      "dataTypes": ["sessionStorage", "localStorage", "indexedDB"],
      "cookieMode": "exact",
      "after": "reload",
      "startPath": "/"
    }
  ]
}
```

Preset ini muncul di "Preset lainnya…" pada popup dan di menu konteks. Karena tidak berisi cookie, preset berjalan tanpa konfirmasi, termasuk dari `Alt+Shift+K`.

## Skenario 1: Logout dan session fixation

Rujukan: OWASP Web Security Testing Guide WSTG-SESS-06 (Testing for Logout Functionality) dan WSTG-SESS-03 (Testing for Session Fixation).

- **Tujuan.** Menunjukkan bahwa logout membatalkan sesi di server dan bahwa session identifier baru diterbitkan saat pengguna login.
- **Preset.** **Keluar akun** (cookie presisi + Session Storage, lalu muat ulang).
- **Langkah.**
  1. Buka halaman login aplikasi, bersihkan status dengan **Keluar akun** agar Anda mulai sebagai anonim, lalu catat di DevTools apakah ada cookie sesi sebelum login (nama, serta apakah `HttpOnly` dan `Secure`).
  2. Login. Di DevTools periksa bahwa cookie sesi diganti setelah login: nilainya harus berbeda dari nilai sebelum login (pemeriksaan fixation). Catat "berubah" atau "tidak berubah".
  3. Simpan cookie sesi lama di DevTools profil uji sekali pakai ini (pakai akun uji; jangan pernah menempel nilainya ke tiket).
  4. Pakai tombol logout aplikasi sendiri. Pastikan cookie dihapus atau diganti dan Anda berada di halaman yang sudah logout.
  5. Putar ulang cookie sesi lama ke URL yang dilindungi (override DevTools atau HTTP client). Server harus menolaknya (WSTG-SESS-06: sesi diakhiri di sisi server, bukan hanya di browser).
  6. Login lagi lalu jalankan preset **Keluar akun** dari ekstensi. Pastikan tab dimuat ulang dalam keadaan logout, dan ekspor laporan.
- **Hasil yang diharapkan.** Setelah langkah 2 identifier berbeda dari sebelum login; setelah langkah 4 identifier lama ditolak; laporan langkah 6 menunjukkan jumlah cookie host-only menjadi 0 dan jumlah session storage menjadi 0. Cookie domain bersama yang sengaja dipertahankan tercantum di layar hasil.
- **Bukti.** Lampirkan JSON dari langkah 6 dan tulis hasil fixation dan replay di tiket dengan kata-kata ("session id berubah setelah login: ya").
- **Layar desain.** [Popup utama](../design/exports/png/PopupMain.png), [Hasil](../design/exports/png/PopupResult.png).

## Skenario 2: Kunjungan pertama, onboarding, dan persetujuan cookie

- **Tujuan.** Memverifikasi apa yang dilihat pengunjung baru: banner persetujuan cookie, tur onboarding, bahasa bawaan, dan pengaturan bawaan.
- **Preset.** **Mulai dari awal** (cookie, Session Storage, Local Storage, IndexedDB, File Systems, Cache Storage, Service Workers, lalu membuka halaman awal).
- **Langkah.**
  1. Buka situs, terima banner persetujuan, selesaikan onboarding, dan ubah satu pengaturan (misalnya tema).
  2. Buka ekstensi dan pilih **Mulai dari awal**; konfirmasi. Langkah cookie memakai konfirmasi `review` (tombol biru "Bersihkan sekarang").
  3. Ekstensi membuka halaman awal origin. Periksa bahwa banner persetujuan dan onboarding muncul lagi dan pengaturan kembali ke bawaan.
  4. Ulangi sekali dengan daftar tipe data dikurangi menjadi Local Storage saja jika status banner disimpan di sana, untuk mengetahui penyimpanan mana yang menyimpan persetujuan.
- **Hasil yang diharapkan.** Banner persetujuan dan onboarding muncul kembali; laporan menunjukkan cookie, Local Storage, dan IndexedDB menjadi 0 untuk origin ini. Situs lain tetap login.
- **Bukti.** Ekspor JSON (atau Salin ringkasan) dan lampirkan bersama tangkapan layar banner.
- **Layar desain.** [Popup utama](../design/exports/png/PopupMain.png), [Konfirmasi](../design/exports/png/PopupConfirm.png), [Hasil](../design/exports/png/PopupResult.png).

## Skenario 3: Verifikasi deploy dan cache busting

- **Tujuan.** Memastikan pengguna mendapat build baru setelah deploy, dan mengetahui apakah ada berkas usang yang disajikan dari cache.
- **Preset.** **Atasi berkas usang** (cache HTTP, Cache Storage, Service Workers, lalu muat ulang tanpa cache). Login tetap.
- **Langkah.**
  1. Sebelum deploy, catat identifier build yang ditampilkan aplikasi (footer, `/version.json`, atau hash aset).
  2. Deploy. Muat halaman seperti biasa dan catat identifier yang terlihat. Jika masih yang lama, browser atau Service Worker menyajikan berkas usang: simpan pengamatan itu.
  3. Jalankan **Atasi berkas usang** dan catat identifier setelah hard reload.
  4. Jika identifier benar hanya setelah preset, laporkan masalah cache busting: periksa `Cache-Control` dan `ETag` pada HTML dan aset tanpa hash, serta logika pembaruan Service Worker.
- **Hasil yang diharapkan.** Muat ulang biasa sudah menampilkan build baru. Jika tidak, preset memperbaikinya dan tiket menunjuk ke header cache atau Service Worker. Laporan menampilkan cache HTTP sebagai "–" (tidak bisa dihitung), serta Cache Storage dan Service Workers sebelum/sesudah.
- **Bukti.** Lampirkan laporan dan kedua identifier.
- **Layar desain.** [Popup utama dengan preset Atasi berkas usang](../design/exports/png/PopupMain--preset-stale-assets.png), [Hasil](../design/exports/png/PopupResult.png).

## Skenario 4: Pembaruan Service Worker dan PWA

- **Tujuan.** Memverifikasi bahwa Service Worker terpasang diperbarui ke versi baru, dan bahwa instalasi pertama pada profil bersih berjalan.
- **Preset.** **Atasi berkas usang** untuk jalur mulai dingin; tanpa preset untuk jalur pembaruan.
- **Langkah.**
  1. Pada build lama, buka DevTools → Application → Service Workers dan catat worker aktif serta nama Cache Storage (misalnya `app-v41`).
  2. Deploy build baru. Tanpa membersihkan apa pun, muat ulang dua kali dan amati jalur pembaruan: worker baru "waiting" atau "activated", dan nama cache berubah menjadi `app-v42`. Catat bagaimana pengguna diminta menyegarkan, jika ada.
  3. Jalankan **Atasi berkas usang**. Laporan menunjukkan Service Workers dan Cache Storage menjadi 0.
  4. Setelah muat ulang, periksa bahwa tepat satu worker terdaftar dan cache dibangun ulang dengan nama baru (jalur mulai dingin).
- **Hasil yang diharapkan.** Jalur pembaruan: worker baru aktif (atau aplikasi memberi prompt) tanpa pembersihan manual. Jalur mulai dingin: satu registrasi baru dan cache lengkap. Nama cache lama tidak tersisa.
- **Bukti.** Lampirkan laporan dari langkah 3 dan tangkapan layar DevTools setelah langkah 4.
- **Layar desain.** [Hasil](../design/exports/png/PopupResult.png).

## Skenario 5: Migrasi skema IndexedDB

- **Tujuan.** Memverifikasi bahwa versi skema baru memigrasikan data lokal yang ada tanpa kehilangan, dan bahwa instalasi baru membuat skema yang sama.
- **Preset.** **Client state only** untuk jalur instalasi baru; tanpa pembersihan untuk jalur migrasi.
- **Langkah.**
  1. Pada build lama, buat data representatif (beberapa record, satu dari setiap jenis). Catat nama dan versi database di DevTools → Application → IndexedDB.
  2. Deploy build baru dengan versi skema lebih tinggi. Muat ulang **tanpa** membersihkan. Periksa nomor versi baru, bahwa record masih ada, dan bahwa store atau index baru ada (jalur migrasi).
  3. Jalankan **Client state only**. Laporan menunjukkan IndexedDB menjadi 0 database; tab dimuat ulang.
  4. Buat data lagi pada build baru dan bandingkan store dan index dengan database hasil migrasi dari langkah 2 (jalur instalasi baru).
  5. Opsional: biarkan tab kedua terbuka pada build lama selama upgrade untuk melihat bagaimana aplikasi menangani event blocked atau `versionchange`.
- **Hasil yang diharapkan.** Migrasi mempertahankan semua record; instalasi baru menghasilkan skema identik; tidak ada error konsol dari upgrade.
- **Bukti.** Lampirkan laporan dari langkah 3 dan tabel store sebelum/sesudah dari DevTools.
- **Layar desain.** [Popup utama](../design/exports/png/PopupMain.png), [Options dengan preset](../design/exports/png/Options.png).

## Skenario 6: Beberapa environment pada satu registrable domain

- **Tujuan.** Mereset satu environment (misalnya `staging.example.test`) tanpa mengeluarkan akun dari yang lain (`qa.example.test`, `app.example.test`).
- **Preset.** **Keluar akun** atau **Mulai dari awal**, dalam Mode Cookie Presisi (bawaan).
- **Mengapa Mode Cookie Presisi.** `chrome.browsingData` hanya bisa menghapus cookie untuk seluruh registrable domain. Membersihkan `staging.example.test` dengan cara itu juga akan menghapus semua cookie `qa.example.test` dan `app.example.test` dan mengeluarkan Anda dari keduanya. Mode Cookie Presisi menampilkan cookie yang berlaku untuk host target, menghapus cookie host-only dan cookie terpartisi (CHIPS), dan mempertahankan cookie yang diset untuk `.example.test` dan dipakai bersama oleh environment lain. Ingat juga bahwa cookie tidak terisolasi per port (RFC 6265 §8.5): cookie host-only `staging.example.test` berlaku untuk `:3000` maupun `:8443`.
- **Langkah.**
  1. Login ke staging dan qa di dua tab.
  2. Di tab staging, buka ekstensi dan pilih **Keluar akun**. Berikan akses untuk origin ini jika diminta. Buka **Atur** pada ringkasan cookie untuk melihat grup: Host-only, Partitioned, dan Domain bersama. Nilai cookie tidak ditampilkan.
  3. Konfirmasi dengan "Bersihkan sekarang".
  4. Muat ulang tab qa. Tab itu harus tetap login.
  5. Jika Anda juga harus menghapus cookie domain bersama, centang di grup Domain bersama (konfirmasi menjadi merah) atau pindah ke Domain-wide. Perkirakan environment lain akan logout.
- **Hasil yang diharapkan.** Staging logout, qa tetap login. Layar hasil menyebut N cookie domain bersama sengaja dipertahankan, lengkap dengan domainnya.
- **Bukti.** Lampirkan JSON: `perOrigin[0].cookies` menunjukkan `removed`, `kept`, dan `failed`.
- **Layar desain.** [Cookie](../design/exports/png/PopupCookies.png), [Cookie domain-wide](../design/exports/png/PopupCookies--domain-wide.png), [Konfirmasi](../design/exports/png/PopupConfirm.png), [Hasil](../design/exports/png/PopupResult.png).

## Skenario 7: Aplikasi dan API pada origin berbeda

Issue #38.

- **Tujuan.** Mereset front end dan API-nya dalam satu aksi ketika keduanya berada pada origin berbeda (`https://app.example.test` dan `https://api.example.test`, atau `http://localhost:3000` dan `http://localhost:8080`).
- **Preset.** **Mulai dari awal**, atau preset kustom dengan API sebagai origin tambahan (preset dapat menyimpan origin persis tambahan, maksimal 10 secara total).
- **Langkah.**
  1. Buka front end di tab aktif dan buka ekstensi.
  2. Pada "Origin tambahan", ketik origin API (misalnya `https://api.example.test`) lalu pilih **Tambah**. Ulangi untuk origin lain; popup berhenti di 10 dan menolak duplikat serta apa pun yang bukan origin persis. Tombol kini berbunyi "Bersihkan 2 origin".
  3. Tinjau konfirmasi: semua origin tercantum. Session Storage dan muat ulang hanya berlaku untuk tab aktif; origin tambahan diproses untuk tipe data lain dan hal ini dinyatakan.
  4. Konfirmasi. Layar hasil menampilkan "2 origin diproses" dengan satu tabel per origin.
  5. Periksa bahwa kedua origin mulai dalam keadaan bersih: front end dimuat ulang, dan sesi API hilang (login lagi).
- **Hasil yang diharapkan.** Kedua origin dibersihkan, tidak ada yang lain. Origin ketiga, meski pada registrable domain yang sama, tidak tersentuh.
- **Bukti.** Satu laporan mencakup semua origin; nama berkas memakai host origin pertama. Lampirkan JSON.
- **Layar desain.** [Origin pada popup](../design/exports/png/PopupOrigins.png), [Popup utama](../design/exports/png/PopupMain.png), [Hasil](../design/exports/png/PopupResult.png).

## Skenario 8: Pembersihan sejak sesi uji

Issue #37.

- **Tujuan.** Menghapus hanya data yang dibuat oleh putaran uji, dan mempertahankan yang sudah ada sebelumnya.
- **Preset.** Preset tanpa cookie presisi, misalnya **Client state only**, atau preset apa pun dengan mode cookie Domain-wide.
- **Langkah.**
  1. Buka **Options → Riwayat & bukti → Sesi pengujian** dan pilih **Mulai sesi pengujian**. Waktu mulai ditampilkan; tersimpan sampai Anda mengakhiri sesi atau menutup browser.
  2. Jalankan alur uji sehingga situs membuat data.
  3. Di popup, atur **Rentang waktu** ke "Sejak sesi uji dimulai" (opsi menampilkan waktu mulai) lalu jalankan pembersihan.
  4. Di Options, pilih **Akhiri sesi**.
- **Hasil yang diharapkan.** Data yang dibuat sejak awal sesi dihapus; data lama pada origin yang sama dipertahankan selama Chrome mendukung rentang waktu. Tidak semua jenis penyimpanan mengikuti rentang waktu secara tepat: popup menyatakannya, dan sebagian jenis dihapus seluruhnya. Cookie presisi tidak bisa dibatasi waktu; popup menjelaskannya dan meminta Anda memilih Semua waktu atau mode domain-wide.
- **Bukti.** Kolom "Since" pada laporan berisi awal rentang (Markdown) dan `since` (JSON). Lampirkan dan sebutkan jenis mana yang terdampak.
- **Layar desain.** [Rentang waktu pada popup](../design/exports/png/PopupRange.png), [Options](../design/exports/png/Options.png), [Hasil](../design/exports/png/PopupResult.png).

## Skenario 9: Serah terima otomasi lewat Test Mode

Issue #39.

- **Tujuan.** Membiarkan Playwright, Puppeteer, atau Selenium mereset status situs lewat ekstensi alih-alih mengimplementasikan ulang pembersihan di kode uji, dengan preset dan Scope Guard yang sama.
- **Preset.** Preset kustom dengan **Setelah membersihkan: Jangan muat ulang** dan tanpa cookie, misalnya `client-state` (Local Storage, IndexedDB, Cache Storage).
- **Langkah.**
  1. Di **Options → Test Mode**, aktifkan Test Mode dan tulis origin environment uji Anda di "Origin yang diizinkan" (bawaan `http://localhost` dan `http://127.0.0.1`; entri tanpa port mengizinkan port apa pun). Pilih **Simpan origin**.
  2. Di skrip uji, kirim `chrome.runtime.sendMessage(EXTENSION_ID, { action: 'ping' })` dan pastikan `enabled: true`.
  3. Kirim `{ action: 'clean', preset: 'client-state' }` sebelum setiap uji dan pastikan `ok: true`.
  4. Biarkan skrip membersihkan cookie sendiri (`context.clearCookies()` atau `Network.deleteCookies`): cookie presisi membutuhkan izin per origin yang hanya bisa diberikan seseorang.
  5. Matikan Test Mode setelah putaran selesai jika profil browser dipakai ulang.
- **Hasil yang diharapkan.** Balasan berisi `ok`, `origin`, `presetId`, `result` tanpa nilai, dan `dropped`. Halaman yang tidak masuk daftar izin mendapat `ORIGIN_NOT_ALLOWED`; preset dengan cookie domain-wide mendapat `DOMAIN_WIDE_NOT_ALLOWED`; saat Test Mode mati setiap `clean` mendapat `TEST_MODE_DISABLED`.
- **Bukti.** Simpan objek `response` di log uji. Test Mode tidak membuat berkas laporan; untuk tiket, jalankan preset yang sama sekali lagi dari popup dan lampirkan laporan itu.
- **Selengkapnya.** Contoh kode, protokol lengkap, dan tabel error ada di [automation.md](automation.md).
- **Layar desain.** [Options](../design/exports/png/Options.png).

## Referensi desain

Berkas PNG yang ditautkan di atas berada di `design/exports/png/`. Berkas itu adalah **referensi desain** dari kanvas desain, bukan tangkapan layar ekstensi yang dirilis: tata letak, kata-kata, dan angka contoh (domain, jumlah, tanggal) bisa berbeda dari UI rilis, dan angkanya adalah data contoh. Jika desain dan ekstensi berbeda, ekstensi yang benar. Layar yang dipakai di sini:

| Nama | Berkas | Menampilkan |
| --- | --- | --- |
| Popup utama | [PopupMain.png](../design/exports/png/PopupMain.png) | Origin target, preset, tipe data, ringkasan cookie, rentang, dan aksi setelahnya |
| Popup cookie | [PopupCookies.png](../design/exports/png/PopupCookies.png) | Mode Cookie Presisi: cookie host-only, terpartisi, dan bersama |
| Popup konfirmasi | [PopupConfirm.png](../design/exports/png/PopupConfirm.png) | Apa yang akan dihapus dan apa yang tidak disentuh |
| Popup hasil | [PopupResult.png](../design/exports/png/PopupResult.png) | Tabel sebelum/sesudah serta aksi Salin ringkasan, Ekspor JSON, dan Markdown |
| Popup tidak didukung | [PopupUnsupported.png](../design/exports/png/PopupUnsupported.png) | Halaman tidak didukung, target manual, dan origin terbaru |
| Options | [Options.png](../design/exports/png/Options.png) | Preset, izin per origin, Test Mode, riwayat, dan pintasan |

Papan desain tambahan: [PopupOrigins.png](../design/exports/png/PopupOrigins.png) (beberapa origin) dan [PopupRange.png](../design/exports/png/PopupRange.png) (rentang waktu).
