import { strToU8 } from "fflate";

const FRAME_BUSTER_RE = [
  /if\s*\(\s*(?:window\.)?top\s*!==?\s*(?:window\.)?(?:self|this)\s*\)/gi,
  /if\s*\(\s*(?:window\.)?self\s*!==?\s*(?:window\.)?top\s*\)/gi,
  /if\s*\(\s*(?:window\.)?parent\s*!==?\s*(?:window\.)?(?:self|this|window)\s*\)/gi,
  /top\.location\s*=/gi,
  /parent\.location\s*=/gi,
  /top\.location\.href\s*=/gi,
  /parent\.location\.href\s*=/gi,
  /window\.top\.location/gi,
  /if\s*\(\s*window\s*!==\s*window\.top\s*\)/gi,
  /if\s*\(\s*top\s*!=\s*self\s*\)/gi,
];

export function neutralizeFrameBusters(text) {
  let out = text;
  let n = 0;
  for (const re of FRAME_BUSTER_RE) {
    out = out.replace(re, (m) => { n++; return "/* GC-PRO */ false && " + m; });
  }
  return { text: out, count: n };
}

export function buildUrlToLocalMap(manifest) {
  const map = new Map();
  for (const r of manifest) {
    if (r.url && r.localPath) {
      map.set(r.url, r.localPath);
      try {
        const u = new URL(r.url);
        // Full URL
        map.set(u.href, r.localPath);
        // Protocol-relative
        map.set("//" + u.host + u.pathname + u.search, r.localPath);
        // Path + query
        map.set(u.pathname + u.search, r.localPath);
        map.set(u.pathname, r.localPath);
        // Bare filename
        const bare = u.pathname.split("/").pop();
        if (bare) {
          map.set(bare, r.localPath);
          map.set(bare + u.search, r.localPath);
        }
        // Without query for matching
        if (u.search) map.set(u.origin + u.pathname, r.localPath);
      } catch {}
    }
  }
  return map;
}

export function rewriteContent(text, urlMap, isHtml) {
  let out = text;

  // 1. Full absolute + protocol-relative (longest first)
  const entries = [...urlMap.entries()]
    .filter(([k]) => k.includes("/") || k.startsWith("http") || k.startsWith("//"))
    .sort((a, b) => b[0].length - a[0].length);

  for (const [from, to] of entries) {
    if (from.length < 4) continue;
    if (out.includes(from)) out = out.split(from).join(to);
  }

  // 2. Relative path patterns common in games (src="./xxx", url(xxx), import("xxx"))
  // Map bare names that appear in zip
  const bareMap = new Map();
  for (const [k, v] of urlMap) {
    if (!k.includes("/") && k.length > 3) bareMap.set(k, v);
  }

  // 3. CSS url() rewrite
  out = out.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (m, p) => {
    const clean = p.trim().split("?")[0].split("#")[0];
    const name = clean.split("/").pop();
    if (urlMap.has(p)) return `url(${urlMap.get(p)})`;
    if (urlMap.has(clean)) return `url(${urlMap.get(clean)})`;
    if (name && bareMap.has(name)) return `url(${bareMap.get(name)})`;
    return m;
  });

  // 4. HTML src/href that still absolute
  if (isHtml) {
    out = out.replace(/(src|href|data-src|data-href)=["'](https?:\/\/[^"']+)["']/gi, (m, attr, u) => {
      if (urlMap.has(u)) return `${attr}="${urlMap.get(u)}"`;
      try {
        const path = new URL(u).pathname;
        if (urlMap.has(path)) return `${attr}="${urlMap.get(path)}"`;
        const bare = path.split("/").pop();
        if (bare && bareMap.has(bare)) return `${attr}="${bareMap.get(bare)}"`;
      } catch {}
      return m;
    });

    if (!/<base\s/i.test(out) && out.includes("<head>")) {
      out = out.replace("<head>", '<head>\n<base href="./">');
    }

    // Offline bootstrap: frame protect + soft-block external network + common game fixes
    const offlineBoot = `<script>
(function(){
  try{Object.defineProperty(window,"top",{get:function(){return window}})}catch(e){}
  try{Object.defineProperty(window,"parent",{get:function(){return window}})}catch(e){}
  window.__gc_offline=1;window.__gc_protected=1;
  var _f=window.fetch;
  window.fetch=function(u,i){
    try{
      var s=typeof u==="string"?u:(u&&u.url)||"";
      if(/^https?:\\/\\//i.test(s)&&!/^(blob:|data:)/i.test(s)){
        console.warn("[GC-Offline] blocked external:",s);
        return Promise.reject(new Error("offline"));
      }
    }catch(e){}
    return _f.apply(this,arguments);
  };
  // Soft XHR block
  var _x=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    if(typeof u==="string"&&/^https?:\\/\\//i.test(u)&&!/^(blob:|data:)/i.test(u)){
      console.warn("[GC-Offline] blocked XHR:",u);
      u="data:," ;
    }
    return _x.apply(this,arguments);
  };
})();
<\/script>`;
    if (out.includes("<head>")) out = out.replace("<head>", "<head>" + offlineBoot);
  }
  return out;
}

export function smartPackage(zipFiles, manifest) {
  const urlMap = buildUrlToLocalMap(manifest);
  const result = { rewritten: 0, neutralized: 0 };
  const bareMap = new Map();
  for (const [k, v] of urlMap) {
    if (!String(k).includes("/") && String(k).length > 3) bareMap.set(k, v);
  }
  for (const key of Object.keys(zipFiles)) {
    const isHtml = /\.html?$/i.test(key) || key === "index.html";
    const isJs = /\.(js|mjs)$/i.test(key);
    const isCss = /\.css$/i.test(key);
    const isJson = /\.json$/i.test(key);
    if (!isHtml && !isJs && !isCss && !isJson) continue;
    try {
      let text = new TextDecoder().decode(zipFiles[key]);
      const before = text;
      if (!isJson) {
        text = rewriteContent(text, urlMap, isHtml);
      }
      // JS import / dynamic import / require
      if (isJs || isHtml) {
        text = text.replace(/\b(import|from|require)\s*\(?\s*['"]([^'"]+)['"]/g, (m, kw, p) => {
          if (urlMap.has(p)) return m.replace(p, urlMap.get(p));
          const bare = p.split("/").pop();
          if (bare && bareMap.has(bare)) return m.replace(p, bareMap.get(bare));
          return m;
        });
        text = text.replace(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, (m, p) => {
          if (urlMap.has(p)) return `import('${urlMap.get(p)}')`;
          const bare = p.split("/").pop();
          if (bare && bareMap.has(bare)) return `import('${bareMap.get(bare)}')`;
          return m;
        });
      }
      // JSON walk for URL strings
      if (isJson) {
        try {
          let j = JSON.parse(text);
          let touched = false;
          const walk = (obj) => {
            if (typeof obj === "string") {
              if (urlMap.has(obj)) { touched = true; return urlMap.get(obj); }
              try {
                const u = new URL(obj);
                const bare = u.pathname.split("/").pop();
                if (bare && bareMap.has(bare)) { touched = true; return bareMap.get(bare); }
              } catch {}
              return obj;
            }
            if (Array.isArray(obj)) return obj.map(walk);
            if (obj && typeof obj === "object") {
              for (const k of Object.keys(obj)) obj[k] = walk(obj[k]);
            }
            return obj;
          };
          j = walk(j);
          if (touched) text = JSON.stringify(j);
        } catch {}
      }
      if (isJs || isHtml) {
        const res = neutralizeFrameBusters(text);
        text = res.text;
        result.neutralized += res.count;
      }
      if (text !== before) {
        zipFiles[key] = strToU8(text);
        result.rewritten++;
      }
    } catch {}
  }
  return result;
}
