/* AdsTube — static YouTube-like client. Hash routes so python -m http.server works. */
const $ = (s, el = document) => el.querySelector(s);
const view = $("#view");
const PREFIX = "adstube_";
const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(PREFIX + k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch {} },
};
let likes = store.get("likes", []), dislikes = store.get("dislikes", []);
let seen = store.get("seen", []);
const seed = String(Math.floor(Math.random() * 1e9));
let watchLater = store.get("later", []);
let notes = store.get("notes", {}); // vid -> {idea, test, result, updated}
let useFrames = store.get("frames", true);

const CLOCK = '<svg viewBox="0 0 24 24"><path d="M14.97 16.95 10 13.87V7h2v5.76l4.03 2.49-1.06 1.7zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';

let DATA = { videos: [], mentions: {}, taxonomy: { areas: [] }, playlists: [], related: {}, stats: {} };
let byId = new Map();
let emb = null;          // Float32Array, n * 384
let embRows = 0;
const DIM = 384;
let inverted = null;     // term -> Int32Array of row indexes

function toggleLater(vid) {
  watchLater = watchLater.includes(vid) ? watchLater.filter(v => v !== vid) : watchLater.concat(vid);
  store.set("later", watchLater);
  return watchLater.includes(vid);
}
function markSeen(vid) {
  seen = seen.filter(v => v !== vid).concat(vid).slice(-200);
  store.set("seen", seen);
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dur = (s) => { if (s == null || s === "") return ""; s = Math.round(+s); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60;
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(x).padStart(2,"0")}` : `${m}:${String(x).padStart(2,"0")}`; };
const views = (n) => n == null || n === "" ? "" : n >= 1e9 ? `${(n/1e9).toFixed(1).replace(/\.0$/,"")}B views`
  : n >= 1e6 ? `${(n/1e6).toFixed(1).replace(/\.0$/,"")}M views` : n >= 1e3 ? `${Math.round(n/1e3)}K views` : `${n} views`;
function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso)) / 1000, units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400]];
  for (const [u, sec] of units) { const n = Math.floor(s / sec); if (n >= 1) return `${n} ${u}${n > 1 ? "s" : ""} ago`; }
  return "today";
}
const laterBtn = (vid) => {
  const on = watchLater.includes(vid);
  return `<span class="later-btn ${on ? "on" : ""}" role="button" tabindex="0" data-later="${vid}"
    title="${on ? "Remove from Watch later" : "Watch later"}" aria-label="${on ? "Remove from Watch later" : "Watch later"}">${on ? CHECK : CLOCK}</span>`;
};
const frameSrc = (vid) => `https://i.ytimg.com/vi/${vid}/hq2.jpg`;
const thumbSrc = (vid) => useFrames ? frameSrc(vid) : `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
function thumbFallback(img) {
  const vid = img.dataset.vid;
  if (img.src.includes("/hq2.jpg")) img.src = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
  else img.onerror = null;
}
window.thumbFallback = thumbFallback;

function recCount(d) { return (d.rec && (d.rec.recommenders || 0)) || 0; }
function tierBadge(d) {
  const t = d.tiers || [];
  const rec = recCount(d);
  if (rec && t.includes("expert")) return `<span class="badge both">Community + experts</span>`;
  if (rec) return `<span class="badge seller">Recommended by the community</span>`;
  return "";
}
const thumb = (d) => `<div class="thumb"><img loading="lazy" src="${thumbSrc(d.vid)}" data-vid="${d.vid}" onerror="thumbFallback(this)" alt="">${laterBtn(d.vid)}${tierBadge(d)}<span class="dur">${dur(d.duration_s)}</span></div>`;
const sub = (d) => [views(d.views), ago(d.published)].filter(Boolean).join(" • ");
const href = (path) => `#${path}`;

const card = (d) => `<a class="vcard" href="${href("/watch/"+d.vid)}"${d.reason ? ` title="${esc(d.reason)}"` : ""}>${thumb(d)}
  <div class="info"><div style="min-width:0">
    <h3 class="vt">${esc(d.title)}</h3><div class="sub">${esc(d.channel)}</div>
    <div class="sub">${sub(d)}</div></div></div></a>`;
const row = (d) => `<a class="srow" href="${href("/watch/"+d.vid)}">${thumb(d)}<div style="min-width:0">
    <h3 class="vt">${esc(d.title)}</h3><div class="sub">${sub(d)}</div>
    <div class="chan">${esc(d.channel)}</div>
    <div class="snip">${d.level ? `<span class="level ${esc(d.level)}">${esc(d.level)}</span> ` : ""}${esc(d.summary || d.why || "")}</div>
    ${d.via ? `<span class="via">${esc(d.via)}</span>` : ""}</div></a>`;
const next = (d) => `<a class="next" href="${href("/watch/"+d.vid)}">${thumb(d)}<div style="min-width:0">
    <h3 class="vt">${esc(d.title)}</h3><div class="sub">${esc(d.channel)}</div><div class="sub">${sub(d)}</div></div></a>`;

const commentHTML = (t) => esc(t).replace(/\n/g, "<br>").replace(/\[VIDEO\]/g, '<span class="mk v">▶ this video</span>').replace(/\[LINK\]/g, '<span class="mk">link</span>');
const STANCE = { strong_rec: "Strongly recommends", rec: "Recommends", reference: "Cites", joke: "Joke", critical: "Critical" };

/* ---------- routing helpers ---------- */
function loc() {
  let h = (location.hash || "#/").replace(/^#/, "") || "/";
  if (!h.startsWith("/")) h = "/" + h;
  const i = h.indexOf("?");
  return { path: i < 0 ? h : h.slice(0, i), search: new URLSearchParams(i < 0 ? "" : h.slice(i + 1)) };
}
function navigate(path) {
  if (!path.startsWith("#")) path = "#" + (path.startsWith("/") ? path : "/" + path);
  if (path !== location.hash) location.hash = path.slice(1) === "" ? "#/" : path;
  else route();
}

/* ---------- filters ---------- */
const FILTERS = [
  ["Upload date", [["date", "year", "Past year"], ["date", "2020s", "2020s"], ["date", "2010s", "2010s"],
                   ["date", "2000s", "2000s"]]],
  ["Type", [["type", "tutorial", "Tutorial"], ["type", "explainer", "Explainer"], ["type", "talk", "Talk"],
            ["type", "interview", "Interview"], ["type", "podcast", "Podcast"], ["type", "course", "Course"],
            ["type", "demo", "Demo"], ["type", "commentary", "Commentary"]]],
  ["Duration", [["dur", "short", "Under 4 minutes"], ["dur", "medium", "4–20 minutes"], ["dur", "long", "20–60 minutes"],
                ["dur", "xlong", "Over 1 hour"]]],
  ["Source", [["src", "seller", "Recommended by the community"], ["src", "expert", "From the experts"]]],
  ["Level", [["level", "beginner", "Beginner"], ["level", "intermediate", "Intermediate"], ["level", "advanced", "Advanced"]]],
  ["Features", [["gems", "1", "Hidden gems"], ["evergreen", "1", "Evergreen only"]]],
  ["Sort by", [["sort", "", "Relevance"], ["sort", "recent", "Recently uploaded"], ["sort", "date", "Upload date"],
               ["sort", "old", "Oldest first"], ["sort", "views", "View count"], ["sort", "hn", "Most recommended"]]],
];
const FILTER_KEYS = [...new Set(FILTERS.flatMap(([, opts]) => opts.map(([k]) => k)))];
let filtersOpen = false;
const filterParams = () => {
  const url = loc().search;
  return Object.fromEntries(FILTER_KEYS.map((k) => [k, url.get(k) || ""]));
};
const withParams = (path, params) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return path + (qs ? `?${qs}` : "");
};
const filtering = (params) => FILTER_KEYS.some((k) => k !== "sort" && params[k]);

function yearOf(d) {
  const p = d.published || "";
  if (p.length >= 4) return +p.slice(0, 4);
  return null;
}
function passesFilters(d, params) {
  if (params.type && d.content_type !== params.type) return false;
  if (params.level && d.level !== params.level) return false;
  if (params.dur === "short" && !(d.duration_s > 0 && d.duration_s < 240)) return false;
  if (params.dur === "medium" && !(d.duration_s >= 240 && d.duration_s < 1200)) return false;
  if (params.dur === "long" && !(d.duration_s >= 1200 && d.duration_s < 3600)) return false;
  if (params.dur === "xlong" && !(d.duration_s >= 3600)) return false;
  if (params.src === "seller" && recCount(d) < 1) return false;
  if (params.src === "expert" && !(d.tiers || []).includes("expert")) return false;
  if (params.gems === "1") {
    if (!(recCount(d) >= 1 && (d.views == null || d.views < 100000))) return false;
  }
  if (params.evergreen === "1" && d.shelf_life === "news") return false;
  if (params.date) {
    const y = yearOf(d);
    if (!y) return false;
    const nowY = new Date().getFullYear();
    if (params.date === "year" && y < nowY - 1) return false;
    if (params.date === "2020s" && (y < 2020 || y > 2029)) return false;
    if (params.date === "2010s" && (y < 2010 || y > 2019)) return false;
    if (params.date === "2000s" && (y < 2000 || y > 2009)) return false;
  }
  return true;
}
function sortList(list, params, relevanceMap) {
  const arr = list.slice();
  const rec = (d) => (d.rec && (d.rec.recommenders || 0)) || 0;
  const score = (d) => d.score || 0;
  switch (params.sort) {
    case "recent":
    case "date": arr.sort((a, b) => (b.published || "").localeCompare(a.published || "")); break;
    case "old": arr.sort((a, b) => (a.published || "").localeCompare(b.published || "")); break;
    case "views": arr.sort((a, b) => (b.views || 0) - (a.views || 0)); break;
    case "hn": arr.sort((a, b) => rec(b) - rec(a) || score(b) - score(a)); break;
    default:
      if (relevanceMap) arr.sort((a, b) => (relevanceMap.get(b.vid) || 0) - (relevanceMap.get(a.vid) || 0));
      else arr.sort((a, b) => score(b) - score(a) || rec(b) - rec(a) || (b.views || 0) - (a.views || 0));
  }
  return arr;
}

const playAll = () => `<a class="pill playall" href="https://www.youtube.com/" target="_blank" rel="noopener"
    title="Open the videos on this page as a playlist on YouTube"><svg viewBox="0 0 24 24"><path d="M3 5h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm12 0v8l6-4z"/></svg>Play all on YouTube</a>`;
function wirePlayAll() {
  const a = $(".playall");
  if (!a) return;
  a.onclick = () => {
    const ids = [...new Set([...view.querySelectorAll(".thumb img[data-vid]")].map((i) => i.dataset.vid))].slice(0, 50);
    if (!ids.length) return false;
    a.href = `https://www.youtube.com/watch_videos?video_ids=${ids.join(",")}`;
  };
}
function filterBar(path, params, listing = false, playable = true) {
  const link = (k, v) => href(withParams(path, { ...params, [k]: params[k] === v ? "" : v }));
  const groups = FILTERS.map(([title, opts]) => [title, !listing || title !== "Sort by" ? opts
    : opts.filter(([, v]) => v !== "hn").map(([k, v, label]) => [k, v, v ? label : "Best first"])]);
  const active = groups.flatMap(([, opts]) => opts.filter(([k, v]) => v && params[k] === v)
    .map(([k, v, label]) => `<a class="chip on" href="${link(k, v)}" title="Remove filter">${label}<span>×</span></a>`));
  return `<div class="filterbar">
      <button class="pill${filtersOpen ? " on" : ""}" id="filters-btn" aria-expanded="${filtersOpen}">
        <svg viewBox="0 0 24 24"><path d="M15 17h6v1h-6v-1zm-4 0H3v1h8v2h1v-5h-1v2zm3-9h1V3h-1v2H3v1h11v2zm4-3v1h3V5h-3zM6 14h1V9H6v2H3v1h3v2zm4-2h11v-1H10v1z"/></svg>
        Filters</button>${active.join("")}<span class="grow"></span>${playable ? playAll() : ""}</div>
    <div class="filters"${filtersOpen ? "" : " hidden"}>${groups.map(([title, opts]) => `<div><h4>${title}</h4>
      ${opts.map(([k, v, label]) => `<a href="${link(k, v)}" class="${(params[k] || "") === v ? "on" : ""}">${label}</a>`).join("")}
    </div>`).join("")}</div>`;
}
function wireFilterBar() {
  wirePlayAll();
  const btn = $("#filters-btn");
  if (!btn) return;
  btn.onclick = () => {
    filtersOpen = !filtersOpen;
    const panel = $(".filters");
    if (panel) panel.hidden = !filtersOpen;
    btn.classList.toggle("on", filtersOpen);
    btn.setAttribute("aria-expanded", filtersOpen);
  };
  for (const a of view.querySelectorAll(".filters a")) a.addEventListener("click", () => { filtersOpen = false; });
}

/* ---------- infinite grid ---------- */
let pager = null;
function infinite(container, items) {
  if (pager) pager.disconnect();
  let offset = 0, busy = false, done = false;
  const n = 36;
  const sentinel = document.createElement("div"); sentinel.className = "sentinel";
  container.after(sentinel);
  const more = () => {
    if (busy || done) return; busy = true;
    const slice = items.slice(offset, offset + n);
    offset += slice.length; done = slice.length === 0 || offset >= items.length;
    container.insertAdjacentHTML("beforeend", slice.map(card).join(""));
    if (!offset) container.outerHTML = `<div class="status">${filtering(filterParams()) ? "No videos match these filters." : "Nothing here yet."}</div>`;
    busy = false;
    if (!done && sentinel.getBoundingClientRect().top < innerHeight + 800) more();
  };
  pager = new IntersectionObserver((e) => e[0].isIntersecting && more(), { rootMargin: "800px" });
  pager.observe(sentinel);
  more();
}

/* ---------- embeddings / search ---------- */
function tokenize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9+]+/g, " ").split(/\s+/).filter(w => w.length >= 2);
}
function buildInverted() {
  const map = new Map();
  DATA.videos.forEach((d, i) => {
    const blob = [d.title, d.channel, d.primary_topic, d.summary, d.why, ...(d.tags || []),
      ...(d.categories || []).map(c => c.name + " " + (c.description || "") + " " + c.area_name)].join(" ");
    for (const t of new Set(tokenize(blob))) {
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(i);
    }
  });
  inverted = map;
}
function embRow(i) { return emb.subarray(i * DIM, (i + 1) * DIM); }
function dot(a, b) { let s = 0; for (let i = 0; i < DIM; i++) s += a[i] * b[i]; return s; }
function similarTo(vid, n = 20, exclude = new Set()) {
  if (!emb || embRows === 0) return [];
  const i = embIndex(vid);
  if (i < 0) return [];
  const row = embRow(i);
  const scored = [];
  for (let j = 0; j < embRows; j++) {
    const d = DATA.videos[j];
    if (!d || d.vid === vid || exclude.has(d.vid)) continue;
    scored.push([dot(row, embRow(j)), j]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, n).map(([, j]) => DATA.videos[j]);
}
function embIndex(vid) {
  const d = byId.get(vid);
  return d && d._i != null ? d._i : DATA.videos.findIndex(v => v.vid === vid);
}
function searchVideos(q, params) {
  const terms = tokenize(q);
  const rel = new Map();
  const via = new Map();
  // keyword
  for (const d of DATA.videos) {
    if (!passesFilters(d, params)) continue;
    const title = (d.title || "").toLowerCase();
    const chan = (d.channel || "").toLowerCase();
    const blob = (title + " " + chan + " " + (d.primary_topic || "") + " " + (d.tags || []).join(" ") + " " +
      (d.categories || []).map(c => c.name).join(" ")).toLowerCase();
    let s = 0;
    for (const t of terms) {
      if (title.includes(t)) s += 3;
      else if (chan.includes(t)) s += 1.5;
      else if (blob.includes(t)) s += 1;
    }
    if (s) rel.set(d.vid, s);
  }
  // taxonomy via — only distinctive terms, not "search"/"ads"/"amazon"
  const GENERIC = new Set(["search","term","terms","ads","ad","amazon","video","campaign","campaigns","report","reports","the","and","for","with","your","how","what","this","that"]);
  const ql = q.toLowerCase();
  const distinctive = terms.filter(t => t.length >= 4 && !GENERIC.has(t));
  for (const a of DATA.taxonomy.areas || []) {
    for (const c of a.categories || []) {
      const name = (c.name || "").toLowerCase();
      const desc = (name + " " + (c.description || "")).toLowerCase();
      const hit = distinctive.some(t => name.includes(t)) ||
        (distinctive.length >= 1 && distinctive.every(t => desc.includes(t))) ||
        (ql.length >= 8 && name.includes(ql));
      if (hit) {
        for (const d of DATA.videos) {
          if ((d.categories || []).some(x => x.id === c.id)) {
            via.set(d.vid, "Topic match · " + c.name);
            rel.set(d.vid, (rel.get(d.vid) || 0) + 1.2);
          }
        }
      }
    }
  }
  // semantic: IDF-weighted average of document embeddings that contain query terms, then cosine
  if (emb && inverted && terms.length) {
    const N = DATA.videos.length;
    const qv = new Float32Array(DIM);
    let used = 0;
    for (const t of terms) {
      const docs = inverted.get(t);
      if (!docs || !docs.length) continue;
      const idf = Math.log((N + 1) / (docs.length + 1)) + 1;
      const take = docs.length > 80 ? docs.slice(0, 80) : docs;
      for (const i of take) {
        const row = embRow(i);
        for (let k = 0; k < DIM; k++) qv[k] += row[k] * idf;
        used++;
      }
    }
    if (used) {
      let nrm = 0; for (let k = 0; k < DIM; k++) nrm += qv[k] * qv[k];
      nrm = Math.sqrt(nrm) || 1;
      for (let k = 0; k < DIM; k++) qv[k] /= nrm;
      for (let i = 0; i < embRows; i++) {
        const d = DATA.videos[i];
        if (!d || !passesFilters(d, params)) continue;
        const cos = dot(qv, embRow(i));
        const has = rel.has(d.vid);
        if (cos > (has ? 0.22 : 0.36)) rel.set(d.vid, (rel.get(d.vid) || 0) + cos * 4);
      }
    }
  }
  const items = DATA.videos.filter(d => rel.has(d.vid) && passesFilters(d, params)).map(d => {
    const x = { ...d, via: via.get(d.vid) || null, relevance: rel.get(d.vid) };
    return x;
  });
  items.sort((a, b) => b.relevance - a.relevance);
  return { results: items, weak: items.length === 0 || (items[0] && items[0].relevance < 1.2) };
}

/* ---------- For You ---------- */
function mulberry32(a) { return function() { let t = a += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(arr, rnd) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function forYou(offset, n) {
  const rnd = mulberry32((Number(seed) + offset * 9973) >>> 0);
  const seenSet = new Set(seen.concat(dislikes));
  const pool = DATA.videos.filter(d => !seenSet.has(d.vid));
  const rec = (d) => (d.rec && d.rec.recommenders) || 0;
  const yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const yearAgoIso = yearAgo.toISOString();
  const likedVids = likes.map(v => byId.get(v)).filter(Boolean);
  const likedTopics = new Set(likedVids.flatMap(d => (d.categories || []).map(c => c.id)));
  const openedTopics = new Set(seen.map(v => byId.get(v)).filter(Boolean).flatMap(d => (d.categories || []).map(c => c.id)));

  const classics = pool.filter(d => (d.views || 0) > 50000 || rec(d) >= 2 || (d.score || 0) >= 3)
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.views || 0) - (a.views || 0));
  const gems = pool.filter(d => rec(d) >= 1 && (d.views == null || d.views < 100000));
  const recent = pool.filter(d => d.published && d.published >= yearAgoIso)
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  const unexploredAreas = (DATA.taxonomy.areas || []).filter(a =>
    !(a.categories || []).some(c => openedTopics.has(c.id) || likedTopics.has(c.id)));
  const explorePool = pool.filter(d => (d.categories || []).some(c => unexploredAreas.some(a => a.id === c.area)));
  const deep = pool.filter(d => rec(d) >= 1 && (d.views == null || d.views < 250000) && (d.score || 0) < 4);
  const wildcard = pool;

  const buckets = [];
  const pick = (list, source, reason, k = 1) => {
    const sh = shuffle(list, rnd);
    let got = 0;
    for (const d of sh) {
      if (got >= k) break;
      if (buckets.some(x => x.vid === d.vid)) continue;
      buckets.push({ ...d, source, reason });
      got++;
    }
  };
  pick(classics, "classics", "A classic in Amazon Ads education");
  pick(gems, "gems", "Hidden gem: recommended by the community, little-watched on YouTube");
  pick(recent, "recent", "Recent (last 12 months)");
  if (unexploredAreas.length) {
    const a = unexploredAreas[Math.floor(rnd() * unexploredAreas.length)];
    pick(explorePool.filter(d => (d.categories || []).some(c => c.area === a.id)), "explore", `Explore: ${a.name}`);
  } else {
    pick(pool.filter(d => (d.categories || []).some(c => !openedTopics.has(c.id))), "explore", "Explore a new topic");
  }
  pick(deep, "deep", "Deep cut: recommended by the community, rarely surfaced");
  pick(wildcard, "wildcard", "Random pick");

  if (likedVids.length && emb) {
    const src = likedVids[Math.floor(rnd() * likedVids.length)];
    const sim = similarTo(src.vid, 8, seenSet);
    pick(sim, "similar", `Because you liked “${src.title}”`);
    pick(sim.slice(2), "taste", "Matches your taste");
  }
  // co-recommendations
  if (likedVids.length && DATA.related) {
    const src = likedVids[0];
    const rel = (DATA.related[src.vid] || []).map(x => byId.get(x.vid || x)).filter(Boolean);
    pick(rel, "corec", `Related to “${src.title}”`);
  }
  // fill
  while (buckets.length < n) {
    const more = shuffle(pool, rnd).find(d => !buckets.some(x => x.vid === d.vid));
    if (!more) break;
    buckets.push({ ...more, source: "wildcard", reason: "Random pick" });
  }
  return buckets.slice(0, n);
}

function feedPage() {
  // build a long mixed feed of several rounds
  const items = [];
  const have = new Set();
  for (let off = 0; items.length < 240; off++) {
    const batch = forYou(off, 8);
    let added = 0;
    for (const d of batch) {
      if (have.has(d.vid)) continue;
      have.add(d.vid); items.push(d); added++;
    }
    if (!added) break;
  }
  return items;
}

/* ---------- pages ---------- */
async function home() {
  document.title = "AdsTube";
  const params = filterParams();
  view.innerHTML = `${filterBar("/browse", params, true, false)}<div class="grid" id="grid"></div>`;
  wireFilterBar();
  infinite($("#grid"), feedPage());
}
function category(id) {
  const a = (DATA.taxonomy.areas || []).find(x => x.categories.some(c => c.id === id));
  if (!a) return notFound();
  const c = a.categories.find(c => c.id === id);
  document.title = `${c.name} - AdsTube`;
  const params = filterParams();
  const items = sortList(DATA.videos.filter(d => (d.categories || []).some(x => x.id === id) && passesFilters(d, params)), { ...params, sort: params.sort || "hn" });
  view.innerHTML = `<div class="pagehead"><a class="crumb" href="${href("/a/"+a.id)}">${esc(a.name)}</a><h2>${esc(c.name)}</h2>
    ${c.description ? `<p class="sub">${esc(c.description)}</p>` : ""}</div>
    ${filterBar("/c/"+id, params, true)}<div class="grid" id="grid"></div>`;
  wireFilterBar();
  infinite($("#grid"), items);
}
function browsePage() {
  const params = filterParams();
  const longs = params.dur === "xlong";
  const community = params.src === "seller";
  const gems = params.gems === "1";
  const heading = longs ? "Longs" : community ? "Recommended by the community" : gems ? "Hidden gems" : "All videos";
  const items = sortList(DATA.videos.filter(d => passesFilters(d, params)), { ...params, sort: params.sort || (longs ? "hn" : "hn") });
  const sub = longs
      ? `<p class="sub">Every video over an hour. The opposite of Shorts.</p>`
      : community
        ? `<p class="sub">Videos and channels people recommended in public. A specific title lands in the grid only with two distinct non-owner recommenders, or one strong detailed recommendation — and the same teaching-value bar as the rest of the library. Channel-level Reddit recommendations are listed separately below.</p>`
        : gems ? `<p class="sub">Community-recommended videos that are little-watched on YouTube.</p>` : "";
  document.title = heading + " - AdsTube";
  view.innerHTML = `<div class="pagehead"><h2>${heading}</h2>${sub}</div>
    ${community ? recommendedChannelsHTML() : ""}
    ${filterBar("/browse", params, true)}
    <div class="grid" id="grid"></div>`;
  wireFilterBar();
  infinite($("#grid"), items);
}
function area(id) {
  const a = (DATA.taxonomy.areas || []).find(x => x.id === id);
  if (!a) return notFound();
  document.title = `${a.name} - AdsTube`;
  const params = filterParams();
  const items = sortList(DATA.videos.filter(d => (d.categories || []).some(c => c.area === id) && passesFilters(d, params)), { ...params, sort: params.sort || "hn" });
  view.innerHTML = `<div class="pagehead"><h2>${esc(a.name)}</h2></div>
    <div class="catwrap">${a.categories.map(c => `<a class="chip" href="${href("/c/"+c.id)}">${esc(c.name)}</a>`).join("")}</div>
    ${filterBar("/a/"+id, params, true)}<div class="grid" id="grid"></div>`;
  wireFilterBar();
  infinite($("#grid"), items);
}
const hours = (m) => m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
const playlistCard = (p) => `<a class="plcard" href="${href("/p/"+p.slug)}">
    <div class="mosaic">${(p.cover || []).map(v => `<img loading="lazy" src="${thumbSrc(v)}" data-vid="${v}" onerror="thumbFallback(this)" alt="">`).join("")}
      <span class="plcount">${p.count} videos · ${hours(p.minutes)}</span></div>
    <h3 class="vt">${esc(p.title)}</h3><p class="sub">${esc(p.pitch)}</p></a>`;
function playlistPage(slug) {
  const pl = (DATA.playlists || []).find(p => p.slug === slug);
  if (!pl) return notFound();
  document.title = `${pl.title} - AdsTube`;
  const vids = (pl.videos || []).map(x => typeof x === "string" ? { vid: x, note: "" } : x)
    .map(x => ({ ...byId.get(x.vid), note: x.note })).filter(d => d && d.vid);
  view.innerHTML = `<div class="plpage">
    <div class="plhead">
      <div class="mosaic">${vids.slice(0, 4).map(d => `<img src="${thumbSrc(d.vid)}" data-vid="${d.vid}" onerror="thumbFallback(this)" alt="">`).join("")}</div>
      <div class="plinfo">
        <a class="crumb" href="${href("/playlists")}">Playlists</a>
        <h2>${esc(pl.title)}</h2>
        <div class="sub">${vids.length} videos · ${hours(pl.minutes)}</div>
        <p class="intro">${esc(pl.intro)}</p>
        <div class="filterbar">${playAll()}</div>
      </div>
    </div>
    <ol class="plrows">${vids.map((d, i) => `<li><span class="num">${i + 1}</span>
      <a class="srow" href="${href("/watch/"+d.vid)}">${thumb(d)}<div style="min-width:0">
        <h3 class="vt">${esc(d.title)}</h3><div class="sub">${esc(d.channel)} · ${sub(d)}</div>
        ${d.note ? `<p class="plnote">${esc(d.note)}</p>` : ""}</div></a></li>`).join("")}</ol>
  </div>`;
  wirePlayAll();
}
function categoriesPage() {
  document.title = "Categories - AdsTube";
  const counts = {};
  for (const d of DATA.videos) for (const c of d.categories || []) {
    counts[c.id] = (counts[c.id] || 0) + 1;
    counts[c.area] = (counts[c.area] || 0) + 1; // area may overcount if multi-cat; use unique below
  }
  const areaCount = (a) => DATA.videos.filter(d => (d.categories || []).some(c => c.area === a.id)).length;
  view.innerHTML = `<div class="explore">
    <div class="pagehead"><h2>Categories</h2></div>
    <div class="quick">
      <a class="pill" href="${href("/browse?sort=recent")}">Recently uploaded</a>
      <a class="pill" href="${href("/browse?dur=xlong")}">Longs</a>
      ${(DATA.videos || []).some(d => recCount(d) >= 1 && (d.views == null || d.views < 100000))
        ? `<a class="pill" href="${href("/browse?gems=1")}">Hidden gems</a>` : ""}
      ${((DATA.videos || []).some(d => recCount(d) >= 1) || Object.keys(DATA.channel_mentions || {}).length)
        ? `<a class="pill" href="${href("/browse?src=seller")}">Recommended by the community</a>` : ""}
      <a class="pill" href="${href("/browse")}">All videos</a>
    </div>
    <div class="areas">${(DATA.taxonomy.areas || []).map(a => `<section class="areacard">
      <a class="areaname" href="${href("/a/"+a.id)}">${esc(a.name)}<span class="count">${areaCount(a)}</span></a>
      <div class="cats">${a.categories.map(c => `<a href="${href("/c/"+c.id)}">${esc(c.name)}<span class="count">${counts[c.id] || 0}</span></a>`).join("")}</div>
    </section>`).join("")}</div>
  </div>`;
}
function playlistsPage() {
  document.title = "Playlists - AdsTube";
  const pls = DATA.playlists || [];
  view.innerHTML = `<div class="explore">
    <div class="pagehead"><h2>Playlists</h2>
      <p class="sub">Learning paths for becoming a go-to Amazon Ads expert, in a deliberate order.</p></div>
    ${!pls.length ? `<p class="sub">Coming soon.</p>` : [["start", "Start here", "Broad, essential lists for your first stretch of study."],
        ["deep", "Deep dives", "One topic each, for when you want to go down a rabbit hole."]]
      .map(([tier, title, blurb]) => { const ps = pls.filter(p => (p.tier || "deep") === tier);
        return ps.length ? `<h3 class="sechead">${title}</h3><p class="sub">${blurb}</p>
          <div class="pgrid">${ps.map(playlistCard).join("")}</div>` : ""; }).join("")}
  </div>`;
}

function about() {
  document.title = "About - AdsTube";
  const s = DATA.stats || {};
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  view.innerHTML = `<article class="about">
    <h1>Ads<span style="color:var(--accent)">Tube</span></h1>
    <p class="lede">A tightly curated library of Amazon Ads teaching videos from official and expert channels.</p>
    <div class="stats">
      <div class="stat"><b>${fmt(s.videos || DATA.videos.length)}</b><span>videos</span></div>
      <div class="stat"><b>${fmt(s.comments || 0)}</b><span>recommending comments</span></div>
      <div class="stat"><b>${fmt(s.categories || 0)}</b><span>topics in ${s.areas || 0} areas</span></div>
      <div class="stat"><b>${fmt(s.channels || 0)}</b><span>expert channels</span></div>
    </div>
    <h2>Why</h2>
    <p>YouTube is a good place to learn Amazon Ads, and a bad place to find the right video. Thumbnails shout, the algorithm repeats itself, and the useful hours are mixed in with get-rich-quick fluff.</p>
    <p>AdsTube is a curated front end over official Amazon Ads explainers and talks from practitioners who teach the craft — Ad Badger, Junglr, SellerMetrics, and others. Every video here had to earn its place as a real lesson (Sponsored ads, bidding, harvesting, AMC, DSP, SQP, structure), not a sales pitch, a webinar funnel, or a “make money on Amazon” recap.</p>
    <p>We also tried the HackerTube method: mine public posts for the videos and channels people actually recommend to each other, then keep those posts under the title. A first pass over Hacker News and official Reddit JSON found almost nothing genuine. A pass over public X posts that link to YouTube, and a later hand-collected set of Reddit comments, did better — after spam and self-promo were filtered and the rest was judged by hand. A specific video joins the community grid only if at least two distinct non-owner people recommended it, or one person wrote a strong, detailed recommendation, and the video still clears the same teaching-value bar as the expert shelf. Channel-level recommendations (for example “watch Ad Badger”) are shown as “What people said about this channel,” not pretended to be about one video.</p>
    <h2>How it was built</h2>
    <ol class="steps">
      <li><b>Look for community recommendations.</b> Public Reddit, Hacker News, and X posts were scanned. Cheap URL and spam filters ran first (self-promo, bot rings, giveaways, brand commercials). The remainder was judged by hand. Video-level recommendations appear under “What people said.” Channel-level Reddit recommendations appear under “What people said about this channel” and on that channel’s page. New channels named in those comments were added only after the same teaching-value filter as the expert shelf.</li>
      <li><b>Build the expert shelf carefully.</b> Channel catalogues were listed with yt-dlp from official Amazon Ads and well-known practitioners, then filtered on title, duration, and description for real teaching value (no Shorts, no tool tours, no course funnels, no pre-2020 UI walkthroughs unless they are conceptual classics).</li>
      <li><b>Sort into topics.</b> Each video is filed under a shared Amazon Ads taxonomy, and a 384-dimensional embedding (all-MiniLM) is shipped so search and “similar videos” run in your browser.</li>
    </ol>
    <h2>What you can do</h2>
    <ul>
      <li><b>Home</b> mixes classics, hidden gems, recent uploads, unexplored topics, deep cuts, and — once you like a few videos — similar talks. Community recommendation counts help surface classics and hidden gems. Hover a video to see why it's there.</li>
      <li><b>Search</b> uses shipped embeddings plus title, channel and topic text, so a query like “harvest search terms” can surface videos that never use those exact words.</li>
      <li><b>Every video page</b> can show <b>What people said</b> (with links back to the original X or Reddit post) and a <b>My notes</b> box: Idea, Test to run, Result — the start of your own playbook.</li>
      <li><b>Like</b>, <b>Watch later</b>, <b>History</b> and <b>Notes</b> live only in this browser.</li>
      <li><b>Keyboard shortcuts:</b> press <kbd>?</kbd> to see them, <kbd>/</kbd> to search, <kbd>j</kbd>/<kbd>k</kbd> to move.</li>
    </ul>
    <h2>Privacy</h2>
    <p>There are no accounts. Your likes, history, Watch later list and notes are stored only in this browser. Videos play through YouTube's privacy-enhanced embed.</p>
    <h2>Credits</h2>
    <p>AdsTube was built for Vamsy Krishna, inspired by <a href="https://hackertube.org" target="_blank" rel="noopener">HackerTube</a> (Andrej Karpathy / Claude, 2026) and <a href="https://karpathy.ai/tristan-tube/" target="_blank" rel="noopener">TristanTube</a>. Mid-frame thumbnails use YouTube's automatic <code>hq2.jpg</code> stills. Community comments remain the work of their authors.</p>
    <p class="fine">AdsTube is an independent project. It is not affiliated with YouTube, Google, or Amazon. Video titles, channels and counts come from publicly listed YouTube data retrieved with yt-dlp at build time.</p>
  </article>`;
}
function dataPage() {
  document.title = "Data - AdsTube";
  const s = DATA.stats || {};
  view.innerHTML = `<article class="about">
    <h1>The data</h1>
    <p class="lede">Everything behind AdsTube, ready to reuse or to hand to your notes.</p>
    <p><a class="pill dl" href="data.json" download>
      Download data.json</a>
      <a class="pill dl" href="assets/embeddings.bin" download>Download embeddings.bin</a></p>
    <p>${Number(s.videos || DATA.videos.length).toLocaleString("en-US")} videos,
      ${Number(s.comments || 0).toLocaleString("en-US")} labeled recommending comments,
      ${Number(s.categories || 0)} topics in ${s.areas || 0} areas.</p>
    <h2>Files</h2>
    <table class="files">
      <tr><td><code>data.json</code></td><td>Videos, taxonomy, playlists, related edges, and recommending comments. YouTube titles, channels, durations, views and dates are only those yt-dlp returned at build time.</td></tr>
      <tr><td><code>assets/embeddings.bin</code></td><td>Float32, 384-d, L2-normalized all-MiniLM vectors, one row per video in data.json order. Used for similar videos and semantic search.</td></tr>
      <tr><td><code>STUDY.md</code></td><td>How HackerTube works and how AdsTube was specified from it.</td></tr>
    </table>
    <h2>Your notes</h2>
    <p>Notes stay in this browser until you export them. Open <a href="${href("/notes")}">My notes</a> for a markdown playbook of every Idea / Test / Result you've written.</p>
    <h2>License</h2>
    <p>Comment text remains the work of its authors. Video titles and channel names belong to their creators. This project is not affiliated with YouTube, Google, or Amazon. Do not republish YouTube's raw API metadata as a new dataset; fetch a fresh copy if you need current counts.</p>
  </article>`;
}
function settings() {
  document.title = "Settings - AdsTube";
  view.innerHTML = `<div class="settings">
    <div class="pagehead"><h2>Settings</h2></div>
    <label class="setting">
      <div>
        <b>Show video frames instead of thumbnails</b>
        <p>YouTube thumbnails are designed by uploaders to grab your attention: big faces, arrows, shouting text.
          With this on, every video is shown with a frame from the middle of the video instead, so you see
          what it actually looks like. Turn it off to see the original thumbnails.</p>
      </div>
      <span class="switch"><input type="checkbox" id="frames-toggle" ${useFrames ? "checked" : ""}><span class="knob"></span></span>
    </label>
  </div>`;
  $("#frames-toggle").onchange = (e) => { useFrames = e.target.checked; store.set("frames", useFrames); };
}
function savedPage(title, vids, empty, extra = "") {
  document.title = title + " - AdsTube";
  const res = vids.slice().reverse().map(v => byId.get(v)).filter(Boolean);
  if (!res.length) {
    view.innerHTML = `<div class="pagehead"><h2>${title}</h2>${extra}<p class="sub">${empty}</p></div>`;
    return;
  }
  view.innerHTML = `<div class="pagehead"><h2>${title}</h2>${extra}</div><div class="grid" id="grid"></div>`;
  $("#grid").outerHTML = `<div class="grid">${res.map(card).join("")}</div>`;
  if (res.length) { $(".pagehead").insertAdjacentHTML("beforeend", `<div class="filterbar">${playAll()}</div>`); wirePlayAll(); }
}
const liked = () => savedPage("Liked videos", likes, "Videos you like will show up here, and shape your Home feed.");
const later = () => savedPage("Watch later", watchLater, "Save videos to watch later with the clock button on a thumbnail or on a video's page.");
function historyPage() {
  savedPage("History", seen, "Videos you open will show up here.",
    seen.length ? `<button class="pill" id="clear-history">Clear all watch history</button>` : "");
  const btn = $("#clear-history");
  if (btn) btn.onclick = () => { seen = []; store.set("seen", seen); historyPage(); };
}

function notesPage() {
  document.title = "My notes - AdsTube";
  const rows = Object.entries(notes).filter(([, n]) => n && (n.idea || n.test || n.result))
    .sort((a, b) => (b[1].updated || "").localeCompare(a[1].updated || ""));
  view.innerHTML = `<div class="pagehead"><h2>My notes</h2>
    <p class="sub">Idea, test and result for each video — the start of your Amazon Ads playbook.</p>
    <div class="filterbar"><button class="pill" id="export-md">Export to markdown</button>
      <button class="pill" id="export-json">Export notes JSON</button></div></div>
    ${rows.length ? `<div class="notelist">${rows.map(([vid, n]) => {
      const d = byId.get(vid) || { title: vid, channel: "" };
      return `<div class="notecard">
        <h3><a href="${href("/watch/"+vid)}">${esc(d.title)}</a></h3>
        <div class="sub">${esc(d.channel)}${n.updated ? " · updated " + esc(n.updated.slice(0, 10)) : ""}</div>
        ${n.idea ? `<div class="field"><b>Idea</b><p>${esc(n.idea)}</p></div>` : ""}
        ${n.test ? `<div class="field"><b>Test to run</b><p>${esc(n.test)}</p></div>` : ""}
        ${n.result ? `<div class="field"><b>Result</b><p>${esc(n.result)}</p></div>` : ""}
      </div>`;
    }).join("")}</div>` : `<div class="status">Open a video and fill in Idea / Test / Result. They'll land here.</div>`}`;
  $("#export-md").onclick = () => downloadText("adstube-playbook.md", notesMarkdown());
  $("#export-json").onclick = () => downloadText("adstube-notes.json", JSON.stringify(notes, null, 2));
}
function notesMarkdown() {
  const rows = Object.entries(notes).filter(([, n]) => n && (n.idea || n.test || n.result));
  let md = "# AdsTube playbook\n\nNotes I took while learning Amazon Ads.\n\n";
  for (const [vid, n] of rows) {
    const d = byId.get(vid) || { title: vid, channel: "" };
    md += `## ${d.title}\n\n`;
    md += `- Channel: ${d.channel || "—"}\n- Video: https://www.youtube.com/watch?v=${vid}\n`;
    if (n.updated) md += `- Updated: ${n.updated.slice(0, 10)}\n`;
    md += "\n";
    if (n.idea) md += `### Idea\n\n${n.idea}\n\n`;
    if (n.test) md += `### Test to run\n\n${n.test}\n\n`;
    if (n.result) md += `### Result\n\n${n.result}\n\n`;
  }
  return md;
}
function downloadText(name, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Downloaded " + name);
}

function searchPage(q) {
  document.title = (q ? `“${q}”` : "Search") + " - AdsTube";
  $("#q").value = q;
  const params = filterParams();
  const res = searchVideos(q, params);
  res.results = res.results.slice(0, 60);
  view.innerHTML = filterBar("/search/" + encodeURIComponent(q), params)
    + (res.weak && !res.results.length ? `<div class="note">No videos match “${esc(q)}” with these filters.</div>`
       : res.weak ? `<div class="note">No strong matches for “${esc(q)}”. Here are the closest videos.</div>` : "")
    + `<div class="results">${res.results.map(row).join("")}</div>`;
  wireFilterBar();
}

const playerHTML = (d, autoplay) => `<iframe src="https://www.youtube-nocookie.com/embed/${d.vid}?rel=0${autoplay ? "&autoplay=1" : ""}"
  title="${esc(d.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;


function channelMentions(name) {
  return (DATA.channel_mentions || {})[name] || [];
}
function mentionMeta(m) {
  const reddit = m.source === "Reddit" || String(m.community || "").startsWith("r/");
  const who = reddit ? `u/${m.author || "unknown"}` : `@${m.author || "unknown"}`;
  const when = (m.date || m.ym || "").toString().slice(0, 10);
  const where = m.community || m.source || "";
  const story = m.story || m.thread_title;
  return `<b>${esc(who)}</b> ${esc(when)}${where ? ` · ${esc(where)}` : ""}${story ? ` · in “${esc(story)}”` : ""}`;
}
function renderMentions(list, heading, note) {
  if (!list || !list.length) return "";
  return `<div class="comments">
    <h2>${esc(heading)}</h2>
    ${note ? `<p class="sub cmt-note">${note}</p>` : ""}
    ${list.map(m => `<div class="cmt"><div class="body" style="min-width:0">
      <div class="meta">${mentionMeta(m)}</div>
      <p>${commentHTML(m.text || "")}</p>
      <div class="foot">${m.stance ? `<span class="stance ${m.stance}">${STANCE[m.stance] || m.stance}</span>` : ""}
        ${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">View on ${esc(m.source || "source")}</a>` : ""}</div>
    </div></div>`).join("")}
  </div>`;
}
function recommendedChannelsHTML() {
  const cm = DATA.channel_mentions || {};
  const names = Object.keys(cm);
  if (!names.length) return "";
  return `<h3 class="sechead">Recommended channels</h3>
    <p class="sub">These public Reddit comments recommend a channel, not one specific video. Open the channel to read the full quote and see the videos kept in the library.</p>
    <div class="chrec-list">${names.map(name => {
      const n = DATA.videos.filter(d => d.channel === name).length;
      const quotes = cm[name] || [];
      const excerpt = (quotes[0] && quotes[0].text) || "";
      const short = excerpt.length > 280 ? excerpt.slice(0, 277) + "…" : excerpt;
      return `<a class="chrec" href="${href("/channel/"+encodeURIComponent(name))}">
        <h3 class="vt">${esc(name)}</h3>
        <div class="sub">${n} video${n === 1 ? "" : "s"} in the library · ${quotes.length} Reddit recommendation${quotes.length === 1 ? "" : "s"}</div>
        ${short ? `<p class="chrec-quote">${commentHTML(short)}</p>` : ""}
      </a>`;
    }).join("")}</div>`;
}
function channelPage(name) {
  const vids = DATA.videos.filter(d => d.channel === name);
  if (!vids.length) return notFound();
  document.title = `${name} - AdsTube`;
  const params = filterParams();
  const items = sortList(vids.filter(d => passesFilters(d, params)), { ...params, sort: params.sort || "recent" });
  view.innerHTML = `<div class="pagehead"><a class="crumb" href="${href("/browse?src=seller")}">Recommended by the community</a>
    <h2>${esc(name)}</h2>
    <p class="sub">${vids.length} video${vids.length === 1 ? "" : "s"} in the library</p></div>
    ${renderMentions(channelMentions(name), "What people said about this channel",
      "These comments recommend the channel, not one specific video.")}
    ${filterBar("/channel/"+encodeURIComponent(name), params, true)}
    <div class="grid" id="grid"></div>`;
  wireFilterBar();
  infinite($("#grid"), items);
}

function recLine(d) {
  const r = d.rec || {};
  const bits = [];
  if (r.recommenders) {
    bits.push(`${r.recommenders} community recommendation${r.recommenders === 1 ? "" : "s"}` +
      (r.rec_months ? ` · recommended in ${r.rec_months} month${r.rec_months === 1 ? "" : "s"}` : "") +
      (r.first && r.last ? `, ${r.first}–${r.last}` : ""));
  }
  if ((d.tiers || []).includes("expert")) {
    const lab = d.expert_label && d.expert_label !== d.channel ? ` · ${d.expert_label}` : "";
    bits.push("From the experts" + lab);
  }
  return bits.join(" · ") || d.channel;
}

function watch(vid) {
  const d = byId.get(vid);
  if (!d) return notFound();
  document.title = `${d.title} - AdsTube`;
  markSeen(d.vid);
  const comments = DATA.mentions[d.vid] || d.comments || [];
  const n = notes[d.vid] || { idea: "", test: "", result: "" };
  view.innerHTML = `<div class="watch">
    <div class="primary">
      <div class="player" id="player">${useFrames
        ? `<button class="poster" id="poster" aria-label="Play ${esc(d.title)}">
             <img src="${frameSrc(d.vid)}" data-vid="${d.vid}" onerror="thumbFallback(this)" alt="">
             <span class="play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></button>`
        : playerHTML(d, false)}</div>
      <h1>${esc(d.title)}</h1>
      <div class="owner">
        <div class="who"><div style="min-width:0"><b><a href="${href("/channel/"+encodeURIComponent(d.channel))}">${esc(d.channel)}</a></b><span class="sub">${esc(recLine(d))}</span></div></div>
        <div class="actions">
          <div class="seg">
            <button id="like" class="${likes.includes(d.vid) ? "on" : ""}" aria-label="Like"><svg viewBox="0 0 24 24"><path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h14.43c1.06 0 1.98-.67 2.19-1.61l1.34-6c.27-1.24-.78-2.39-2.19-2.39zM7 20H4v-8h3v8z"/></svg><span>Like</span></button>
            <button id="dislike" class="${dislikes.includes(d.vid) ? "on" : ""}" aria-label="Dislike"><svg viewBox="0 0 24 24"><path d="M17 4h-1H6.57c-1.07 0-1.98.67-2.19 1.61l-1.34 6C2.77 12.85 3.82 14 5.23 14h4.23l-1.52 4.94C7.62 19.97 8.46 21 9.62 21c.58 0 1.14-.24 1.52-.65L17 14h4V4h-4zm-6.6 15.67c-.19.21-.48.33-.78.33-.26 0-.5-.11-.63-.3-.07-.1-.15-.26-.09-.47l1.52-4.94.4-1.29H5.23c-.41 0-.8-.17-1.03-.46-.12-.15-.25-.4-.18-.72l1.34-6c.1-.47.61-.82 1.21-.82H16v8.61l-5.6 6.06zM20 13h-3V5h3v8z"/></svg></button>
          </div>
          <button class="pill" id="save-later">${watchLater.includes(d.vid) ? CHECK + "Saved" : CLOCK + "Watch later"}</button>
          <a class="pill" href="https://www.youtube.com/watch?v=${d.vid}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>YouTube</a>
        </div>
      </div>
      <div class="desc">
        <div class="top-line">${[views(d.views), ago(d.published), d.content_type, d.level, d.shelf_life === "dated" ? "dated" : ""].filter(Boolean).map(esc).join(" · ")}</div>
        ${d.summary ? `<p>${esc(d.summary)}</p>` : ""}
        ${d.why ? `<p class="why">${esc(d.why)}</p>` : ""}
        <div class="tags">${(d.categories || []).map(c => `<a class="tag cat" href="${href("/c/"+c.id)}">${esc(c.name)}</a>`).join("")}
          ${d.level ? `<span class="level ${esc(d.level)}">${esc(d.level)}</span>` : ""}</div>
      </div>
      <div class="notesbox" id="notesbox">
        <h2>My notes</h2>
        <p class="hint">Capture one idea, a test to run on a real account, and what happened. These stay in this browser and show up on the Notes page.</p>
        <label for="note-idea">Idea</label>
        <textarea id="note-idea" placeholder="What's the idea, and why does it work?">${esc(n.idea || "")}</textarea>
        <label for="note-test">Test to run</label>
        <textarea id="note-test" placeholder="e.g. Move the top 5 search terms to exact match and lower broad bids 20%.">${esc(n.test || "")}</textarea>
        <label for="note-result">Result</label>
        <textarea id="note-result" placeholder="What happened after 7–14 days?">${esc(n.result || "")}</textarea>
        <div class="saved" id="note-saved">${n.updated ? "Saved " + esc(n.updated.replace("T", " ").slice(0, 16)) : "Not saved yet"}</div>
      </div>
      ${renderMentions(comments, "What people said")}
      ${renderMentions(channelMentions(d.channel), "What people said about this channel",
        "These comments recommend the channel, not this specific video.")}
      ${!comments.length && !channelMentions(d.channel).length
        ? `<div class="comments"><h2>Comments</h2><p class="sub">No public recommending comments were found for this video. It's on the expert shelf.</p></div>` : ""}
    </div>
    <div class="secondary" id="upnext"></div>
  </div>`;
  $("#like").onclick = () => vote(d.vid, likes, dislikes, "#like", "#dislike");
  $("#dislike").onclick = () => vote(d.vid, dislikes, likes, "#dislike", "#like");
  $("#save-later").onclick = () => { $("#save-later").innerHTML = toggleLater(d.vid) ? CHECK + "Saved" : CLOCK + "Watch later"; };
  const poster = $("#poster");
  if (poster) poster.onclick = () => { $("#player").innerHTML = playerHTML(d, true); };
  const saveNotes = () => {
    notes[d.vid] = {
      idea: $("#note-idea").value, test: $("#note-test").value, result: $("#note-result").value,
      updated: new Date().toISOString(),
    };
    store.set("notes", notes);
    $("#note-saved").textContent = "Saved " + notes[d.vid].updated.replace("T", " ").slice(0, 16);
  };
  for (const id of ["note-idea", "note-test", "note-result"]) {
    let t; $(`#${id}`).addEventListener("input", () => { clearTimeout(t); t = setTimeout(saveNotes, 400); });
  }
  const relIds = (DATA.related[d.vid] || []).map(x => x.vid || x);
  const rel = (emb ? similarTo(d.vid, 20) : []).concat(relIds.map(v => byId.get(v)).filter(Boolean));
  const seenR = new Set([d.vid]);
  const uniq = [];
  for (const x of rel) { if (x && !seenR.has(x.vid)) { seenR.add(x.vid); uniq.push(x); } }
  $("#upnext").innerHTML = uniq.slice(0, 20).map(next).join("") || `<div class="status">No related videos yet.</div>`;
}

function vote(vid, list, other, me, them) {
  const i = list.indexOf(vid);
  if (i >= 0) list.splice(i, 1); else { list.push(vid); const j = other.indexOf(vid); if (j >= 0) other.splice(j, 1); }
  store.set("likes", likes); store.set("dislikes", dislikes);
  $(me).classList.toggle("on", list.includes(vid)); $(them).classList.remove("on");
}
function notFound() { document.title = "Not found - AdsTube"; view.innerHTML = `<div class="status">Not found.</div>`; }

async function route() {
  const { path } = loc();
  const [, page, ...rest] = path.split("/");
  const arg = decodeURIComponent(rest.join("/"));
  document.title = "AdsTube";
  document.body.classList.remove("drawer");
  const helpEl = $("#help");
  if (helpEl) helpEl.classList.remove("on");
  selected = -1;
  const full = path + (loc().search.toString() ? "?" + loc().search.toString() : "");
  for (const a of document.querySelectorAll(".side a")) {
    const hrefA = (a.getAttribute("href") || "").replace(/^#/, "");
    a.classList.toggle("on", hrefA === full || hrefA === path || (page === "browse" && hrefA.startsWith("/browse") && loc().search.get("dur") === "xlong" && a.dataset.nav === "longs"));
  }
  if (page !== "search") $("#q").value = "";
  if (pager) { pager.disconnect(); pager = null; }
  try {
    if (!page) await home();
    else if (page === "c") category(arg);
    else if (page === "categories") categoriesPage();
    else if (page === "playlists") playlistsPage();
    else if (page === "p") playlistPage(arg);
    else if (page === "a") area(arg);
    else if (page === "browse") browsePage();
    else if (page === "channel") channelPage(arg);
    else if (page === "watch") watch(arg);
    else if (page === "search") searchPage(arg);
    else if (page === "liked") liked();
    else if (page === "history") historyPage();
    else if (page === "later") later();
    else if (page === "notes") notesPage();
    else if (page === "about") about();
    else if (page === "settings") settings();
    else if (page === "data") dataPage();
    else notFound();
  } catch (e) { view.innerHTML = `<div class="status">Something went wrong (${esc(e.message)}).</div>`; }
  window.scrollTo(0, 0);
}
addEventListener("hashchange", route);

$("#search").addEventListener("submit", (e) => {
  e.preventDefault(); const q = $("#q").value.trim();
  $("#q").blur();
  navigate(q ? withParams(`/search/${encodeURIComponent(q)}`, filterParams()) : "/");
});
$("#menu").onclick = () => {
  if (matchMedia("(max-width: 800px)").matches) document.body.classList.toggle("drawer");
  else { document.body.classList.toggle("collapsed"); store.set("collapsed", document.body.classList.contains("collapsed")); }
};
$("#scrim").onclick = () => document.body.classList.remove("drawer");
function onLaterButton(e) {
  const b = e.target instanceof Element && e.target.closest("[data-later]");
  if (!b || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
  e.preventDefault(); e.stopPropagation();
  const on = toggleLater(b.dataset.later);
  b.outerHTML = laterBtn(b.dataset.later);
  if (!on && loc().path === "/later") later();
}
document.addEventListener("click", onLaterButton, true);
document.addEventListener("keydown", onLaterButton, true);
$("#theme").onclick = () => {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const cur = document.documentElement.dataset.theme || (dark ? "dark" : "light");
  const t = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t; store.set("theme", t);
};
if (store.get("collapsed", false)) document.body.classList.add("collapsed");

let selected = -1;
const listItems = () => [...view.querySelectorAll(".vcard, .srow, .next")];
const vidOf = (el) => el?.getAttribute("href")?.split("/").pop();
function select(i) {
  const list = listItems();
  if (!list.length) return;
  selected = Math.max(0, Math.min(i, list.length - 1));
  list.forEach((el, j) => el.classList.toggle("kbd", j === selected));
  list[selected].scrollIntoView({ block: "nearest" });
}
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 1800);
}
function keyLike(vid) {
  const i = likes.indexOf(vid);
  if (i >= 0) likes.splice(i, 1); else { likes.push(vid); dislikes = dislikes.filter(v => v !== vid); }
  store.set("likes", likes); store.set("dislikes", dislikes);
  if (loc().path === `/watch/${vid}`) { $("#like")?.classList.toggle("on", likes.includes(vid)); $("#dislike")?.classList.remove("on"); }
  toast(likes.includes(vid) ? "Added to Liked" : "Removed from Liked");
}
function keyLater(vid) {
  const on = toggleLater(vid);
  document.querySelectorAll(`[data-later="${vid}"]`).forEach(b => { b.outerHTML = laterBtn(vid); });
  if (loc().path === `/watch/${vid}` && $("#save-later")) $("#save-later").innerHTML = on ? CHECK + "Saved" : CLOCK + "Watch later";
  toast(on ? "Saved to Watch later" : "Removed from Watch later");
}
const SHORTCUTS = [["/", "Search"], ["j / k", "Next / previous video"], ["Enter", "Open the selected video"],
  ["l", "Like the selected or current video"], ["w", "Watch later for the selected or current video"],
  ["p", "Play (on a video page)"], ["h", "Home"], ["?", "Show these shortcuts"], ["Esc", "Close / leave the search box"]];
function toggleHelp(force) {
  const h = $("#help");
  const show = force ?? !h.classList.contains("on");
  h.innerHTML = `<div class="help-card" role="dialog" aria-label="Keyboard shortcuts"><h3>Keyboard shortcuts</h3>
    <table>${SHORTCUTS.map(([k, d]) => `<tr><td>${k.split(" / ").map(x => `<kbd>${esc(x)}</kbd>`).join(" / ")}</td><td>${esc(d)}</td></tr>`).join("")}</table></div>`;
  h.classList.toggle("on", show);
}
$("#help").onclick = (e) => { if (e.target.id === "help") toggleHelp(false); };
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement;
  const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  if (e.key === "Escape") {
    if (typing) el.blur();
    toggleHelp(false); document.body.classList.remove("drawer");
    return;
  }
  if (typing) return;
  const sel = listItems()[selected];
  const watching = loc().path.startsWith("/watch/") ? loc().path.split("/")[2] : null;
  const target = vidOf(sel) || watching;
  const key = e.code === "Slash" && e.shiftKey ? "?" : e.key;
  switch (key) {
    case "/": e.preventDefault(); $("#q").focus(); $("#q").select(); break;
    case "j": select(selected + 1); break;
    case "k": select(selected - 1); break;
    case "Enter": if (sel) { e.preventDefault(); navigate(sel.getAttribute("href")); } break;
    case "l": if (target) keyLike(target); break;
    case "w": if (target) keyLater(target); break;
    case "p": $("#poster")?.click(); break;
    case "h": navigate("/"); break;
    case "?": toggleHelp(); break;
    default: return;
  }
});

async function boot() {
  try {
    DATA = await fetch("data.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  } catch (e) {
    view.innerHTML = `<div class="status">Couldn't load data.json (${esc(e.message)}).</div>`;
    return;
  }
  DATA.videos.forEach((d, i) => { d._i = i; byId.set(d.vid, d); });
  buildInverted();
  try {
    const buf = await fetch("assets/embeddings.bin").then(r => r.ok ? r.arrayBuffer() : null);
    if (buf) {
      emb = new Float32Array(buf);
      embRows = Math.floor(emb.length / DIM);
    }
  } catch {}
  route();
}
boot();
