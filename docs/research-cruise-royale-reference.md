# Referensi publik Cruise Royale

Sumber: https://slotcatalog.com/en/slots/Cruise-Royale

Halaman publik tersebut mendeskripsikan Cruise Royale sebagai game PG Soft dengan grid 6x4, top horizontal reel, collapsing wins, traveling wild, free spins, multiplier, dan demo embed. Metadata publik yang relevan untuk desain test harness adalah adanya kemungkinan dynamic asset loading, demo iframe/embed, urutan gameplay spin/cascade/free-spin, dan dependency provider/operator pada mode demo.

Sistem Game Collector tidak menyalin game, asset, atau implementasi proprietary dari halaman ini. Referensi dipakai untuk memperkuat detektor terhadap:

- iframe/demo embed dan postMessage dependency;
- asset CDN bertanda tangan dan lazy-loaded image/audio/font;
- API session/init/balance/spin/result/history;
- WebSocket/SSE/polling serta reconnect/order-of-events;
- state machine cascade, traveling wild, free-spin, multiplier, dan bonus;
- DRM/license, CAPTCHA/anti-bot, authentication, signed URL, dan server-side RNG;
- quality gate yang menolak FULL_OFFLINE_READY jika bukti contract, replay, realtime, dan browser network-off belum lengkap.

Batas penggunaan: pengujian hanya pada game, demo, endpoint, dan artifact yang dimiliki atau telah mendapat izin tertulis. Sistem tidak melakukan bypass DRM, CAPTCHA, anti-bot, login, token, signature, paywall, atau kontrol akses provider.
