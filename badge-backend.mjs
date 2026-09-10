// v0.14.4 勋章激励后端（Cloudflare Pages Function，ESM）
// 复用 PROFILES KV（键前缀 b:<uid>），与设备进度 p:<uid> 完全分开，互不干扰。
// 前端 BADGE_API='' 时同源调用 /api/*；后端不可用时（KV 未绑 / 限流）返回 ok:false 静默降级，绝不阻塞开口。
//
// 设计要点（移植自 sinoky_backend，零依赖、纯函数、可直接 node 测试）：
//  - 等级公式 xp=100*level^1.5，反解用循环查找（与 gamification.json 示例精确自洽）。
//  - 8 种 unlock.type 全覆盖（scene_complete/day_complete/phase_complete/streak/stat_streak/review_pass/user_log/goal_coverage）。
//  - 键名铁律：事件计数一律用 event 名原样做 stats 键（如 real_world_use），绝不写驼峰。
//  - 写配额保护：complete_line 等高频事件不落 KV（XP 不解锁勋章，丢了不影响解锁判定）；
//    只有 day_complete/checkin/perfect_tone/review_pass/real_world_use/goal_set 与“新解锁”才持久化。

const GAMI = {
  "version": "1.0.0",
  "meta": {
    "name": "Sinoky 用户激励体系",
    "description": "勋章、成就、连胜、积分——驱动 30 天中文之旅的激励机制"
  },

  "coreLoop": {
    "xp": {
      "completeLine": 10,
      "completeScene": 50,
      "perfectTone": 25,
      "roleReversal": 40,
      "reviewPass": 60,
      "streakBonus": 20,
      "firstReply": 30
    },
    "levels": {
      "formula": "100 * level^1.5",
      "example": { "level1": 100, "level5": 1118, "level10": 3162 }
    },
    "streaks": {
      "dailyGoalMinutes": 5,
      "freezeTokens": { "earnEvery": 7, "maxCarry": 3 },
      "milestones": [3, 7, 14, 30, 60, 100]
    }
  },

  "badges": [
    {
      "id": "first_word",
      "tier": "bronze",
      "name": "First Word",
      "name_zh": "开口第一句",
      "desc": "Complete Day 1 — say your first 'Nǐ hǎo'.",
      "icon": "badge_first_word",
      "unlock": { "type": "scene_complete", "day": 1 },
      "reward": { "xp": 50 }
    },
    {
      "id": "three_peat",
      "tier": "bronze",
      "name": "Three-peat",
      "name_zh": "三连打卡",
      "desc": "Hit a 3-day streak.",
      "icon": "badge_streak_3",
      "unlock": { "type": "streak", "count": 3 },
      "reward": { "xp": 100 }
    },
    {
      "id": "survivor",
      "tier": "silver",
      "name": "Survivor",
      "name_zh": "生存达人",
      "desc": "Finish the Survival phase (Day 1–7).",
      "icon": "badge_survivor",
      "unlock": { "type": "phase_complete", "phase": "survival", "days": [1, 2, 3, 4, 5, 6, 7] },
      "reward": { "xp": 300, "unlocks": ["theme_survival"] }
    },
    {
      "id": "tone_master",
      "tier": "silver",
      "name": "Tone Master",
      "name_zh": "声调大师",
      "desc": "Get 90%+ tone accuracy on 5 scenes in a row.",
      "icon": "badge_tone_master",
      "unlock": { "type": "stat_streak", "stat": "toneAccuracy", "value": 90, "count": 5 },
      "reward": { "xp": 400 }
    },
    {
      "id": "reversal_king",
      "tier": "gold",
      "name": "Reversal King",
      "name_zh": "角色翻转王",
      "desc": "Pass 3 role-reversal reviews.",
      "icon": "badge_reversal",
      "unlock": { "type": "review_pass", "mode": "role_reversal", "count": 3 },
      "reward": { "xp": 500 }
    },
    {
      "id": "week_warrior",
      "tier": "silver",
      "name": "Week Warrior",
      "name_zh": "一周战士",
      "desc": "Maintain a 7-day streak.",
      "icon": "badge_streak_7",
      "unlock": { "type": "streak", "count": 7 },
      "reward": { "xp": 300, "freezeToken": 1 }
    },
    {
      "id": "real_world",
      "tier": "gold",
      "name": "In the Wild",
      "name_zh": "真实世界",
      "desc": "Log a real-world use (used a phrase outside the app).",
      "icon": "badge_real_world",
      "unlock": { "type": "user_log", "event": "real_world_use" },
      "reward": { "xp": 600 }
    },
    {
      "id": "graduate",
      "tier": "platinum",
      "name": "Sinoky Graduate",
      "name_zh": "Sinoky 毕业生",
      "desc": "Complete all 30 days.",
      "icon": "badge_graduate",
      "unlock": { "type": "day_complete", "day": 30 },
      "reward": { "xp": 1500, "unlocks": ["certificate", "theme_graduate"] }
    },
    {
      "id": "centurion",
      "tier": "platinum",
      "name": "Centurion",
      "name_zh": "百日坚持",
      "desc": "Reach a 100-day streak.",
      "icon": "badge_streak_100",
      "unlock": { "type": "streak", "count": 100 },
      "reward": { "xp": 3000, "unlocks": ["profile_frame_legend"] }
    },
    {
      "id": "polyglot_path",
      "tier": "gold",
      "name": "All Paths",
      "name_zh": "全能行者",
      "desc": "Complete at least one scene in every goal track (Travel, Work, Daily).",
      "icon": "badge_all_paths",
      "unlock": { "type": "goal_coverage", "goals": ["travel", "work", "daily"] },
      "reward": { "xp": 800 }
    }
  ],

  "achievements": {
    "categories": ["progress", "mastery", "consistency", "social", "exploration"],
    "rules": [
      { "id": "say_50_phrases", "desc": "Say 50 phrases out loud", "metric": "phrasesSaid", "threshold": 50 },
      { "id": "90pct_tone", "desc": "Reach 90% tone accuracy", "metric": "toneAccuracy", "threshold": 90 },
      { "id": "no_skip", "desc": "Complete 10 scenes without skipping", "metric": "scenesNoSkip", "threshold": 10 },
      { "id": "speed_demon", "desc": "Pass a Speed Run with 95%+", "metric": "speedRunScore", "threshold": 95 },
      { "id": "helpful", "desc": "Invite a friend who completes Day 1", "metric": "referralComplete", "threshold": 1 }
    ]
  },

  "rewardEconomy": {
    "currency": "keys",
    "earn": { "dailyComplete": 1, "reviewPass": 2, "achievement": "varies" },
    "spend": {
      "profile_frame": 5,
      "theme_pack": 10,
      "voice_pack": 15,
      "streak_freeze": 3
    }
  }
};
const BADGE_XP = (GAMI.coreLoop && GAMI.coreLoop.xp) || {};
const ECONOMY = GAMI.rewardEconomy || { earn: {}, spend: {} };
const BADGES = GAMI.badges || [];
const BADGE_BY_ID = new Map(BADGES.map(b => [b.id, b]));

// ---------- 等级曲线（level.js） ----------
function xpForLevel(level) { return Math.round(100 * Math.pow(level, 1.5)); }
function levelFromXp(xp) {
  const x = Number(xp) || 0;
  if (x < xpForLevel(1)) return 0;
  let lv = 0;
  for (let i = 1; i <= 999; i++) { if (xpForLevel(i) <= x) lv = i; else break; }
  return lv;
}
function levelProgress(xp) {
  const x = Number(xp) || 0;
  const lv = levelFromXp(x);
  const cur = lv === 0 ? 0 : xpForLevel(lv);
  const next = xpForLevel(lv + 1);
  const span = Math.max(1, next - cur);
  return { level: lv, xp: x, xpForCurrentLevel: cur, xpForNextLevel: next, into: Math.min(span, Math.max(0, x - cur)), span, ratio: Math.max(0, Math.min(1, (x - cur) / span)) };
}

// ---------- 解锁评估（evaluate.js） ----------
function unlockOf(badge) {
  if (!badge) return { type: null, params: {} };
  if (badge.unlock && badge.unlock.type) { const { type, ...rest } = badge.unlock; return { type, params: rest }; }
  return { type: badge.unlock_type || null, params: badge.unlock_params || {} };
}
const asArray = v => Array.isArray(v) ? v : (v == null ? [] : [v]);
const num = v => (typeof v === 'number' && isFinite(v)) ? v : (Number(v) || 0);
function statCount(progress, key) { const stats = (progress && progress.stats) || {}; return num(stats[key]); }
function evaluateUnlock(progress, badge) {
  const p = progress || {};
  const { type, params } = unlockOf(badge);
  const stats = p.stats || {};
  switch (type) {
    case 'scene_complete': {
      const day = num(params.day);
      if (day && asArray(p.completed_days).includes(day)) return true;
      const sceneId = params.scene || (day ? 'day-' + day : null);
      return !!sceneId && asArray(p.completed_scenes).includes(sceneId);
    }
    case 'day_complete': { const day = num(params.day); return !!day && asArray(p.completed_days).includes(day); }
    case 'phase_complete': {
      const phase = params.phase;
      if (!phase) return false;
      if (p.phases && p.phases[phase] === true) return true;
      const days = asArray(params.days);
      if (days.length) return days.every(d => asArray(p.completed_days).includes(d));
      return false;
    }
    case 'streak': return num(p.streak) >= num(params.count);
    case 'stat_streak': {
      const stat = params.stat;
      if (!stat) return false;
      const value = num(params.value);
      const count = num(params.count) || 1;
      const cur = num(stats[stat]);
      const run = num(stats[stat + '_streak']);
      if (value && cur < value) return false;
      return run >= count;
    }
    case 'review_pass': {
      const mode = params.mode || 'any';
      const count = num(params.count) || 1;
      const rp = stats.reviewPass || {};
      if (mode === 'any') return Object.keys(rp).reduce((s, k) => s + num(rp[k]), 0) >= count;
      return num(rp[mode]) >= count;
    }
    case 'user_log': {
      const evt = params.event;
      if (!evt) return false;
      const need = num(params.count) || 1;
      return statCount(p, evt) >= need;
    }
    case 'goal_coverage': {
      const goals = asArray(params.goals);
      if (!goals.length) return false;
      const mine = asArray(stats.goals);
      return goals.every(g => mine.includes(g));
    }
    default: return false;
  }
}
function newlyUnlocked(progress, badges, ownedIds) {
  const owned = new Set(asArray(ownedIds));
  return asArray(badges).filter(b => b && b.id && !owned.has(b.id) && evaluateUnlock(progress, b));
}

// ---------- KV 存储适配（PROFILES binding，键 b:<uid>） ----------
const kvKey = uid => 'b:' + String(uid);
async function loadProgress(env, uid) {
  if (!env || !env.PROFILES) return null;
  const raw = await env.PROFILES.get(kvKey(uid));
  if (!raw) return null;
  try { const p = JSON.parse(raw); p.badges = p.badges || []; p.stats = p.stats || {}; return p; }
  catch (e) { return null; }
}
async function saveProgress(env, uid, p) {
  if (!env || !env.PROFILES) return false;
  try { await env.PROFILES.put(kvKey(uid), JSON.stringify(p)); return true; } catch (e) { return false; }
}
function emptyProgress(uid) {
  return { user_id: uid, xp: 0, level: 0, keys: 0, streak: 0, last_checkin: null, completed_days: [], completed_scenes: [], phases: {}, stats: {}, badges: [], last_save: 0 };
}
const uniq = a => [...new Set(a)];

// 只有“会解锁勋章”的事件与“低频关键事件”才落 KV，保护 PROFILES 免费写配额（每天 1000）
const PERSIST_ALWAYS = new Set(['day_complete', 'checkin', 'complete_scene', 'scene_complete', 'phase_complete', 'perfect_tone', 'review_pass', 'real_world_use', 'goal_set']);
function shouldPersist(type, granted) { return granted.length > 0 || PERSIST_ALWAYS.has(type); }

async function _grant(p, unlocked, uid) {
  const granted = [];
  for (const b of unlocked) {
    if (p.badges.some(x => x.badge_id === b.id)) continue;            // 幂等：已解锁跳过
    p.badges.push({ badge_id: b.id, user_id: uid, unlocked_at: new Date().toISOString(), meta: (b.reward && b.reward.xp) ? { xp: b.reward.xp } : null });
    const rw = b.reward || {};
    p.xp = num(p.xp) + num(rw.xp);
    p.keys = num(p.keys) + num(rw.keys);
    granted.push(b);
  }
  if (granted.length) p.level = levelFromXp(p.xp);
  return granted;
}

async function recordEvent(env, uid, body) {
  const type = String((body && body.type) || '').trim();
  if (!type) return { error: '缺少 type', status: 400 };
  let p = await loadProgress(env, uid);
  const fresh = !p;
  if (fresh) p = emptyProgress(uid);
  p.badges = p.badges || [];
  p.stats = p.stats || {};
  p.completed_days = uniq(p.completed_days || []);
  p.completed_scenes = uniq(p.completed_scenes || []);
  p.phases = p.phases || {};
  const addXp = k => { p.xp = num(p.xp) + num(BADGE_XP[k]); };

  switch (type) {
    case 'complete_line': addXp('completeLine'); p.stats.lines = num(p.stats.lines) + 1; break;
    case 'complete_scene':
    case 'scene_complete': {
      const day = num(body.day);
      const isNewDay = !!day && !p.completed_days.includes(day);
      if (isNewDay) { addXp('completeScene'); p.completed_days.push(day); p.stats.last_day = day; }
      if (body.scene && !p.completed_scenes.includes(body.scene)) p.completed_scenes.push(body.scene);
      break;
    }
    case 'day_complete': {
      const day = num(body.day);
      if (!day) return { error: 'day_complete 需要 day', status: 400 };
      if (!p.completed_days.includes(day)) {
        addXp('completeScene');
        p.completed_days.push(day);
        p.keys = num(p.keys) + num(ECONOMY.earn && ECONOMY.earn.dailyComplete);
      }
      break;
    }
    case 'phase_complete': {
      const phase = String(body.phase || '');
      if (!phase) return { error: 'phase_complete 需要 phase', status: 400 };
      p.phases[phase] = true;
      break;
    }
    case 'perfect_tone': {
      addXp('perfectTone');
      const acc = num(body.value);
      p.stats.toneAccuracy = acc;
      const need = 90;
      p.stats.toneAccuracy_streak = acc >= need ? num(p.stats.toneAccuracy_streak) + 1 : 0;
      break;
    }
    case 'review_pass': {
      const mode = String(body.mode || 'any');
      addXp('reviewPass');
      p.stats.reviewPass = p.stats.reviewPass || {};
      p.stats.reviewPass[mode] = num(p.stats.reviewPass[mode]) + 1;
      p.keys = num(p.keys) + num(ECONOMY.earn && ECONOMY.earn.reviewPass);
      if (mode === 'role_reversal') addXp('roleReversal');
      break;
    }
    case 'real_world_use': {
      p.stats.real_world_use = num(p.stats.real_world_use) + 1;   // 键名必须与 unlock.event 一致
      addXp('firstReply');
      break;
    }
    case 'goal_set': {
      const goal = String(body.goal || '');
      if (!goal) return { error: 'goal_set 需要 goal', status: 400 };
      p.stats.goals = uniq([...(p.stats.goals || []), goal]);
      break;
    }
    case 'checkin': return checkin(env, uid);
    default: p.stats[type] = num(p.stats[type]) + 1;
  }

  const owned = (p.badges || []).map(b => b.badge_id);
  const unlocked = newlyUnlocked(p, BADGES, owned);
  const granted = await _grant(p, unlocked, uid);
  p.level = levelFromXp(p.xp);
  if (shouldPersist(type, granted)) { p.last_save = Date.now(); await saveProgress(env, uid, p); }
  return { granted };
}

async function checkin(env, uid) {
  let p = await loadProgress(env, uid);
  const fresh = !p;
  if (fresh) p = emptyProgress(uid);
  const today = new Date().toISOString().slice(0, 10);
  const last = p.last_checkin;
  if (last === today) {
    const lv = levelProgress(p.xp);
    return { progress: { ...p, level: lv.level, level_progress: lv }, granted: [], streak: p.streak, already: true };
  }
  const cont = last && (Date.parse(today) - Date.parse(last)) === 86400000;
  p.streak = cont ? num(p.streak) + 1 : 1;
  p.last_checkin = today;
  if (p.streak > 1) p.xp = num(p.xp) + num(BADGE_XP.streakBonus);
  const owned = (p.badges || []).map(b => b.badge_id);
  const unlocked = newlyUnlocked(p, BADGES, owned);
  const granted = await _grant(p, unlocked, uid);
  p.level = levelFromXp(p.xp);
  await saveProgress(env, uid, p);
  const lv = levelProgress(p.xp);
  return { progress: { ...p, level: lv.level, level_progress: lv }, granted, streak: p.streak, already: false };
}

async function spend(env, uid, item) {
  const price = ECONOMY.spend && ECONOMY.spend[item];
  if (price == null) return { error: '未知商品：' + item, status: 400 };
  let p = await loadProgress(env, uid);
  if (!p) p = emptyProgress(uid);
  if (num(p.keys) < num(price)) return { error: 'keys 不足：需要 ' + price + '，现有 ' + num(p.keys), status: 402 };
  p.keys = num(p.keys) - num(price);
  p.level = levelFromXp(p.xp);
  await saveProgress(env, uid, p);
  const lv = levelProgress(p.xp);
  return { progress: { ...p, level: lv.level, level_progress: lv }, spent: price, item };
}

// ---------- 路由入口（供 _worker.js 调用） ----------
export async function handleBadgeApi(req, url, env, json) {
  const seg = url.pathname.split('/').filter(Boolean);     // ['api','users',uid,'progress']
  if (seg[0] !== 'api') return null;

  if (seg[1] === 'badges' && seg.length === 2 && req.method === 'GET') {
    return json({ badges: BADGES.map(b => ({ id: b.id, name: b.name, name_zh: b.name_zh, tier: b.tier, desc: b.desc, reward: b.reward || null })) });
  }

  if (seg[1] === 'users' && seg.length >= 3) {
    const uid = decodeURIComponent(seg[2]);
    const action = seg[3] || '';
    if (!uid) return json({ error: '缺少 user id' }, 400);

    if (action === 'progress' && req.method === 'GET') {
      const p = await loadProgress(env, uid) || emptyProgress(uid);
      const lv = levelProgress(p.xp);
      return json({ progress: { ...p, level: lv.level, level_progress: lv } });
    }
    if (action === 'badges' && req.method === 'GET') {
      const p = await loadProgress(env, uid);
      const owned = (p && p.badges || []).map(b => ({ ...b, ...(BADGE_BY_ID.get(b.badge_id) || { id: b.badge_id }) }));
      return json({ badges: owned });
    }
    if (action === 'events' && req.method === 'POST') {
      let body = {}; try { body = await req.json(); } catch (e) {}
      const r = await recordEvent(env, uid, body);
      if (r.error) return json({ error: r.error }, r.status || 400);
      const p = await loadProgress(env, uid) || emptyProgress(uid);
      const lv = levelProgress(p.xp);
      return json({ ok: true, progress: { ...p, level: lv.level, level_progress: lv }, unlocked: r.granted.map(b => ({ id: b.id, name: b.name, name_zh: b.name_zh, xp: (b.reward || {}).xp })), event_id: null });
    }
    if (action === 'checkin' && req.method === 'POST') {
      const r = await checkin(env, uid);
      return json({ ok: true, progress: r.progress, streak: r.streak, already: !!r.already, unlocked: r.granted.map(b => b.id) });
    }
    if (action === 'spend' && req.method === 'POST') {
      let body = {}; try { body = await req.json(); } catch (e) {}
      const item = String(body.item || '').trim();
      if (!item) return json({ error: '缺少 item' }, 400);
      const r = await spend(env, uid, item);
      if (r.error) return json({ error: r.error }, r.status || 400);
      return json({ ok: true, item: r.item, spent: r.spent, progress: r.progress });
    }
  }
  return null;   // 不是勋章路由 → 交回 _worker.js 其它处理器 / 静态资源
}
