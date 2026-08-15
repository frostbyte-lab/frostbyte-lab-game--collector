export function classifyApiSemantics(url, type, contentType, bodyText) {
  const out = {
    kind: "unknown",
    confidence: "low",
    fields: {},
    topKeys: [],
    signals: []
  };

  let pathname = "";
  let search = "";
  try {
    const u = new URL(url);
    pathname = u.pathname.toLowerCase();
    search = u.search.toLowerCase();
  } catch {
    pathname = String(url || "").toLowerCase();
  }

  const pathBag = pathname + " " + search;

  // Path-based kind
  if (/launch|initgame|init[_-]?game|gamedata|game[_-]?info|config/i.test(pathBag)) {
    out.kind = "launch";
    out.signals.push("path-launch");
  }
  if (/auth|login|oauth|token|signin|sign-in/i.test(pathBag)) {
    out.kind = "auth";
    out.signals.push("path-auth");
  }
  if (/session|reconnect|heartbeat|keep[_-]?alive/i.test(pathBag)) {
    out.kind = "session";
    out.signals.push("path-session");
  }
  if (/balance|wallet|credit|cashier|funds/i.test(pathBag)) {
    out.kind = "balance";
    out.signals.push("path-balance");
  }
  if (/spin|play|bet|wager|do[_-]?spin|start[_-]?spin|action=spin/i.test(pathBag)) {
    out.kind = "spin-request";
    out.signals.push("path-spin");
  }
  if (/result|outcome|round|settle|win/i.test(pathBag) && out.kind === "unknown") {
    out.kind = "spin-result";
    out.signals.push("path-result");
  }
  if (/error|fail|status/i.test(pathBag) && out.kind === "unknown") {
    out.kind = "error-or-status";
    out.signals.push("path-error");
  }

  // Body JSON
  let json = null;
  const sample = (bodyText || "").trim();
  if (sample.startsWith("{") || sample.startsWith("[")) {
    try {
      json = JSON.parse(sample.length > 200000 ? sample.slice(0, 200000) : sample);
    } catch {}
  }

  if (json && typeof json === "object") {
    const keys = Array.isArray(json) ? [] : Object.keys(json);
    out.topKeys = keys.slice(0, 30);
    const flat = {};

    function collect(obj, prefix, depth) {
      if (!obj || typeof obj !== "object" || depth > 4) return;
      if (Array.isArray(obj)) {
        if (obj.length && typeof obj[0] !== "object") {
          flat[prefix || "array"] = obj.slice(0, 20);
        } else if (obj.length && Array.isArray(obj[0])) {
          // possible reel matrix
          flat[prefix || "matrix"] = obj.slice(0, 8).map(row =>
            Array.isArray(row) ? row.slice(0, 10) : row
          );
        }
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        const lk = k.toLowerCase();
        const p = prefix ? prefix + "." + k : k;
        if (v !== null && typeof v === "object") {
          collect(v, p, depth + 1);
        } else if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
          flat[p] = v;
        }

        // Semantic field mapping
        if (/^(balance|credit|cash|wallet|credits)$/i.test(k) || /player\.balance|user\.balance/i.test(p)) {
          out.fields.balance = v;
          out.signals.push("field-balance");
          if (out.kind === "unknown" || out.kind === "spin-result") out.kind = out.kind === "spin-result" ? "spin-result" : "balance";
        }
        if (/^(bet|stake|totalbet|betamount|wager)$/i.test(k)) {
          out.fields.bet = v;
          out.signals.push("field-bet");
        }
        if (/^(win|winamount|totalwin|payout|prize)$/i.test(k)) {
          out.fields.win = v;
          out.signals.push("field-win");
          if (out.kind === "unknown" || out.kind === "spin-request") out.kind = "spin-result";
        }
        if (/^(session|sessionid|sid|token|accesstoken|auth)$/i.test(k)) {
          out.fields.session = typeof v === "string" ? v.slice(0, 24) + (String(v).length > 24 ? "…" : "") : v;
          out.signals.push("field-session");
          if (out.kind === "unknown") out.kind = "session";
        }
        if (/symbol|symbols|reels|reelwindow|window|board|matrix|grid/i.test(lk)) {
          out.signals.push("field-symbols");
          if (Array.isArray(v)) out.fields.symbols = v;
          if (out.kind === "unknown" || out.kind === "spin-request") out.kind = "spin-result";
        }
        if (/freespin|free_spin|fsleft|freespinsleft|bonus/i.test(lk)) {
          out.fields.feature = out.fields.feature || {};
          out.fields.feature[k] = v;
          out.signals.push("field-feature");
        }
        if (/^(error|errcode|errorcode|message|msg)$/i.test(k) && keys.length <= 8) {
          out.fields.error = v;
          if (out.kind === "unknown") out.kind = "error-or-status";
        }
      }
    }
    collect(json, "", 0);

    // Boost confidence
    if (out.signals.length >= 2) out.confidence = "medium";
    if (out.signals.length >= 4 || (out.fields.win !== undefined && out.fields.symbols)) {
      out.confidence = "high";
    }
    if (out.kind === "spin-result" && (out.fields.win !== undefined || out.fields.symbols)) {
      out.confidence = "high";
    }
  } else if (out.kind !== "unknown") {
    out.confidence = "medium";
  }

  // Normalize spin-request vs result: if body has win/symbols → result
  if (out.kind === "spin-request" && (out.fields.win !== undefined || out.fields.symbols)) {
    out.kind = "spin-result";
  }

  return out;
}
