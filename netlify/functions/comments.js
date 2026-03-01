// ══════════════════════════════════════════════════════════════
// Netlify Function — comments.js
// يجلب تعليقات البث بـ masterchat ويحفظها في Supabase
// ══════════════════════════════════════════════════════════════

const { Masterchat, stringify } = require("masterchat");

const VIDEO_ID = "6_9ZiuONXt0";
const SUPA_URL = process.env.SUPABASE_URL || "https://amuopyagznrsyojqxaqp.supabase.co";
const SUPA_KEY = process.env.SUPABASE_KEY || "sb_publishable_VEEiRh3zLWxhzIwgJBcvLw_f0hABb0u";
const DB_READY = !!(SUPA_URL && SUPA_KEY);

// ── fetch مع timeout ──────────────────────────────────────────
async function fetchT(url, opts = {}, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// ── Supabase: حفظ ─────────────────────────────────────────────
async function supaInsert(rows) {
  if (!rows.length) return { status: 200, error: null };
  const res = await fetchT(`${SUPA_URL}/rest/v1/comments`, {
    method: "POST",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  const error = (!res.ok && res.status !== 409) ? await res.text() : null;
  return { status: res.status, error };
}

// ── Supabase: قراءة ───────────────────────────────────────────
async function supaSelect() {
  const res = await fetchT(
    `${SUPA_URL}/rest/v1/comments?select=id,author,message,created_at&order=created_at.asc&limit=50000`,
    { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
  );
  if (!res.ok) return { data: [], error: await res.text() };
  return { data: await res.json(), error: null };
}

// ── YouTube: جلب التعليقات عبر masterchat ────────────────────
async function fetchYouTubeChat() {
  const iraqNow = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  // Masterchat.init يجلب الـ channelId تلقائياً من صفحة يوتيوب
  const mc = await Masterchat.init(VIDEO_ID, { mode: "live" });
  const { actions } = await mc.fetch();

  const msgs = [];
  for (const action of actions) {
    if (action.type !== "addChatItemAction") continue;

    // stringify يحوّل runs إلى نص (يدعم الإيموجي والنصوص المختلطة)
    const text = stringify(action.message || []).trim();
    if (!text) continue;

    msgs.push({
      youtube_id: action.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      author: action.authorName || "مجهول",
      message: text,
      created_at: iraqNow,
    });
  }

  return {
    msgs,
    isLive: mc.isLive,
    reason: msgs.length === 0 ? "لا توجد تعليقات الآن" : null,
  };
}

// ── Handler ───────────────────────────────────────────────────
exports.handler = async function () {
  const log = { db: DB_READY, yt: 0, isLive: null, reason: null, saved: null, savedErr: null, readErr: null };
  let ytMsgs = [];
  let allMsgs = [];

  // 1. جلب من يوتيوب
  try {
    const r = await fetchYouTubeChat();
    ytMsgs = r.msgs;
    log.yt = ytMsgs.length;
    log.isLive = r.isLive;
    log.reason = r.reason;
  } catch (e) {
    log.reason = e.message; // DisabledChatError / UnavailableError / etc.
  }

  // 2. حفظ في Supabase
  if (DB_READY && ytMsgs.length > 0) {
    const ins = await supaInsert(ytMsgs);
    log.saved = ins.status;
    log.savedErr = ins.error;
  }

  // 3. قراءة من Supabase
  if (DB_READY) {
    const sel = await supaSelect();
    allMsgs = sel.data;
    log.readErr = sel.error;
  }

  // 4. fallback: عرض يوتيوب مباشرة إذا Supabase فشل
  if (allMsgs.length === 0 && ytMsgs.length > 0) {
    allMsgs = ytMsgs.map((m, i) => ({ id: i + 1, ...m }));
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ messages: allMsgs, new_count: log.yt, total: allMsgs.length, log }),
  };
};
