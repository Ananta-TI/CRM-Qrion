# PROMPT: UI/UX Design System — UKS / Qrion

> Salin **seluruh isi dokumen ini** ke temanmu (atau tempel sebagai instruksi awal ke AI coding assistant-nya).
> Tujuannya supaya tampilan aplikasinya searah dengan punyamu: token, layout, komponen, animasi, dan perilaku responsif yang sama.

---

## 0. Peran & tujuan

Kamu adalah **senior front-end engineer + product designer**. Tugasmu membangun ulang UI/UX aplikasi **UKS (Unit Kesehatan Sekolah)** bernama **Qrion** supaya **identik secara visual dan interaktif** dengan acuan di dokumen ini.

Aturan kerja:
1. Ikuti **persis** nilai token, radius, shadow, easing, dan durasi di dokumen ini. Jangan mengarang nilai baru.
2. Jangan menambah dependency animasi/UI apa pun di luar yang disebutkan.
3. Semua warna, radius, jarak, dan tipografi harus lewat **CSS custom property** (`var(--token)`), bukan hardcode.
4. Sertakan **`prefers-reduced-motion`** di setiap animasi.
5. Aksesibilitas wajib: fokus terlihat, label ARIA pada kontrol ikon, dan `aria-current="page"` untuk navigasi aktif.

---

## 1. Stack & konvensi teknis

| Bagian | Pilihan |
|---|---|
| Framework | **Next.js 16** (App Router, React 19, Turbopack) |
| Bahasa | **TypeScript**, strict |
| Styling utama | **CSS global + design tokens** (`app/globals.css`) |
| Utility CSS | **Tailwind** — hanya untuk layout cepat; komponen inti pakai class semantik |
| Animasi | **framer-motion v14** (hanya untuk layout/enter-exit) + **CSS keyframes** (untuk dekoratif) |
| Ikon | **lucide-react** |
| Font | **Urbanist** (via `next/font`, variable) |
| Angka | `font-variant-numeric: tabular-nums` di seluruh body |

**Prinsip styling yang tidak boleh dilanggar:**
- Semua komponen memakai **class semantik BEM-ish** (`.card`, `.card__head`, `.btn--primary`, `.stat__value`), bukan utility acak.
- Utility Tailwind hanya untuk posisi/spacing sebaris atau di komponen interaktif kecil.
- Animasi layout yang mengubah posisi **wajib pakai transform/opacity**, bukan `top/left/width` (kecuali framer-motion `layout`).

---

## 2. Design tokens (salin apa adanya)

```css
:root {
  /* ---- Tipografi ---- */
  --font: var(--font-urbanist), "Urbanist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --fs-2xs: 11px;  --fs-xs: 12px;  --fs-sm: 12.5px; --fs-md: 13.5px;
  --fs-base: 14px; --fs-lg: 15px; --fs-xl: 17px;   --fs-2xl: 20px;
  --fs-3xl: 22px;  --fs-4xl: 26px; --fs-display: 34px;

  /* ---- Permukaan & kaca (glassmorphism) ---- */
  --bg: #ffffff;
  --mesh-a: #e8faf1;  --mesh-b: #edecf7;  --mesh-c: #ffffff;
  --glass:   #ffffff8f;   /* kaca 56% */
  --glass-2: #ffffffb3;   /* kaca 70% */
  --glass-3: #ffffffe0;   /* kaca 88% */
  --glass-nav: linear-gradient(135deg, #ffffffd1 0%, #ffffff94 46%, #ffffffb8 100%);
  --glass-nav-line: #ffffffd9;
  --glass-nav-shadow:
    0 18px 44px -22px #302e5947,
    0 2px 10px #302e5914,
    inset 0 1px 0 #fffffff2,
    inset 0 -1px 0 #302e590d;
  --glass-blur: blur(26px) saturate(190%);
  --rim: #fffc; /* garis tepi kaca */

  --surface: #f8f8f6;
  --surface-2: #ffffff94;
  --raised: #fcfcfb;
  --well: #302e590f;
  --line: #302e5917;
  --line-2: #302e5929;

  --shadow:      0 1px 0 #ffffffb3 inset, 0 24px 48px -30px #302e5938;
  --shadow-pop:  0 24px 60px -18px #302e5947, 0 2px 6px #302e5912;

  /* ---- Teks & warna dasar ---- */
  --text: #111;
  --muted: #5c5c5a;
  --faint: #73736f;
  --ink: #302e59;         /* navy brand (juga warna pill aktif) */
  --on-ink: #ffffff;

  /* ---- Brand / aksi ---- */
  --primary: var(--iris);      /* hijau mint */
  --on-primary: #111111;
  --primary-ink: #1d7a52;      /* teks hijau di atas latar terang */
  --accent: #51c590;
  --on-accent: #111111;
  --iris: #51c590;
  --dot: #302e59;

  /* ---- Chart ---- */
  --chart: var(--iris);
  --chart-2: var(--dot);
  --chart-soft: color-mix(in srgb, var(--iris) 15%, transparent);
  --chart-grid: color-mix(in srgb, var(--text) 9%, transparent);

  /* ---- Semantik ---- */
  --good: #237a48;  --warn: #8f6000;  --bad: #bf3644;
  --coral:#ff4d4d;  --amber:#a87406;  --teal:#2a7f4d;  --sky:#2d6cb0;
  --rose:#c43f4c;   --lime:#6f8f1c;   --slate:#637083; --plum:#8f6243;

  --soft: 14%; /* tingkat transparansi badge/tag */

  /* ---- Bentuk & jarak ---- */
  --r-card: 24px;
  --r-tile: 16px;
  --r-ctl: 999px;      /* kontrol selalu pill */
  --gap: 16px;
  --side-w: 264px;
  --side-x: 18px;
  --gutter: clamp(16px, 1.6vw, 28px);
  --phead-gap: 12px;   /* celah header melayang dari atas */
  --app-max: 1840px;
  --ease: cubic-bezier(.2, .8, .2, 1);

  color-scheme: light; /* aplikasi ini LIGHT-ONLY */
}
```

**Gradien pill aktif (nav/sidebar/segmen)** — dipakai berulang:
```css
background: linear-gradient(145deg, #3b3868 0%, #302e59 55%, #272547 100%);
box-shadow: 0 10px 22px -12px #302e5999, inset 0 1px 0 #ffffff2b, inset 0 -1px 0 #0000001f;
```

---

## 3. Bahasa visual singkat

- **Gaya:** clean, lembut, "floating glass" di atas latar putih dengan **mesh gradient** blur di belakang.
- **Latar:** `<div class="mesh">` fixed, 3 bulatan radial-gradient ber-blur 60px, `z-index:-1`, `pointer-events:none`. Bentuk latar mesh:
  ```css
  .mesh i { filter: blur(60px); opacity:.95; border-radius:50%; position:absolute; }
  .mesh__a { background: radial-gradient(closest-side, var(--mesh-a), transparent); width:62vmax; height:62vmax; top:-24vmax; left:-18vmax; }
  .mesh__b { background: radial-gradient(closest-side, var(--mesh-b), transparent); width:70vmax; height:70vmax; bottom:-30vmax; right:-24vmax; }
  .mesh__c { background: radial-gradient(closest-side, var(--mesh-c), transparent); width:46vmax; height:46vmax; top:-16vmax; right:8vmax; }
  ```
- **Semua permukaan besar** (sidebar, header, rail, kartu, KPI) memakai **kaca**: `--glass` atau `--glass-nav` + `--glass-blur` + `--glass-nav-shadow` + border `--rim`/`--glass-nav-line`.
- **Radius:** kartu besar 24px, tile 16px, kontrol (btn/input/chip/badge) selalu **pill 999px**.
- **Warna aksen dominan:** hijau mint `#51c590`. Navy `#302e59` untuk elemen "terpilih/dark".
- **Tidak ada dark mode.** Selalu terang.

---

## 4. Struktur layout

### 4.1 Kerangka aplikasi
```
<AppFrame>                      ← layout persisten (client), TIDAK remount saat navigasi
├── .mesh                       ← latar dekoratif
├── <header class="mobilebar">  ← hanya tampil ≤1099px
├── <div class="sidebar__scrim"> (hanya saat drawer terbuka)
├── <aside class="sidebar">     ← fixed, glass, radius 24px
├── <div class="app">           ← max-width 1840px, padding kiri = lebar sidebar
│   └── <main class="main">
│       ├── <PageHeader>        ← .phead, glass, sticky, PERSISTEN
│       ├── <SettingsRail>      ← hanya di /settings
│       └── {children}          ← <div class="view page-enter">
└── <CommandPalette>            ← overlay, saat dibuka
```

```css
.app {
  max-width: var(--app-max);
  padding: 20px var(--gutter) 56px calc(var(--side-x) + var(--side-w) + var(--gutter));
  margin: 0 auto;
  overflow-x: clip;
}
.main, .view { min-width: 0; position: relative; }
```

### 4.2 Header persisten (kunci UX "seperti sidebar")
- Header **dirender sekali oleh layout**, bukan per halaman → saat navigasi, elemen `<header>` **tidak ter-mount ulang**; hanya isinya (breadcrumb, judul, aksi) yang diperbarui.
- Implementasi: `HeaderContext` + `useSetHeader(spec)` di layout effect; halaman hanya mengirim `{ title, crumbs, actions }`.
- Saat spec belum ada (SSR/first paint) tampilkan **skeleton** (`.skel--crumbs`, `.skel--title`), lalu isi aslinya di-render sebelum paint (pakai `useLayoutEffect`, bukan `useEffect`) supaya tidak ada flash.
- Lihat §7 untuk CSS `.phead` lengkap.

### 4.3 Sidebar
```css
.sidebar {
  position: fixed;
  top: var(--side-x); bottom: var(--side-x);
  left: max(var(--side-x), calc((100vw - var(--app-max)) / 2 + var(--side-x)));
  width: var(--side-w);
  display: flex; flex-direction: column;
  color: var(--ink);
  border: 1px solid var(--glass-nav-line);
  border-radius: 24px;
  background:
    radial-gradient(130% 100% at 18% 0%, #51c59024, transparent 58%),
    radial-gradient(130% 100% at 82% 100%, #302e591c, transparent 62%),
    var(--glass-nav);
  box-shadow: var(--glass-nav-shadow);
  backdrop-filter: var(--glass-blur);
  overflow: hidden;
  z-index: 50;
}
```
Isi sidebar (atas→bawah): brand logo → tombol "Cari apa saja (Ctrl K)" → nav menu utama → "Tambah data" (accordion) → nav "Lainnya" → kartu user + tombol Keluar.

**Item nav aktif** memakai pill navy melayang:
```css
.sidenav__item { position: relative; isolation: isolate; display:flex; align-items:center; gap:10px;
  padding:7px 10px 7px 7px; border-radius:14px; font-size:var(--fs-md); font-weight:600;
  transition: background .15s var(--ease), color .15s var(--ease); }
.sidenav__item:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
.sidenav__item[aria-current=page] { color: var(--on-ink); }
.sidenav__pill { position:absolute; inset:0; z-index:0; pointer-events:none; border-radius:14px;
  background: linear-gradient(145deg,#3b3868 0%,#302e59 55%,#272547 100%);
  box-shadow: 0 10px 22px -12px #302e5999, inset 0 1px 0 #ffffff2b, inset 0 -1px 0 #0000001f; }
.sidenav__ico, .sidenav__text, .sidenav__dot { position: relative; z-index: 1; }
.sidenav__ico { width:34px; height:34px; display:grid; place-items:center;
  border:1px solid var(--rim); border-radius:10px; background: var(--glass-2); }
```
Pill dipindah antar item dengan framer-motion `layoutId` (lihat §6).

---

## 5. Komponen — spesifikasi

### 5.1 Tombol
```css
.btn { height:42px; font-weight:600; font-size:var(--fs-md); white-space:nowrap;
  border:1px solid transparent; border-radius:999px; display:inline-flex; align-items:center;
  justify-content:center; gap:8px; padding:0 18px; transition: filter .15s, background .15s; }
.btn--primary { background: var(--primary); color: var(--on-primary); }   /* hover: filter:brightness(1.18) */
.btn--ghost   { border-color: var(--line-2); background: var(--glass); }   /* hover: background:var(--glass-2) */
.btn--soft    { background: color-mix(in srgb, var(--iris) var(--soft), transparent); color: var(--primary-ink); }
.btn--danger  { background: var(--bad); color:#fff; }
.btn--sm { height:36px; font-size:var(--fs-sm); padding:0 14px; }
.btn--xs { height:30px; font-size:var(--fs-xs); gap:6px; padding:0 11px; }
.btn:disabled { opacity:.45; cursor:not-allowed; }
```

### 5.2 Kartu, KPI/stat
```css
.card { border-radius:var(--r-card); background:var(--glass); border:1px solid var(--rim);
  box-shadow:var(--shadow); padding:18px; position:relative; }
.card__head { display:flex; justify-content:space-between; align-items:center; gap:12px;
  min-height:40px; margin-bottom:14px; }
.card__title { display:flex; align-items:center; gap:10px; font-size:var(--fs-lg); font-weight:600; }
.card__title > .ico { width:34px; height:34px; padding:8px; border-radius:50%;
  background:var(--glass-2); border:1px solid var(--rim); }

.kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px,1fr));
  gap:var(--gap); margin-bottom:var(--gap); }
.stat { border-radius:var(--r-card); background:var(--glass); border:1px solid var(--rim);
  box-shadow:var(--shadow); padding:16px 18px; display:grid; gap:8px; align-content:start; }
.stat__value { font-size:var(--fs-3xl); font-weight:600; letter-spacing:-.01em; }
.stat--dark   { background:var(--ink);    color:var(--on-ink);    border-color:transparent; }
.stat--accent { background:var(--accent); color:var(--on-accent); border-color:transparent; }
```

### 5.3 Badge / tag / spill (indikator status)
```css
.badge { font-size:var(--fs-2xs); border-radius:999px; display:inline-flex; align-items:center;
  gap:4px; padding:3px 9px; font-weight:700; }
.badge--good { background: color-mix(in srgb, var(--good) var(--soft), transparent); color: var(--good); }
.badge--warn { background: color-mix(in srgb, var(--amber) 20%, transparent);            color: var(--warn); }
.badge--bad  { background: color-mix(in srgb, var(--rose) var(--soft), transparent);     color: var(--bad); }

.spill { --c: var(--faint); display:inline-flex; align-items:center; gap:6px; padding:3px 10px 3px 8px;
  font-size:var(--fs-xs); font-weight:700; border-radius:999px;
  background: color-mix(in srgb, var(--c) var(--soft), transparent);
  color: color-mix(in srgb, var(--c) 62%, var(--text)); }
.spill i { width:7px; height:7px; border-radius:50%; background:var(--c); }
/* varian: .spill--iris / --coral / --amber / --teal / --sky / --rose → hanya set --c */
```

### 5.4 Input & pencarian
```css
.input, .search { height:42px; border:1px solid var(--line-2); background:var(--glass-2);
  border-radius:999px; padding:0 16px; outline:none; }
.input:focus, .search:focus-within { border-color: var(--text); }
.search { display:inline-flex; align-items:center; gap:8px; color:var(--muted); }
textarea.input { border-radius:16px; height:auto; padding:10px 16px; resize:vertical; }
/* field form */
.field { display:grid; gap:6px; }
.field input:focus { border-color:var(--primary); box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 16%,transparent); }
```

### 5.5 Chip / segmen
```css
.chip { height:34px; border-radius:999px; border:1px solid var(--line); background:var(--glass-2);
  display:inline-flex; align-items:center; gap:6px; padding:0 13px; font-weight:600; font-size:var(--fs-sm); }
.chip[aria-pressed=true] { background: var(--ink); color: var(--on-ink); border-color: transparent; }
```

### 5.6 Tabel
```css
.table { width:100%; border-collapse:separate; border-spacing:0; font-size:var(--fs-md); }
.table th { font-size:var(--fs-xs); text-transform:uppercase; letter-spacing:.04em; font-weight:700;
  color:var(--muted); background:var(--surface-2); border-bottom:1px solid var(--line); padding:10px 12px; }
.table th:first-child { border-top-left-radius:10px; } .table th:last-child { border-top-right-radius:10px; }
.table td { padding:11px 12px; border-bottom:1px solid var(--line); vertical-align:middle; }
.table tbody tr { transition: background-color .15s; }
.table tbody tr:hover { background: color-mix(in srgb, var(--iris) 5%, transparent); }
.table-wrap { overflow-x:auto; margin:0 -6px; }
```

### 5.7 Avatar
```css
.av { border-radius:50%; display:inline-grid; place-items:center; font-weight:600;
  color:#142123; background:var(--well); user-select:none; letter-spacing:.02em; }
.av--xs{24px;--fs-2xs} .av--sm{32px} .av--md{40px} .av--lg{52px} .av--xl{88px}
/* warna latar: .av--sky #cadcf1  --teal #cbe8d4  --coral #f7cdb9  --amber #f3dfa6
                 --rose #f4cbd0 --plum #e9d6c8  --iris  #c6e3e0 */
```

### 5.8 Modal / sheet
```css
.overlay { position:fixed; inset:0; display:grid; place-items:center; padding:16px;
  background:#0e1a1c4d; backdrop-filter:blur(6px); z-index:80; }
.sheet { width:min(520px,100%); max-height:90dvh; overflow:auto; border-radius:26px;
  background:var(--raised); border:1px solid var(--line); box-shadow:var(--shadow-pop); }
.sheet__head { padding:22px 22px 0; } .sheet__body { padding:18px 22px; display:grid; gap:14px; }
.sheet__foot { padding:0 22px 22px; display:flex; justify-content:flex-end; gap:10px; }
```

### 5.9 Command palette (Ctrl/Cmd + K)
- Overlay gelap + blur, panel `border-radius:20px`, lebar maks 620px, muncul dari atas (`padding-top:12vh`).
- Input pencarian fokus otomatis, hasil dikelompokkan (`.cmdk__group`), navigasi **panah atas/bawah + Enter**, item aktif punya latar `--well`. Tutup dengan `Esc`.
- Animasi: lihat §6.4.

---

## 6. Animasi & motion — spesifikasi lengkap

### 6.1 Aturan umum
- Durasi mikro (hover/focus): **120–180ms**, easing `var(--ease)`.
- Durasi masuk elemen: **180–300ms**.
- Semua animasi **transform + opacity** saja (kecuali framer-motion `layout`).
- Wajib ada guard `@media (prefers-reduced-motion: reduce)` yang mematikan animasi.

### 6.2 Transisi halaman (CSS)
```css
.page-enter { animation: pageEnter .22s cubic-bezier(.22,1,.36,1) both; }
/* .view HANYA dianimasikan opacity — transform pada .view akan mengurung
   position:fixed (mis. modal) di dalam area konten, bukan viewport. */
.view.page-enter { animation: pageFade .22s cubic-bezier(.22,1,.36,1) .035s both; }

@keyframes pageEnter { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform:none; } }
@keyframes pageFade  { from { opacity:0; } to { opacity:1; } }
```

### 6.3 Pill navigasi (framer-motion, `layoutId`)
Pill navy "dipindah" dari item lama ke item baru dengan spring. Nilai spring resmi:

| Konteks | Spring |
|---|---|
| Sidebar / rail pengaturan | `{ type:'spring', stiffness:380, damping:32, mass:0.7 }` |
| Tab settings & view toggle | `{ type:'spring', stiffness:520, damping:40, mass:0.6 }` |
| Toggle laporan | `{ type:'spring', stiffness:380, damping:32, mass:0.7 }` |
| View toggle siswa | `{ type:'spring', stiffness:500, damping:35, mass:0.6 }` |

```tsx
<LayoutGroup id="app-nav">
  <Link href={...} className="sidenav__item" aria-current={active ? 'page' : undefined}>
    {active && <motion.span layoutId="app-nav-pill" className="sidenav__pill"
                            transition={pillSpring} initial={false} />}
    ...
  </Link>
</LayoutGroup>
```
Aturan: `initial={false}` supaya pill tidak "terbang" saat pertama render; tiap grup punya `id` & `layoutId` unik.

### 6.4 Command palette (enter/exit)
```tsx
<motion.div className="cmdk" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            transition={{duration:0.16}} onClick={onClose}>
  <motion.div className="cmdk__panel"
    initial={{opacity:0, y:-10, scale:0.985}}
    animate={{opacity:1, y:0,  scale:1}}
    exit  ={{opacity:0, y:-10, scale:0.985}}
    transition={{duration:0.18, ease:[0.2,0.8,0.2,1]}} />
</motion.div>
```

### 6.5 Accordion "Tambah data" (sidebar)
```tsx
<AnimatePresence initial={false}>
  {addOpen && (
    <motion.div className="sideadd__menu"
      initial={{height:0, opacity:0}} animate={{height:'auto', opacity:1}}
      exit={{height:0, opacity:0}} transition={{duration:0.18, ease:'easeOut'}} />
  )}
</AnimatePresence>
```
Chevron berputar: `.sideadd__toggle.is-open .sideadd__chev { transform: rotate(180deg); }` (180ms).

### 6.6 Toast
```tsx
<AnimatePresence mode="popLayout">
  <motion.div layout key={t.id}
    initial={{opacity:0, y:30, scale:0.95}}
    animate={{opacity:1, y:0,  scale:1}}
    exit={{opacity:0, y:15, scale:0.92, transition:{duration:0.2}}}
    transition={{type:'spring', stiffness:450, damping:32}} />
</AnimatePresence>
```
Posisi: `fixed bottom-5 right-5`, `z-[9999]`, `aria-live="polite"`. Auto-dismiss memakai timer; sisa waktu jalan lagi saat hover (opsional).

### 6.7 Angka CountUp
- Angka berhitung dari nilai lama → nilai baru saat masuk viewport (**IntersectionObserver threshold 0.2**), durasi default **900ms**, easing **ease-out cubic** `1 - (1-t)^3`, digerakkan `requestAnimationFrame`.
- Format `id-ID` (`toLocaleString('id-ID')`).
- Guard reduced-motion → langsung set nilai akhir.

### 6.8 Animasi dekoratif (CSS keyframes)
| Efek | Keyframes | Durasi / easing |
|---|---|---|
| Garis sparkline tergambar | `dash-draw` (`stroke-dashoffset:1→0`) | 1.1s `cubic-bezier(.22,1,.36,1)` delay .1s, `forwards` |
| Bar funnel tumbuh | `dash-grow` (`scaleX(0→1)`, `transform-origin:left`) | .8s `var(--ease)` |
| Reveal area/line chart | `chartRevealClip` (`clip-path: inset(0 100% 0 0 → 0 0)`) | 1.15s `cubic-bezier(0.16,1,0.3,1)` |
| Laporan: garis/area/bar | `rpt-draw`, `rpt-fade`, `rpt-pop`, `rpt-grow` | 0.6–1s |
| Toast/skeleton sweep | `skelSweep` (`translateX(-100%)→100%`) | 1.2s `ease-in-out infinite` |
| Spinner | `spin` | 1s `linear infinite` |
| Sheet masuk (mobile) | `sheetUp` (translateY(16px)+opacity .5 → 0/1) | .3s `cubic-bezier(.22,1,.36,1)` |

> Catatan penting: **jangan** pakai CSS `transition` pada `width/height/top/left` untuk animasi posisi. Untuk accordion pakai framer-motion `height:'auto'` (sudah di §6.5).

### 6.9 Ringkasan guard reduced-motion
```css
@media (prefers-reduced-motion: reduce) {
  .page-enter, .skel::after { animation: none; }
  .dash-spark__line { animation: none; stroke-dashoffset: 0; }
  .dash-funnel__bar i { animation: none; }
  .rpt__line, .rpt__area, .rpt__pt, .rpt__bfill, .rpt__lfill, .rpt__sfill { animation: none; }
  .rpt__line { stroke-dashoffset: 0; }  .rpt__area, .rpt__pt { opacity: 1; }
}
```
Untuk framer-motion, cek `useReducedMotion()` dan matikan transform bila aktif.

---

## 7. Header persisten + sticky (CSS final)

```css
.phead {
  position: sticky;
  top: calc(var(--phead-top, 0px) + var(--phead-gap, 12px));
  z-index: 30;
  display: flex; flex-wrap: wrap; align-items: center; gap: 14px 28px;
  margin-bottom: var(--gap); padding: 14px 18px;
  border: 1px solid var(--glass-nav-line);
  border-radius: 22px;
  background:
    radial-gradient(130% 100% at 18% 0%, #51c59024, transparent 58%),
    radial-gradient(130% 100% at 82% 100%, #302e591c, transparent 62%),
    var(--glass-nav);
  box-shadow: var(--glass-nav-shadow);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
}
.phead__lead { min-width: 0; }
.phead__actions { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.phead__tools  { flex: none; display: flex; align-items: center; gap: 8px; }
.top__title { font-size: clamp(28px,2.6vw,38px); font-weight:600; letter-spacing:-.025em;
  line-height:1.04; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.crumbs { display:flex; align-items:center; gap:6px; margin-bottom:6px;
  font-size:var(--fs-sm); font-weight:600; color:var(--muted); }
.crumbs [aria-current] { color: var(--primary-ink); }
```

**Tinggi header diukur runtime** lewat `ResizeObserver` → dipublikasikan sebagai `--phead-h` di `:root`. Semua elemen sticky di dalam halaman (rail pengaturan, panel filter) berhenti di bawah header:
```css
top: calc(var(--phead-top,0px) + var(--phead-gap,12px) + var(--phead-h,0px) + 12px);
```

**Perilaku mobile (≤760px):** header **tidak sticky**, ikut tergulung; yang tetap melayang hanya lonceng.
```css
@media (width <= 760px) {
  .phead { position: static; backdrop-filter: none; background: var(--raised);
           gap: 12px 14px; }
  .phead__lead    { order: 1; flex: 1 1 auto; }
  .phead__actions { order: 3; width: 100%; margin-left: 0; } /* tombol aksi selebar baris */
  .phead__tools   { position: fixed; z-index: 31;
                    top: calc(62px + env(safe-area-inset-top) + 12px);
                    right: calc(var(--gutter) + 4px); }   /* lonceng selalu terlihat */
  .phead__tools .notif__btn { background: var(--glass-3); box-shadow: var(--shadow);
                              backdrop-filter: var(--glass-blur); }
  .top__title { font-size: var(--fs-4xl); }
}
```
> Trik: `.phead` di mobile jadi `position: static` agar `.phead__tools { position: fixed }` lepas dari containing block header dan benar-benar menempel di viewport.

---

## 8. Logika UX penting (jangan dilewatkan)

1. **Header tidak remount saat navigasi.** Render di layout, isi via context + `useLayoutEffect`. Jangan `useEffect` (menyebabkan flash judul kosong).
2. **Lonceng notifikasi** — saat panel terbuka:
   - Tutup saat klik di luar / `Esc` / scroll **halaman**. Tapi **scroll di dalam daftar notifikasi TIDAK menutup** panel. Implementasi: pada listener `scroll` capture, abaikan bila `e.target` ada di dalam panel.
   - Panel dirender lewat **portal ke `document.body`**, `position:fixed`, `z-index:95` (agar tidak terpotong `overflow` sidebar).
3. **Drawer sidebar (mobile):** buka → `body { overflow: hidden }`, scrim blur 3px, `Esc` menutup, resize >1099px menutup otomatis. Animasi: `transform: translateX(-102%) → none` **.28s var(--ease)** + `visibility` ditunda agar tidak "kelihatan" saat tertutup.
4. **Ctrl/Cmd + K** membuka command palette dari mana saja (listener global di layout). Palette menutup drawer dulu.
5. **Students (contoh perilaku responsif):** toggle grid/list **disembunyikan di ≤760px** dan tampilan dipaksa **grid**. Deteksi lewat `matchMedia('(min-width:761px)')`. Kunci: `serverDefault = true` agar render server & klien pertama sama → tidak ada flash.
6. **Reset form** saat data server berubah dipakai `key` React; beri **awalan unik** tiap form (`company:` / `personal:`) supaya tidak pernah bentrok walau nilainya kebetulan sama.
7. **Fokus & keyboard:** semua kontrol interaktif mencapai target ≥40px, `:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }`, ikon tanpa teks wajib `aria-label`.

---

## 9. Responsif — breakpoint resmi

| Breakpoint | Perubahan |
|---|---|
| **>1280px** | Rail pengaturan tampil (grid `232px + 1fr`). |
| **≤1180px** | Panel laporan jadi statis; `.page-skeleton__cards` jadi 1 kolom. |
| **≤1099px** | Sidebar → **drawer** + `.mobilebar` muncul; `--phead-top: calc(62px + safe-area-inset-top)`; `.app` padding atas ditambah tinggi bar. |
| **≤760px** | **Mobile utama.** `.gutter:14px`; header non-sticky (lonceng fixed); KPI 2 kolom; kartu radius 20px; semua toggle segmen disembunyikan; font input `16px` (anti-zoom iOS); tombol aksi header & toolbar selebar baris. |
| **≤480px** | KPI rapat; `.kv` 1 kolom; sheet padding lebih kecil. |
| **print** | Sembunyikan app, hanya cetak `.print-sheet`; `@page margin 14mm`. |

**Teknik verifikasi tanpa device emulator:** bungkus halaman di `<iframe width="390">` atau `width="1000"` di dalam halaman lokal. Media query **dievaluasi terhadap lebar iframe**, jadi cukup untuk menguji breakpoint.

---

## 10. Checklist searah (definition of done)

- [ ] Semua token §2 terpasang; tidak ada hex/ukuran hardcode di komponen.
- [ ] Latar mesh 3 bulatan blur tampil di belakang seluruh halaman.
- [ ] Sidebar & header = kartu glass radius 22–24px dengan shadow glass yang sama.
- [ ] Header **tidak remount** saat pindah halaman (isi berubah, elemen DOM tetap).
- [ ] Mobile ≤760px: header tergulung, **hanya lonceng** yang fixed di kanan atas.
- [ ] Panel notifikasi bisa **di-scroll** tanpa tertutup; klik luar / Esc / scroll halaman menutupnya.
- [ ] Pill navigasi dianimasikan dengan spring yang tepat; `initial={false}`.
- [ ] Transisi halaman 220ms; `.view` hanya animasi opacity.
- [ ] Angka KPI berhitung (CountUp) saat masuk viewport.
- [ ] Semua animasi mati pada `prefers-reduced-motion: reduce`.
- [ ] Breakpoint 1280 / 1180 / 1099 / 760 / 480 sesuai tabel §9.
- [ ] Ikon tanpa teks punya `aria-label`; navigasi aktif `aria-current="page"`.
- [ ] Light-only. Tidak ada dark mode.

---

## 11. Larangan (jangan dilakukan)

- ❌ Menambah UI kit / theme library (MUI, shadcn, Chakra, dsb.).
- ❌ Animasi `width/height/top/left` via CSS transition (kecuali framer-motion `layout`).
- ❌ Menggunakan `transform` pada wrapper `.view` (mengurung elemen `fixed`).
- ❌ `useEffect` untuk mengisi header (pakai `useLayoutEffect`).
- ❌ Key React dari dua sumber data berbeda tanpa prefiks unik.
- ❌ Warna aksen selain mint `#51c590` untuk primary.
- ❌ Mengubah nilai token hanya karena "kelihatan lebih pas" — harus identik.
