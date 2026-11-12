# AdsTube study notes: HackerTube, TristanTube, and the community-recommendation method

Researched on 11 November 2026 (Asia/Calcutta). Live sources opened this turn: [hackertube.org](https://hackertube.org), the official data export, [karpathy.ai/tristan-tube](https://karpathy.ai/tristan-tube/), Karpathy's blog, EngineerPal, The Decoder, the HN thread, and Karpathy's X thread.

This note is the build spec for AdsTube. AdsTube should match HackerTube's feature set and UX, apply the same "videos people keep recommending to each other" method to Amazon seller/PPC communities, and add an expert-channel corpus as a second tier so the library is not thin.

---

## 1. What HackerTube is

Karpathy opened YouTube, saw "an enshittified wall of slop" (exaggerated thumbnails, tired recommendations), and the next morning asked Claude Opus 5.5 in Claude Code to build a YouTube-style site restricted to videos Hacker News keeps recommending. Result: [hackertube.org](https://hackertube.org), shipped 31 October 2026, announced on X on 1 November 2026.

Headline numbers (from `/api/stats` and the export, generated 2026-10-31):

- 6,454 videos (2007–2026)
- 39,834 labeled HN comments
- 15,041 distinct recommenders
- 150 topics in 16 areas
- 27 Claude-curated playlists
- ~6% of originally linked videos later deleted/private (hidden in the live UI once YouTube metadata is fetched)

It does not host video. Playback is YouTube's privacy-enhanced embed (`youtube-nocookie.com`). The About page states it is not affiliated with YouTube, Google, Hacker News or Y Combinator.

Karpathy did not publish the server code ("a vibe coded mess"). Reuse is meant to start from the data zip, not a drop-in clone of the backend.

---

## 2. Karpathy's X thread (required source)

**Announcement:** [https://x.com/karpathy/status/2116957135661945283](https://x.com/karpathy/status/2116957135661945283)
Posted 1 Nov 2026, 18:14 UTC (11:44 PM IST). Full text from `note_tweet`:

> Weekend hack: HackerTube. I was annoyed with YouTube's recommendations so I had Claude filter down 43M comments over 20 years of HN to 6,454 videos that keep being recommended. *Significantly* better viewing experience, ~2 hours with Opus 5.5:
> https://hackertube.org/
>
> - Excellent recs without any logins (state is kept in local browser session)
> - Thumbnail is a representative frame from middle of the video instead of the super duper A/B test hyper-optimized user uploads
> - Underlying data from the comment analysis as one zip file, point your Claude at it and ask for your own version
> - HackerTube Longs ✊
>
> A bit more on the process:
> I use Claude Code (desktop app for Mac), Opus 5.5 on Medium effort as my default. I only talk to Claude and have it do everything, the only "manual work" I helped with in tandem was in the browser (reminiscent of MenuGen): 1) I had to create some kind of API key from Google Cloud UI to query YouTube for video metadata, 2) I booted up a VPS box for serving and 3) I bought the domain name. Once the box was up I gave Claude the IP and told it update, secure, harden, deploy and optimize the code, and it did the whole thing.
>
> Many awesome projects that would have normally taken weeks/months even can now be few-shotted for breakfast. What else are we not thinking of.

**The filtering pipeline, in his own reply** to @eyadnour
([https://x.com/karpathy/status/2116970707867566106](https://x.com/karpathy/status/2116970707867566106), 1 Nov 2026, 19:08 UTC / 12:38 AM IST on 2 Nov):

> Oh tbc Claude filtered it down a lot: urls, regexes, dropping spam, only the remainder was dispatched to Sonnet with a CC Workflow (so it uses the sub tokens). You can see surviving comments under videos, the comments that recommend videos seem to be of nice & helpful character.

That is the method AdsTube must copy:

1. Cheap pass first: find YouTube URLs, regexes, drop spam and drive-bys.
2. Only send the remainder to a judge (he used Sonnet in a Claude Code Workflow; we label with heuristics plus judgment and keep the reasons).
3. Show the surviving recommending comments under each video.

A jokey prompt-summary reply also exists ([https://x.com/karpathy/status/2116980174667583602](https://x.com/karpathy/status/2116980174667583602)): "build me a YouTube-style site but restricted to videos that have been repeatedly recommended on HN over the years."

On HN he added cost color: 504M input tokens (90% cached) and 7.6M output tokens, more than 90% spent on Sonnet labeling; the app and deploy were about 1M Opus tokens. He shipped live requests from the thread (date/duration/type filters, "Recently recommended", like-ratio sort, "Play all on YouTube", Longs). He removed a YouTube-looking logo after a commenter warned it could draw Google's attention.

---

## 3. How the corpus was built (DATA.md + About + X)

From `DATA.md` in the official zip, the About page, and the X reply:

1. Scan every HN comment 2007–2026 (the [open-index/hacker-news](https://huggingface.co/datasets/open-index/hacker-news) archive) for YouTube links. A mention counts only if the comment has at least **100 characters of its own text**.
2. Cheap filtering (URLs, regexes, drop spam) happens before any LLM work. Only the remainder goes to Sonnet.
3. A video is included if at least **3 different people** mentioned it, in at least **3 different months**. Up to 20 mentions per video are kept, favouring different commenters.
4. Sonnet 5.5 reads each remaining comment plus the HN story title and labels: stance, topics, a short "why", a verbatim quote.
5. Each video gets a card (summary, why HN likes it, content type, level, shelf life, topics) written from mentions + YouTube metadata.
6. Videos are assigned 1–3 categories from a shared taxonomy (16 areas / 150 categories), drafted from the data.
7. Rank by lasting recommendations, not one viral spike: `score = rec_months + 0.5 × months with a strong recommendation`.

Stances: `strong_rec`, `rec`, `reference`, `joke`, `critical`. Only `rec` and `strong_rec` count as recommendations. About 25% of videos in the export were only cited (`hn.recommenders == 0`). `shelf_life == "news"` (407 videos) should be hidden by default in most UIs. Mentions text is cut at 1,500 characters; the linked video is replaced with `[VIDEO]` and other links with `[LINK]`.

LLM labels are "good, but expect a few percent of noise."

---

## 4. Data schema (official export)

Downloaded from `https://hackertube.org/download/hackertube-data.zip` (17,842,799 bytes, matches `/api/export`). License: **ODC-By 1.0**. YouTube's own metadata is **not** in the zip and must not be redistributed (descriptions, view counts, durations, publish dates, tags, deletion status). Every row has a video id so a later owner can fetch those with a YouTube Data API key. Thumbnails need no API.

| File | One row is | Key | Notes |
|---|---|---|---|
| `videos.jsonl` | a video (6,454, best-scored first) | `vid` | title, channel, summary, why_hn, content_type, level, shelf_life, primary_topic, tags, categories[1–3], quote, hn stats, score |
| `mentions.jsonl` | a labeled HN comment (39,834) | `hn_comment_id` + `vid` | author, month, story_title, stance, why, quote, cleaned text |
| `taxonomy.json` | topic tree | category `id` | `{version, areas: [{id, name, categories: [{id, name, description}]}]}`. Descriptions are synonym-rich and used for search. |
| `related.jsonl` | co-recommendation edges (3,778 videos) | `vid` | `related: [{vid, shared_recommenders}]`, up to 20, no usernames |
| `embeddings.npy` + `embedding_ids.json` | 384-d vector per video | row index | float16 `[6454, 384]`, L2-normalized, **BAAI/bge-small-en-v1.5** (fastembed ONNX quant). Embedded: title, channel, topics, categories, summary, HN "whys". **No instruction prefix.** |
| `DATA.md` | agent docs | — | joins, gotchas, examples, YouTube fetch script, license |

Live API video objects add YouTube fields fetched separately: `published`, `duration_s`, `views`, `likes`, plus `whys` and `hn_related`. Comments on the watch page use `{id, author, ym, story, stance, why, quote, text}`.

Content types observed: talk, explainer, demo, comedy, commentary, documentary, interview, lecture, tutorial, podcast, course, news, music, other. Levels: mostly `general`, then intermediate / intro / advanced. Shelf life: evergreen 4,546, dated 1,501, news 407. Most videos have 2 or 3 categories.

---

## 5. Live site architecture and every page

HackerTube is a **single HTML document** (~68 KB) with inline CSS (~19 KB, 285 lines) and inline JS (~44 KB, 728 lines). There is no separate JS bundle. The server returns this same page for every path so URLs are shareable (`/watch/<id>`, `/search/<q>`, `/c/<topic>`, `/a/<area>`, `/p/<slug>`, `/browse?...`). Client navigation uses `pushState`. Legacy `/#/watch/<id>` hashes are rewritten to real paths.

**HTTP APIs the UI calls:**

| Endpoint | Role |
|---|---|
| `/api/config` | `{frames_source: "youtube" \| "local"}` |
| `/api/feed?like&dislike&seen&seed&offset&n` | Home / For You |
| `/api/list?cat\|area&filters&offset&n` | topic, area, browse, Longs |
| `/api/browse` | areas with category counts |
| `/api/search?q&filters` | semantic search |
| `/api/video?vid=` | video card + comments |
| `/api/related?vid=&n=` | up-next (embeddings + HN co-recs) |
| `/api/docs?vids=` | hydrate liked / history / watch-later ids |
| `/api/playlists`, `/api/playlist?slug=` | curated lists |
| `/api/stats`, `/api/export` | About and Data pages |

AdsTube is a static site, so the same behaviour must run **client-side** against shipped `data.json` + embeddings.

### Chrome (every page)

- Fixed 56px top bar: hamburger, wordmark `Hacker` + accent `Tube` (HN orange `#ff6600`, not a YouTube play-button logo), rounded search field, About icon, theme toggle.
- Left sidebar (240px, collapsible to 72px icon rail; drawer + scrim under 800px): Home, Longs, Liked, History, Watch later, Categories, Playlists, Settings.
- Light/dark: follows `prefers-color-scheme`, override stored in `localStorage` key `theme`. Dark tokens match YouTube (`#0f0f0f` background, `#272727` chips).
- Font: 14px/1.4 Roboto, Segoe UI, system sans. Accent orange; link/active blue (`#065fd4` / `#3ea6ff` in dark).
- Keyboard help modal (`?`) and toast region live in the shell.

### Pages

**Home / For You (`/`).** Infinite-scroll grid (36 per page). A fresh random `seed` is chosen on each full page load so reload reshuffles, but going to a video and back keeps the same seed. Home is a **mix of sources**, not a single popularity sort. Hovering a card shows `title=reason`. Observed `source` values and reason copy from a live `/api/feed` call:

| `source` | Reason copy (examples) | When it appears |
|---|---|---|
| `classics` | "An HN classic" | High-standing, well-known videos |
| `gems` | "Hidden gem: loved on HN, little-watched on YouTube" | Strong HN love, low YT views (UI defines hidden gems as under 100k views) |
| `recent` | "Recent on HN" | Recently recommended |
| `explore` | "Explore: {area name}" | Topics you haven't opened yet |
| `deep` | "Deep cut: recommended on HN, rarely surfaced" | Recommended but rarely shown |
| `wildcard` | "Random pick" | Variety |
| `similar` | "Because you liked “{title}”" | After likes; embedding neighbours |
| `corec` | "HN people who recommended “{title}” also recommend this" | `related.jsonl` overlap |
| `taste` | "Matches your taste" | Broader like-steered match |

The feed is also told `like`, `dislike`, and `seen` (opened videos, last 200, kept out of Home). Filters on Home jump to `/browse`.

**Video / watch (`/watch/<vid>`).** If "video frames" is on, the player starts as a mid-video frame plus a play button (so YouTube's clickbait poster never flashes); click loads the nocookie embed with `autoplay=1&rel=0`. Title, channel, recommender line ("N HN recommenders · recommended in M months, first–last"), like / dislike / Watch later / open on YouTube. Description block: views · relative date · type · shelf life, then `summary`, `why_hn`, topic chips and `#tags`. Then **"N comments from Hacker News"** — real comments with `@author`, year, story title, cleaned text (`[VIDEO]` becomes a "▶ this video" pill), stance badge (Strongly recommends / Recommends / Cites / Joke / Critical), and a link back to the HN item. Right column: 20 related videos.

**Categories (`/categories`).** Quick pills: Recently recommended, Longs, Hidden gems, All videos. Then one card per area, each category with a count, linking to `/a/<area>` and `/c/<id>`.

**Area and topic pages.** Breadcrumb, filter bar, infinite grid ordered "Best first" (most recommended) unless a sort is chosen.

**Playlists (`/playlists`, `/p/<slug>`).** 27 lists in two tiers: "Start here" (broad essentials) and "Deep dives" (one obsession). Each has title, pitch, cover mosaic of 4 mid-frames, count, duration, a Claude-written intro, per-video notes, and "Play all on YouTube".

**Longs.** `/browse?dur=xlong` — every video over one hour. "The opposite of Shorts." Added after an HN joke about HackerTube Shorts.

**Search (`/search/<q>`).** "Understands topics, not just keywords." Live `/api/search?q=distributed%20systems` returned `{weak, results[]}` with `relevance` and sometimes `via` (e.g. "Topic match · Distributed systems" in the row UI). Weak=true shows a "no strong matches / here are the closest" note. Filters carry over from the previous page. 429/503 get a polite retry message.

**Browse / filters.** YouTube-style filter panel, all options are query params so views are shareable:

- Upload date: Past year, 2020s, 2010s, 2000s
- Type: talk, lecture, explainer, tutorial, documentary, interview, demo, commentary, comedy, music
- Duration: Under 4 min, 4–20, 20–60, Over 1 hour
- Features: Hidden gems, Evergreen only
- Sort: Relevance / Best first, Recently recommended, Upload date, Oldest, View count, Like ratio, Most recommended

**Play all on YouTube** builds `https://www.youtube.com/watch_videos?video_ids=...` from up to 50 ids on the page (works on phones/TVs, no API).

**Liked (`/liked`), History (`/history`), Watch later (`/later`).** Hydrated from local ids. History can be cleared. Clock button on every thumbnail toggles Watch later without following the card link.

**Settings (`/settings`).** One toggle, **on by default**: "Show video frames instead of thumbnails." Copy explains that uploader thumbnails are designed to grab attention; the mid-frame shows what the video actually looks like. Stored as `localStorage.frames`.

**About (`/about`) and Data (`/data`).** Origin story, five-step build, what you can do, fork/export table, ODC-By, privacy (no accounts; likes/history/watch later only in this browser; privacy-enhanced embed), credits, unaffiliated disclaimer. Data page has a one-click zip download and a copyable agent prompt.

### Mid-frame thumbnails

- On (default): `https://i.ytimg.com/vi/<vid>/hq2.jpg` (YouTube's automatic frame from the middle of the video). Optional server mode can serve `/frames/<vid>.jpg`.
- Off: `https://i.ytimg.com/vi/<vid>/hqdefault.jpg` (uploader thumbnail).
- `onerror` fallback: local frame → hq2.jpg → hqdefault.jpg.

### localStorage keys

`likes`, `dislikes`, `seen` (max 200), `later`, `frames` (default true), `theme`, `collapsed`. No accounts.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `/` | Focus search |
| `j` / `k` | Next / previous video in the on-page list |
| `Enter` | Open the selected video |
| `l` | Like selected or current |
| `w` | Watch later for selected or current |
| `p` | Play (on a video page, clicks the mid-frame poster) |
| `h` | Home |
| `?` | Shortcut help |
| `Esc` | Close help, close drawer, blur search |

### Search and related-video approach

- Document embeddings: bge-small-en-v1.5, 384-d, L2-normalized, no prefix, over title + channel + topics + categories + summary + recommendation "whys".
- Query: embed the same way, take **dot products** (equivalent to cosine on L2-normalized vectors).
- HackerTube's live search also **reranks** the top few dozen hits with `jinaai/jina-reranker-v1-turbo-en`. For a static site we ship vectors and do cosine in the browser; keyword match on title/channel/topic is blended so typo-free exact titles still win; topic `via` chips can be shown when a taxonomy description matches.
- Related videos: nearest neighbours in the same vector space, plus co-recommendation edges when we have them.

---

## 6. TristanTube (closest channel-list model)

[https://karpathy.ai/tristan-tube/](https://karpathy.ai/tristan-tube/) — Karpathy's follow-up, "one-shotted with Claude Code in 3 minutes" from Tristan Hume's 2026 YouTube tier list. 156 channels, **47,339** videos, one public `videos.json` (~3.8 MB).

This is the closest precedent for AdsTube's **expert-channel tier**: a hand-picked channel list, catalogued with yt-dlp (regular videos only, no Shorts or livestreams), presented in a YouTube-like UI.

Schema (compact, not HN-style cards):

- `channels[]`: `{name, url, tier: S..D, tag, blurb, featured, n}`
- `videos[]`: `[id, title, duration_s, views, ch_index]` (no upload date in the file we inspected)

For You is **not** HackerTube's recommender. It picks a channel at random weighted by tier (S×10, A×6, B×4, C×2.5, D×1) so huge catalogues don't drown small S-tier channels, then draws two random videos and shows the one with more views. Filters: tier chips, "Tristan's picks", under 10 min / 30+ min. Channel pages quote Tristan's write-up. Extra: Surprise me, TV mode (T) — fullscreen random playback — dark mode, search (`/`), About. State is minimal (theme, autoplay). There are no mid-frame comments, no semantic embeddings, no Longs-as-a-shelf in the HackerTube sense, no likes-steer-the-feed.

AdsTube should take **HackerTube's product** (comments, embeddings, For You mix, Longs, playlists, mid-frames, shortcuts) and **TristanTube's acquisition method** (yt-dlp over a verified expert channel list) as the second corpus tier.

---

## 7. Other write-ups checked

- Karpathy's blog, 31 Oct 2026: [https://karpathy.bearblog.dev/hacker-tube/](https://karpathy.bearblog.dev/hacker-tube/) — origin story, 6,454 videos / 150 topics, mid-frame, For You without accounts, shortcuts, data zip. Manual work: API key, VPS, domain.
- EngineerPal, 2 Nov 2026: [https://engineerpal.com/karpathy-hackertube/](https://engineerpal.com/karpathy-hackertube/) — UI tour (Settings toggle wording, Categories, Longs origin, export contents, "at least three different people in three different months", Claude judged recommendation vs citation vs joke vs criticism, rank by distinct months).
- The Decoder, 8 Nov 2026: [https://the-decoder.com/andrej-karpathy-built-a-curated-video-platform-in-a-weekend-using-claude-and-20-years-of-hacker-news/](https://the-decoder.com/andrej-karpathy-built-a-curated-video-platform-in-a-weekend-using-claude-and-20-years-of-hacker-news/) — same facts; notes TristanTube as the immediate follow-up.
- HN story: [https://news.ycombinator.com/item?id=50319510](https://news.ycombinator.com/item?id=50319510) — announcement plus changelog and the "don't ship a YouTube-looking logo" warning.
- eraofminds TristanTube explainer: confirms yt-dlp catalogues, tier-weighted For You, 47,339 videos.

---

## 8. What AdsTube must do with this

**Product:** Match HackerTube's pages and UX (Home/For You, watch with comments, Categories, Playlists, Longs, Search, Settings mid-frame toggle, About, History, Liked, Watch later, keyboard shortcuts, Play all, filters, data export). Distinct branding (not a YouTube play-button logo; not HN orange as if we were HackerTube). About must say AdsTube is not affiliated with YouTube, Google, or Amazon.

**Vamsy-only additions:** per-video Notes (Idea / Test to run / Result) in localStorage, a Notes page, export-to-markdown, and a JSON data export of the library.

**Corpus — two tiers, community first:**

1. **Recommended by sellers** (primary signal, HackerTube method). Mine public places where Amazon sellers and PPC people recommend videos to each other: Reddit (`r/FulfillmentByAmazon`, `r/AmazonSeller`, `r/AmazonFBA`, `r/PPC`, `r/AmazonFBATips`, `r/AmazonVendor`, and close cousins), Hacker News, and any other public seller forum that is reachable. Cheap filter (YouTube URLs, regexes, spam, short drive-bys). Label the remainder (stance + why). Keep recommending comments (text, author, date, link, source) and show them under the video. Score by distinct recommenders / months when the data supports it. Do not invent metadata.
2. **From the experts** (second tier, TristanTube method). yt-dlp flat catalogues of verified Amazon Ads expert and official channels, title-filtered for high-quality ads education (drop fluff, get-rich, dropshipping hype, shorts under ~3 minutes). Label these clearly so the site is honest when a video is in the library because an expert published it, not because a seller recommended it. A video can be in both tiers.

**Search:** ship 384-d embeddings (sentence-transformers `all-MiniLM-L6-v2` or bge-small-en-v1.5 if it installs cleanly), L2-normalized, client-side cosine / dot product, plus keyword fallback.

**For You:** port the HackerTube mix (classics, hidden gems, recent last-12-months, unexplored topics, deep cuts, wildcards, similar-to-likes, seller co-recs, expert-tier seasoning), with hover reasons, likes/history in localStorage, seen videos held out.

**Taxonomy:** a rich Amazon-ads tree (~8 areas, ~30–40 topics), 1–3 topics per video, synonym-rich descriptions for search.

**Honesty rules:** never invent YouTube title/channel/duration/views/date; only use yt-dlp (or comment) fields we actually retrieved. If duration or date is missing, omit it. Mid-frames always use `hq2.jpg`.

---

## 9. Feature-by-feature comparison (build checklist)

| Feature | HackerTube | TristanTube | AdsTube target |
|---|---|---|---|
| Mid-frame thumbs, Settings toggle default on, hq2.jpg fallback | Yes | Uploader thumbs | Yes, HackerTube behaviour |
| For You without accounts | Yes, multi-source mix steered by likes | Random tier-weighted channel sample | HackerTube mix, adapted to sellers + experts |
| Hover "why it's recommended" | Yes | Channel blurb on channel page | Yes (seller rec, expert channel, similar, etc.) |
| Categories / areas / topics | 16 areas, 150 topics | Channels by S–D tier | ~8 areas, ~30–40 Amazon-ads topics |
| Playlists with intro + per-video notes | 27 Claude lists | No | Yes, curated ads learning paths |
| Longs (over 1 hour) | Yes | Length chips only | Yes |
| Semantic search (shipped embeddings, cosine) | bge-small + reranker | Keyword-ish client search | Client cosine + keyword blend |
| Related videos | Embeddings + co-recs | Same channel / random | Embeddings + co-recs |
| Comments under the video | Labeled HN comments + stance + source link | No | Seller/HN/forum recs + stance + source link |
| Like / dislike / history / watch later in localStorage | Yes | No (theme/autoplay only) | Yes |
| Keyboard: `? / j k Enter l w p h Esc` | Yes | `/`, `T` TV mode, some player keys | HackerTube set (no TV mode required) |
| Play all on YouTube | Yes | No | Yes |
| Shareable filters (date, type, duration, gems, evergreen, sort) | Yes | Tier / length chips | Yes, ads-relevant types |
| About + unaffiliated disclaimer | Yes | Yes | Yes (YouTube / Amazon) |
| Data export zip + schema doc | ODC-By zip, DATA.md | videos.json only | JSON download + markdown notes export |
| YouTube-nocookie embed, poster-then-play when frames on | Yes | Direct embed | Yes |
| Dark/light, mobile drawer, YouTube-like chrome | Yes | Yes | Yes, original AdsTube brand |
| Community-recommendation pipeline | HN comments | None (curated list) | Reddit + HN + forums, then expert channels |
| Learner notes (Idea / Test / Result) | No | No | Yes — Vamsy's playbook |

---

## 10. Sources opened

- https://hackertube.org and routes `/about`, `/settings`, `/categories`, `/playlists`, `/data`, plus `/api/{stats,browse,playlists,config,export,feed,video,related,search}`
- https://hackertube.org/download/hackertube-data.zip and DATA.md / taxonomy / embeddings
- https://karpathy.bearblog.dev/hacker-tube/
- https://engineerpal.com/karpathy-hackertube/
- https://the-decoder.com/andrej-karpathy-built-a-curated-video-platform-in-a-weekend-using-claude-and-20-years-of-hacker-news/
- https://news.ycombinator.com/item?id=50319510
- https://x.com/karpathy/status/2116957135661945283 and https://x.com/karpathy/status/2116970707867566106
- https://karpathy.ai/tristan-tube/ and https://karpathy.ai/tristan-tube/videos.json
- https://eraofminds.com/blog/what-is-tristantube/
