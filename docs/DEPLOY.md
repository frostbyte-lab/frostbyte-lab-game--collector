# Deploy Checklist — Game Collector Pro

Live contoh: `https://game-resource-collector.technologiesfrostbyte.workers.dev`

## 1. Prasyarat

- [ ] Node.js 20+
- [ ] Akun Cloudflare + Workers enabled
- [ ] `npx wrangler login` (atau `CLOUDFLARE_API_TOKEN` di CI)
- [ ] Repo ini sudah di-clone; dependency terpasang:

```bash
cd frostbyte-lab-game--collector
npm install
```

## 2. Binding & secrets (Cloudflare)

Di [Workers dashboard](https://dash.cloudflare.com) → Worker `game-resource-collector` **atau** via `wrangler.jsonc`:

| Binding / secret | Wajib? | Fungsi |
|------------------|--------|--------|
| `MYBROWSER` (Browser Rendering) | Ya (collect CF) | Playwright di Worker |
| `AI` | Opsional | Workers AI (Analyze bawaan) |
| `GC_HISTORY` (KV) | Direkomendasikan | Progress, history, resume |
| `GITHUB_TOKEN` | Untuk GitHub collect / EDU | `repo` + `workflow` |
| `COLLECTOR_BUCKET` (R2) | **Tidak** (sengaja opsional) | ZIP besar |

Secrets:

```bash
npx wrangler secret put GITHUB_TOKEN
# tempel PAT GitHub (jangan commit)
```

Cek vars di `wrangler.jsonc`: `GH_OWNER`, `GH_REPO`, `GH_WORKFLOW`, `EDU_*`.

## 3. Deploy

```bash
npm run deploy
# = wrangler deploy
```

Setelah sukses:

- [ ] Buka `https://<worker>.workers.dev/api/health`
- [ ] Pastikan JSON: `ok: true`, `assetProxy: true`
- [ ] Hard-refresh UI (Ctrl+Shift+R / clear site data jika SW lama)

## 4. GitHub Actions (collect besar)

- [ ] Workflow `.github/workflows/collect.yml` aktif
- [ ] Secret repo: token yang sama / `GITHUB_TOKEN` default Actions
- [ ] Dari UI: **Collect via GitHub** → status di web (tanpa buka tab Actions)

## 5. Smoke test pasca-deploy

1. **Collect** URL game kecil → ZIP unduh  
2. **Workspace** Load ZIP → buka `index.html`  
3. **Sandbox** → log `READY` / `PARTIAL` (bukan blank)  
4. **Custom AI** → isi key Gemini → Analyze 1 file  
5. **Hybrid** (opsional) → asset CDN lewat `/api/asset-proxy`  
6. Health: `GET /api/asset-proxy?url=https://www.cloudflare.com/favicon.ico` → 200 image  

## 6. Rollback cepat

```bash
npx wrangler deployments list
npx wrangler rollback
```

Atau redeploy commit sebelumnya di `main`.

## 7. Custom domain (opsional — belum di backlog inti)

Lihat `docs/CUSTOM_DOMAIN_AND_AUTO_DETECT.md`.  
Setelah domain: update `EDU_PAGES_URL` / URL di Capacitor bila dipakai.

## 8. Keamanan

- [ ] Jangan commit PAT / API key  
- [ ] Revoke token yang pernah terlanjur di chat  
- [ ] Collect hanya game berizin  

## Perintah ringkas

```bash
npm install
npx wrangler secret put GITHUB_TOKEN
npm run deploy
curl -s https://<worker>.workers.dev/api/health | head
```
