# Custom Domain + Auto-Detect (Sistem Baru)

Tanggal: 2026-08-22

## 1. Portable config (tanpa hardcode owner/repo)

`wrangler.jsonc` → `vars`:

```jsonc
"vars": {
  "GH_OWNER": "frostbyte-lab",
  "GH_REPO": "frostbyte-lab-game--collector",
  "GH_WORKFLOW": "collect.yml",
  "PUBLIC_APP_NAME": "Game Collector Pro"
}
```

Worker memakai `ghConfig(env)` — ganti org/repo hanya lewat vars, tidak perlu edit `src/index.js`.

## 2. Custom domain (Cloudflare Dashboard)

1. Workers → deploy
2. Settings → Domains & Routes → Add Custom Domain
3. DNS CNAME (otomatis jika domain di CF)
4. KV: namespace baru → isi `id` di `wrangler.jsonc` → redeploy
5. Secrets: `wrangler secret put GITHUB_TOKEN`
6. Browser Rendering aktif di akun

Frontend memakai relative `/api/...` → ikut domain baru otomatis.

## 3. Auto-detect + Auto Spin / History

Modul baru:

- `scripts/auto-interact.js` — deteksi ketat Play / Spin / History
- `scripts/zip-aware-detect.js` — profil dari SEED_ZIP + halaman live

Workflow inputs:

| Input | Default | Ket |
|-------|---------|-----|
| `auto_spins` | 3 | Jumlah spin setelah Play |
| `auto_history` | 1 | Buka history sekali |
| `spin_delay_ms` | 2200 | Delay settle animasi/network |
| `seed_zip` | (kosong) | Path ZIP seed di repo |

Env di step Capture: `AUTO_SPINS`, `AUTO_HISTORY`, `SPIN_DELAY_MS`, `SEED_ZIP`.

Response kritis (spin/balance/history) di-tag di log `PROGRESS: critical_api` dan file `assets/data/{kind}-*.json`. Output `api-map.json` di dalam ZIP.

## 4. Checklist domain/server baru

- [ ] Fork/clone, sesuaikan `vars` GH_*
- [ ] KV id akun baru di wrangler
- [ ] `npx wrangler deploy`
- [ ] Custom domain di Dashboard
- [ ] Uji `/api/health`
- [ ] Uji collect kecil + GitHub Actions (`auto_spins=2`)
- [ ] Pastikan log `profile_spin_kw` / `critical_api` muncul

## 5. Risiko

- Spin/result tidak ada di ZIP jika tidak pernah di-trigger
- Canvas-only: fallback koordinat bisa meleset
- Browser Rendering quota
- ZIP besar → andalkan GitHub Actions artifact
