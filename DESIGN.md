# DESIGN.md — Antigravity Midnight Glass

## 1. Visual System & Grounded Tokens
Inspired by DSH NEXT's Midnight Frosted Dream Skin (`midnight` + `frosted`), tuned specifically for Antigravity 2.34+ surfaces:

- **Canvas & Backdrop:** `#0b0e17` midnight base beneath a pre-baked blurred WebP wallpaper (`blur(8px) brightness(0.62) contrast(1.06) saturate(1.16)`, `opacity: 0.82`) — zero live CSS GPU blur pass per frame.
- **Surface Hierarchy (strict opacity ladder):**
  - Conversation canvas: `rgba(11, 14, 23, 0.14)` (edge-to-edge, no inner inset border)
  - Top titlebar & menu bar: `rgba(11, 14, 23, 0.16)` + `blur(12px)`, paired with transparent Windows caption overlay (`#00000000`)
  - Composer card: `rgba(14, 16, 24, 0.36)` + `blur(14px)`, hairline `rgba(255, 255, 255, 0.11)` border, `18px` radius
  - User message bubbles: `rgba(18, 22, 34, 0.40)` + `blur(14px)`, single crisp hairline border
  - Sidebar body: `rgba(12, 16, 26, 0.56)` + `blur(18px)`
  - Code blocks & terminal cards: `rgba(10, 12, 19, 0.72)` + `blur(14px)`, `12px` radius
  - **Floating Overlays (Model Picker, Popovers, Menus, Dialogs, Telemetry Card):** `rgba(13, 17, 28, 0.92)` + `blur(28px) saturate(150%)`, `1px solid rgba(255, 255, 255, 0.12)`, deep shadow `0 18px 48px rgba(0, 0, 0, 0.62)` — zero background text bleed-through.
  - **Sticky Sidebar Section Headers (`Projects`, etc.):** `rgba(11, 15, 25, 0.94)` + `blur(24px)` with hairline bottom edge — cleanly occludes scrolled project items with zero double-text overlap.
- **Typography Pair:**
  - UI & Prose: `"Inter Variable"` (embedded `.woff2` Latin + Latin-Ext + Vietnamese), `14px` / `1.65` prose, `600` weight white headings (`-0.02em`), OpenType `cv02`/`cv03`/`cv04`/`cv11`.
  - Code & Mono: `"JetBrainsMono NF"`, `"MapleMono NF"`, `ui-monospace`, `0.875em` inline code pills.
- **Accent & Semantic Status:**
  - Primary Accent: `#4f83f2` (soft slate-blue send button `rgba(88, 126, 196, 0.66)`)
  - Good / Cache / Compacted: `#34d399`
  - Warning (75–89% ctx / retrying): `#fbbf24`
  - Critical (>=90% ctx / error): `#f87171`

## 2. Architecture & Performance Invariants
1. **2-Tier CDP Injection:** Static assets (`#ag-mg-assets`: `Inter Variable` woff2 + pre-baked WebP wallpaper) are injected **once per document** guarded by SHA-256 hash (`window.__ag_mg_assets_hash`). Hot-reloaded theme CSS + runtime stay `< 25 KB`.
2. **Zero Runtime Wallpaper Blur:** Wallpaper blur and color grading are pre-baked into `assets/wallpaper-baked.webp` (~12 KB), cutting transfer size by >90% and removing per-frame GPU blur compositing.
3. **Event-Driven Daemon:** `fs.watch` on `user/` and `DevToolsActivePort` replaces heavy stat polling; all WebSocket sends and async cycles are error-guarded.
4. **Windows-First Autostart:** User-scoped `Register-ScheduledTask -AtLogOn -User` runs without UAC and launches outside Antigravity's `KILL_ON_JOB_CLOSE` Job Object.

## 3. Six Edge States Covered
1. **Empty:** New/empty conversation shows clean `Ready` status with zero `NaN` or broken counters.
2. **Loading / Streaming:** Pulsing status dot + live step/token updates without layout jitter (`tabular-nums`).
3. **Overflow & Density:** Narrow panes (Side Question / half-screen) wrap/ellipsis cleanly; sticky sidebar headers occlude 100+ scrolling project rows cleanly.
4. **Error / Offline:** Transient SQLite locks or CDP disconnects never crash the daemon; retry/error chips surface cleanly in the popover.
5. **Keyboard & Focus:** `Escape` closes pinned telemetry popovers; `:focus-visible` outlines remain intact; icon buttons keep `aria-label`/`title`.
6. **Contrast:** `>= 4.5:1` prose (`#E8EBF2` on midnight backdrop), crisp `#FFFFFF` headings, high-opacity (`0.92`) frosted popovers and model picker menus.
