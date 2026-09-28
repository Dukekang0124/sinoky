/* check_site.cjs —— 官网（landing/*）真跑验收（2026-09-28 建）
 *
 * 为什么需要它：
 *   官网比产品页更"静"——没人天天点它，改一次可能几个月不看。所以它的缺陷不会自己
 *   暴露，只会一直挂着（链接 404、双语漏译、手机上横向溢出、数字写错）。静态读源码
 *   只能证明"我写了什么"，证明不了"浏览器渲染出来是什么"。这一层必须真跑。
 *
 * 四组判据（前一组不过就不跑后面的，避免噪音淹没真因）：
 *
 *   A. 静态一致性（读文件就行，不必启浏览器）
 *      A1 五页 <header class="nav"> 块**逐字节一致** —— 导航是站点骨架，改一处漏四处
 *         就会让用户在某页走不到另一页。注释里承诺的一致性必须由机器守。
 *      A2 五页 <footer> 块逐字节一致（同理）。
 *      A3 每页 title 非空且互不相同 / description 非空 / 恰好一个 h1。
 *      A4 canonical + og:title + og:image 齐（官网要被分享，缺则分享卡片是白的）。
 *      A5 站内 href/src 全部解析到真实文件（不存在 = 上线即 404）。
 *      A6 data-zh 与 data-zh-html 互斥（同一元素既给纯文本又给富文本，行为未定义）。
 *      A7 城市任务区数字**逐城真值校验**（不是句式黑名单）：任何「城市 × 数字 ×
 *         任务区/zones」子句，数字必须等于该城现算值（上海 9 / 北京 4 / 成都 4 /
 *         合计 17）。判据自带 8 反例 + 8 正例自测（含 HTML 层用例），配对数按
 *         **来源分账**（可见文本 / data-zh 属性），任一来源 0 配对 ⇒ 判失败（防空转）。
 *         为什么需要：官网曾写「北京、上海、成都各 9 个真实任务区」而没人发现 ——
 *         该数字当时不被 count_corpus 任何字段覆盖。数字没出处 = 没人看守。
 *         外部干预验证（真改坏文件再验）用 `_internal/probe_a7_zones.cjs`，三步见其文档头。
 *
 *   B. 真跑渲染（Playwright + 本机 Chrome，5 页 × 3 视口）
 *      B1 页面与全部子资源 HTTP 全 200；无 requestfailed。
 *      B2 零 pageerror / 零 console error。
 *      B3 无横向溢出（scrollWidth ≤ innerWidth + 1）。
 *      B4 **双语闭合**：en 模式下每个 [data-zh] 元素不得残留中日韩字符
 *         （这是产品「零英文 fallback」验收线的官网对偶）；zh 模式下文本
 *         必须等于源码里的 data-zh 原文（证明双向都真换，不是单向瞎切）。
 *      B5 首页 .stat 里的数字 === `_internal/count_corpus.cjs` 现算口径。
 *      B6 features 页「数字出处表」存在且逐个覆盖全部对外口径数字。
 *      B7 data-live 不变量：JS 回填的动态值节点必须与文案节点平级
 *         （嵌在 data-zh 容器里会被语言切换冲掉，且反向断言「回填目标都声明了 data-live」）。
 *      B8 禁用 JS 时内容仍可读（.fade 必须是「默认可见、确认 JS 才隐藏」）。
 *      B9 **文字对比度实测**（WCAG AA：普通 4.5 / 大字 3）：
 *         ① 所有可见 <a> —— site.css 的兜底是 a{color:inherit}，颜色取决于祖先，
 *            静态算不出，必须真跑；② 所有「自己画了背景且自带文字」的元素
 *            （chip / badge / 自定义按钮，它们是 <span>/<div>，① 抓不到）。
 *         实测计算色 vs **有效背景**（沿祖先链逐层合成半透明背景，兜底页面底色）。
 *         v0.29.3 首次运行即抓到 13 处「白字压 --red」= 4.17:1，已统一改 --red-solid。
 *
 *   C. 下载页专项（这是本项目官网存在的首要理由，单独深挖）
 *      页面有两条**互斥**渲染分支，而线上 version.json 任一时刻只处于其中一种 ——
 *      「完整态」（CI 已回写 md5/size）与「待回写态」（md5 空 / size 0）。
 *      只跑现状 ⇒ 另一条分支的断言要等下次发版才第一次执行 = 把验证推给线上。
 *      故三跑：C1 现状（自适应）· C4 完整态夹具 · C7 待回写态夹具
 *      （C4/C7 用 page.route 注入，与 CI 是否已回写无关 ⇒ 两条分支永远被真跑）。
 *      每个用例同时断言：
 *        · #apk-ver / #apk-size / #apk-md5 / #apk-filename / 主按钮 href
 *          必须 === version.json 的 apk 段字段（不是"像"，是"全等"）
 *        · 切到中文后这些字段**不得被语言切换清空**（曾踩：applyLang 用 textContent
 *          重置了 JS 回填的节点，切一次语言版本号就变成「—」），
 *          也**不得把已隐藏的待回写字段复活**
 *        · 完整态：有值就必须可见；待回写态：无值就必须**隐藏**并有显式说明
 *        · 页面上不存在「无说明的占位」—— 只数**可见**的「—」（隐藏元素的
 *          textContent 仍是「—」，直接数会把「已正确隐藏」误判成「静默占位」）
 *
 *   D. 取证截图存 `_internal/_shots/site-*.png`。
 *
 * 用法：
 *   NODE_OPTIONS= NODE_PATH=<workbuddy node workspace>/node_modules \
 *     node _internal/check_site.cjs [--quick]
 *   --quick 跳过 3 视口矩阵，只跑 md（迭代文案时用）。
 *   --static-only 只跑 A 组、不启浏览器（约 1 秒；改文案后先跑这个再跑全量）。
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { countCorpus } = require('./count_corpus.cjs');

const ROOT = path.join(__dirname, '..');           /* sinoky-app/ 作为站点根 */
const LAND = path.join(ROOT, 'landing');
const SHOTS = path.join(__dirname, '_shots');
const PAGES = ['index.html', 'features.html', 'how.html', 'download.html', 'contact.html'];
const QUICK = process.argv.includes('--quick');
/* --static-only：只跑 A 组（读文件 + 真值对账），不启浏览器。约 1 秒。
   存在理由：改一句文案后要验 A7 得等 40 秒渲染，人就会不想跑 ⇒ 闸门被绕过。
   它与 --quick 是**互补**的（quick 跑渲染不跑静态），不是替代。 */
const STATIC_ONLY = process.argv.includes('--static-only');
const VIEWPORTS = QUICK
  ? [{ name: 'md', w: 768, h: 1024 }]
  : [{ name: 'sm', w: 360, h: 740 }, { name: 'md', w: 768, h: 1024 }, { name: 'lg', w: 1440, h: 900 }];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/* ── 结果收集 ───────────────────────────────────────────── */
const pass = [];
const fail = [];
let group = '';
const G = (name) => { group = name; };
function ok(id, msg) { pass.push(`[${id}] ${msg}`); }
function ng(id, msg) { fail.push(`[${group}] [${id}] ${msg}`); }

/* ── 静态服务器（根 = sinoky-app，与线上 CF Pages 目录形状一致） ── */
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const fp = path.normalize(path.join(ROOT, p));
      if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
      fs.readFile(fp, (err, buf) => {
        if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404 ' + p); }
        res.writeHead(200, { 'content-type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/* 抽「块」：从含 tagStart 的位置起做标签配平，返回整块文本。
 * ⚠️ 返回前把行尾符统一成 LF —— 这不是偷懒，是**必须**：
 *   本仓库 core.autocrlf=true ⇒ 工作区里 CRLF/LF 取决于谁写的文件（编辑器/脚本/tool），
 *   git 在 commit 时会归一化，所以「工作区逐字节一致」既不受管、也不稳定。
 *   真正要守的不变量是「忽略行尾符后完全一致」—— 行尾符是文件格式，不是站点结构。
 *   （2026-09-28 被 A1/A2 当场抓到：index.html 是 CRLF，其余四页是 LF。） */
function block(src, tagName) {
  const open = new RegExp('<' + tagName + '(\\s[^>]*)?>', 'i');
  const m = open.exec(src);
  if (!m) return null;
  const re = new RegExp('</?' + tagName + '(\\s[^>]*)?>', 'gi');
  re.lastIndex = m.index;
  let depth = 0, t;
  while ((t = re.exec(src))) {
    if (t[0][1] === '/') { depth--; if (depth === 0) return eol(src.slice(m.index, t.index + t[0].length)); }
    else depth++;
  }
  return null;
}
function eol(s) { return s.replace(/\r\n/g, '\n'); }

/* ══════════════════ A7 判据：城市 × 任务区数字 真值校验 ══════════════════
   两个入口分开，是为了让「判据」本身可以被**单独自测**（见 auditZoneSelfTest）——
   判据和被测对象混在一起时，唯一能证明判据有效的方法就是去改页面，那代价太大，
   于是人就懒得证，闸门就永远处于「不知道有没有用」的状态。 */

/* 可见文本：**先挖空属性值**再剥标签。
   顺序不能反 —— 反了会把 data-zh-html 里的 `<b>` 当标签处理并把中文夹断成碎片，
   碎片可能拼出假的城市×数字组合。属性值里的中文由 zhAttrs 单独收。

   🔴 剥标签要**区分块级 / 行内**，不能一律换成空格：
     一律换空格时，表格里相邻的两个 <td> 会被连成**同一句**——
     `…(Shanghai 9 zones; Beijing and Chengdu 4 each)  The Beijing / Shanghai / Chengdu guide entries`
     于是「4」和后面单元格里的「Shanghai」落进同一子句，判据把 4 判给上海（真值 9）⇒ 假阳性。
     实测就是这么被抓的。块级标签换成换行（真的断句），行内标签换成空串（不断句）。
     注意也不能一律换换行：`<b>Shanghai</b> has 9 zones` 会被切成「Shanghai」+「has 9 zones」，
     城市与数字分离 ⇒ **漏检**（更隐蔽）。两边都要照顾，所以必须分类处理。 */
const INLINE_TAG = /^(a|b|i|em|strong|span|small|sup|sub|u|s|code|abbr|mark|cite|q|time|wbr|img|svg|use|path)$/i;
function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/="[^"]*"/g, ' ')          /* 挖空属性值（中文文案由 zhAttrs 单独收） */
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g, (m, slash, tag) => {
      const t = tag.toLowerCase();
      if (t === 'br') return '\n';
      return INLINE_TAG.test(t) ? '' : '\n';
    });
}
function zhAttrs(html) {
  return [...html.matchAll(/data-zh(?:-html)?="([^"]*)"/g)].map((m) => m[1]);
}

/* 数字：阿拉伯 + 英文（one…twenty）+ 中文（一…二十）。三种都要，因为文案里三处写法都用过
   （`9 zones` / `nine real-world zones` / `9 个任务区`）。漏掉任一形态 = 该处数字无人看守。 */
const NUM_W = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};
const NUM_C = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function numOf(s) {
  const t = String(s).trim().toLowerCase();
  if (/^\d+$/.test(t)) return +t;
  if (NUM_W[t] != null) return NUM_W[t];
  if (NUM_C[t] != null) return NUM_C[t];
  const m = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(t);   /* 十一…九十九 */
  if (m) return (m[1] ? NUM_C[m[1]] : 1) * 10 + (m[2] ? NUM_C[m[2]] : 0);
  return null;
}
const NUM_ALT = '\\d{1,3}|[a-zA-Z]+|[一二三四五六七八九十]+';
/* ── 两种「数量短语」形态 ──────────────────────────────────────────────
   ① 严格形态：数字**自带单位**（`9 个任务区`、`9-zone`、`9 real-world zones`、
      `nine real-world zones`）。数字与单位之间只允许修饰词，不许跨标点。
   ② 宽松形态：只有分配词，没有单位（`各 4 个`、`4 each`）。单看它无法确定在谈任务区，
      所以**必须由同一大句里出现的严格形态来开门**（见 hasUnitAnchor）——
      否则「北京与成都各有 3 个机场」会被误判成任务区数（假阳性）。
   为什么要 ②：官网表格里就写着 `Shanghai 9 zones; Beijing and Chengdu 4 each` ——
   后半句没有 `zones` 字样。若只认 ①，那么「有人把 4 改成 9」这种最典型的改错
   （只改一处）会无人看守。这是「漏检边界要能说清并补上」的实例。 */
const STRICT_PAT = new RegExp(
  '(' + NUM_ALT + ')\\s*(?:[-–]|个)?\\s*(?:(?:真实|完整|个真实|个完整)\\s*)?'
  + '(?:(?:real[- ]world|real|world)\\s*)?(?:任务区|任务点|zones?)', 'gi');
/* 明文列入「不是任务区」的常见量词名词，降低 ② 的误报面。这是个不完美的手段
   （清单不可能穷尽），但方向正确：宁可窄一点、把边界写清，也不要宽到抓正确文案。
   🔴 它**不能写成正则里的否定前瞻**（`(?!机场)`）—— 第一版就是这么写的，被自测当场
   证伪：`各有 3 个机场` 中 `个` 是可选的，正则引擎会**退回去不吃「个」**，让前瞻落在
   「个机场」之前而通过（前瞻看到的是「个」而不是「机场」）。回溯能骗过前瞻，但骗不过
   「匹配之后再取后缀字符串来看」—— 所以排除判断挪到 looseNums 里做。 */
const NOT_ZONE = '机场|车站|地铁|城市|语言|天|周|分钟|小时|人|店|句|地铁线|选项|阶段';
/* `(?:有|have)?` 是必需的，且**又是被自测抓出来的**：中文写作「北京与成都**各有** 4 个」、
   英文写作「… have 4 each」，分配词与数字之间会夹一个动词。第一版只写 `各\s*(数字)`，
   于是「各有 9 个」这种真实改错形态被抓不到（反例空转），而正例「各有 4 个」也没被核验
   （看似通过、实则没查）—— 后者比前者更危险，因为它给出的是「已核对」的假象。 */
const LOOSE_PAT = new RegExp(
  '(?:(?:\\beach\\b|各)\\s*(?:有|have)?\\s*(' + NUM_ALT + ')'
  + '|(' + NUM_ALT + ')\\s*\\beach\\b)', 'gi');
const TOTAL_RE = /(合计|总计|总共|一共|总数|in total|\btotal\b)/i;

/* 大句：句读 + 英文句号（后跟空白/行尾才算，见下）。
   🔴 英文句号这个 lookahead 是必须的，且**第一版漏掉它时被自测当场抓住**：
   `...nine real-world zones. Beijing and Chengdu have four zones each.` 若不切英文句号，
   两个主语不同的数量会落进同一大句，把上海的 nine 判给北京（假阳性）。
   而放宽成「见点就切」又会把 `0.29.3` 这类版本号切碎，故用 `\.(?=\s|$)`。 */
const SENT_SPLIT = /[。！!？?\n]|\.(?=\s|$)/;
/* 子句：分号 + 逗号 + 顿号。切它们是必要的 —— `Beijing, Shanghai and Chengdu each have
   9 zones` 要能按并列成分切开；也把 `上海 9 个任务区，北京与成都各有 4 个` 分开，
   避免两段不同主语的数量互相污染。 */
const CLAUSE_SPLIT = /[；;，,、]/;
function citiesIn(cl, DEF) {
  const l = cl.toLowerCase();
  return DEF.filter((c) => l.includes(c.en) || cl.includes(c.zh));
}
function strictNums(cl) {
  return [...cl.matchAll(STRICT_PAT)].map((m) => ({ w: m[1], n: numOf(m[1]), i: m.index, l: m[0].length }))
    .filter((x) => x.n != null);
}
function looseNums(cl) {
  const out = [];
  const notZone = new RegExp('^\\s*个?\\s*(?:' + NOT_ZONE + ')');
  for (const m of cl.matchAll(LOOSE_PAT)) {
    const w = m[1] || m[2];
    const n = numOf(w);
    if (n == null) continue;
    /* 匹配之后再取后缀判断（回溯骗不过字符串切片，见 NOT_ZONE 上方注释） */
    if (notZone.test(cl.slice(m.index + m[0].length))) continue;
    out.push({ w, n, i: m.index, l: m[0].length });
  }
  return out;
}
/* 同一子句里严格与宽松可能命中同一个数量（`各 4 个任务区`：宽松抓「各 4」，严格抓「4 个任务区」），
   按**位置重叠**去重，避免同一个事实被数两遍、把 pairs 计数灌水。 */
function dedupeByPos(list) {
  const out = [];
  for (const x of list.slice().sort((a, b) => a.i - b.i)) {
    if (!out.some((y) => x.i < y.i + y.l && y.i < x.i + x.l)) out.push(x);
  }
  return out;
}
function auditZoneNumbers(texts, DEF, total) {
  const fails = [];
  let pairs = 0;
  for (const raw of texts) {
    /* 入参必须是字符串。🔴 这行是踩坑换来的：调用点曾写 `[...visibleText(p), ...zhAttrs(p)]`，
       而 visibleText 返回的是**字符串**不是一个数组 ⇒ spread 把整站英文文案拆成**单个字符**，
       于是英文侧一个配对都没有，判据却因为另一半来源（data-zh 属性）有配对而"看起来正常"。
       后果：只改英文那处时闸门放行（实测确认）。教训：**多来源断言必须逐来源记账**，
       否则一个来源静默失效会被另一个来源的配对掩盖，连"空转"都报不出来。 */
    if (typeof raw !== 'string') {
      throw new Error(`A7 入参非法：收到 ${typeof raw}（是不是把返回字符串的函数 spread 成了字符数组？）`);
    }
    for (const sent of raw.split(SENT_SPLIT)) {
      if (!sent.trim()) continue;
      const clauses = sent.split(CLAUSE_SPLIT).map((s) => s.trim()).filter(Boolean);
      /* 门控：本大句里是否出现过「城市 + 带单位的数量」。只有出现过，宽松形态才可信。 */
      const gate = clauses.some((cl) => citiesIn(cl, DEF).length && strictNums(cl).length);
      for (const cl of clauses) {
        const cities = citiesIn(cl, DEF);
        const nums = dedupeByPos(gate ? [...strictNums(cl), ...looseNums(cl)] : strictNums(cl));
        if (!nums.length) continue;
        if (cities.length) {
          for (const { w, n } of nums) {
            for (const c of cities) {
              pairs++;
              if (n !== c.n) {
                fails.push(`「${cl.slice(0, 72)}」→ 把 ${w}（=${n}）套给「${c.zh}」，现算真值 ${c.n}`);
              }
            }
          }
        } else if (TOTAL_RE.test(cl)) {
          for (const { w, n } of nums) {
            pairs++;
            if (n !== total) fails.push(`「${cl.slice(0, 72)}」→ 合计写作 ${w}（=${n}），现算合计 ${total}`);
          }
        }
      }
    }
  }
  return { pairs, fails };
}
/* 干预式验证 + 误报验证，内建在判据里（不是跑一次就丢的临时脚本）：
   反例必须全被抓、正例必须全放行。任一条不成立 ⇒ 判据整体作废，页面结果不予采信。
   每一条用例都对应一次真实的判据缺陷或一次真实的漏检边界（见注释）。 */
function auditZoneSelfTest(DEF, total) {
  const BAD = [
    ['三城各 9（中文）', '上海有一份完整的城市指南：9 个真实任务区。北京与成都各有 9 个任务区。'],
    ['三城 each（英文）', 'Beijing, Shanghai and Chengdu each have 9 real-world zones.'],
    ['「各 N 个任务区」', '北京、上海、成都各 9 个真实任务区'],
    ['英文拼写数字', 'Beijing, Shanghai and Chengdu each have nine zones.'],
    /* ↓ 这两条是「只改一处」的典型改错形态，也是**宽松形态**存在的唯一理由。
       `4 each` 没有 `zones` 单位词，靠同大句里的 `9 zones` 开门才纳入核验。 */
    ['表格后半句无单位（英文）', 'Shanghai 9 zones; Beijing and Chengdu 9 each.'],
    ['正文后半句无单位（中文）', '其中上海有完整的 9 个任务区，北京与成都各有 9 个。'],
  ];
  const GOOD = [
    ['改正后的中文', '其中上海有完整的 9 个任务区（落地、手机支付），北京与成都各有 4 个；'],
    ['改正后的英文', 'Shanghai has a full guide: nine real-world zones. Beijing and Chengdu have four zones each.'],
    ['表格简写', 'Shanghai 9 zones; Beijing and Chengdu 4 each.'],
    ['合法的合计', `三城合计 ${total} 个任务区。`],
    ['单城陈述', '上海有一份完整的城市指南：9 个真实任务区。'],
    /* ↓ 证明宽松形态的**门控真的在起作用**（不是无差别扫描）：本句没有任务区单位，
       讨论的是机场数，绝不能让「各 3 个」被判成把 3 套给北京。 */
    ['非任务区的量词（无门控）', '北京与成都各有 3 个机场。'],
    ['非任务区的量词（有门控）', '上海有 9 个任务区；北京与成都各有 3 个机场。'],
  ];
  /* HTML 层用例：测的是 visibleText 的结构处理，不是数字解析。
     形状抄自 features.html 真表格行 —— `<td>` 相邻单元格若被连成一句，就会出现
     「4 判给 Shanghai」的假阳性（实测过）。加进来防回归。 */
  const HTML = [
    ['表格行 · 数字错（应抓）', true,
      '<tr><td>3</td><td data-zh="有完整指南的城市（上海 9 个任务区，北京与成都各 4 个）">Cities with full guides (Shanghai 9 zones; Beijing and Chengdu 9 each)</td><td data-zh="北京 / 上海 / 成都的城市指南入口">The Beijing / Shanghai / Chengdu guide entries</td></tr>'],
    ['表格行 · 数字对（应放行）', false,
      '<tr><td>3</td><td data-zh="有完整指南的城市（上海 9 个任务区，北京与成都各 4 个）">Cities with full guides (Shanghai 9 zones; Beijing and Chengdu 4 each)</td><td data-zh="北京 / 上海 / 成都的城市指南入口">The Beijing / Shanghai / Chengdu guide entries</td></tr>'],
    /* 行内标签不得断句：`<b>Shanghai</b> has 9 zones` 若被切成两段，城市与数字分离 ⇒ 漏检 */
    ['行内标签不断句（应抓）', true,
      '<p><b>Shanghai</b> has 9 zones while <b>Beijing and Chengdu</b> have 9 zones each.</p>'],
  ];
  const bad = [];
  for (const [name, t] of BAD) {
    const r = auditZoneNumbers([t], DEF, total);
    if (!r.fails.length) bad.push(`反例未被抓住（判据空转）：${name} —— ${t.slice(0, 60)}`);
  }
  for (const [name, t] of GOOD) {
    const r = auditZoneNumbers([t], DEF, total);
    if (r.fails.length) bad.push(`正例被误判（假阳性）：${name} —— ${r.fails[0]}`);
  }
  for (const [name, expectFail, html] of HTML) {
    const r = auditZoneNumbers([visibleText(html), ...zhAttrs(html)], DEF, total);
    const hit = r.fails.length > 0;
    if (hit !== expectFail) {
      bad.push(`${expectFail ? 'HTML 反例未被抓住' : 'HTML 正例被误判'}：${name}`
        + ` —— ${expectFail ? '0 处失败' : r.fails[0]}`);
    }
  }
  return { bad, badN: BAD.length + HTML.filter((h) => h[1]).length, goodN: GOOD.length + HTML.filter((h) => !h[1]).length };
}

/* 滚动遍历：触发所有 IntersectionObserver 驱动的入场动效，然后回到顶部。
   取巧做法（直接改 CSS 强制 opacity:1）不行 —— 那会掩盖「观察器根本没触发」这类真问题。 */
async function sweep(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.6);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(720);   /* 等 .6s 的过渡收尾，否则截到动画中间帧 */
}

/* ══════════════════ A. 静态一致性 ══════════════════ */
function staticChecks() {
  G('A 静态一致性');
  const src = {};
  for (const p of PAGES) src[p] = fs.readFileSync(path.join(LAND, p), 'utf8');

  /* A1 / A2 导航与页脚跨页一致。
     ⚠️ 不能用「裸字节相等」当判据：`aria-current="page"`（当前页标记）本来就该逐页不同 ——
     对首页而言它连一个自指入口都没有（brand 才是回家入口）。裸比会把一个**正确的**
     可访问性实现判成「导航漂移」，那是最坏的一类假阳性：逼着人去删掉正确的东西。
     正确的不变量拆两条：① 剔除当前页标记后完全一致；② 该标记每页至多 1 个，且只落在本页自己的入口上。 */
  for (const [tag, id] of [['header', 'A1'], ['footer', 'A2']]) {
    const sig = {};
    const missing = [];
    for (const p of PAGES) {
      const b = block(src[p], tag);
      if (!b) { missing.push(p); continue; }
      sig[p] = b.replace(/\s+aria-current="page"/g, '');
    }
    if (missing.length) { ng(id, `<${tag}> 块缺失：${missing.join(', ')}`); continue; }
    const ref = sig[PAGES[0]];
    const diff = PAGES.filter((p) => sig[p] !== ref);
    if (diff.length) {
      ng(id, `<${tag}> 跨页不一致（基准 ${PAGES[0]}，不一致：${diff.join(', ')}）`);
      const a = ref.split('\n'), b = sig[diff[0]].split('\n');
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) { ng(id, `   首处差异 ${diff[0]}:${i + 1}\n      基准: ${(a[i] || '').trim()}\n      该页: ${(b[i] || '').trim()}`); break; }
      }
    } else ok(id, `<${tag}> 跨 ${PAGES.length} 页完全一致（已归一化行尾符与当前页标记，${ref.length} B）`);
  }

  /* A1b 当前页标记的正确性（不属于「一致性」，而属于「语义正确」） */
  {
    const bad = [];
    for (const p of PAGES) {
      const raw = block(src[p], 'header');
      const marked = [...raw.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).filter((t) => /aria-current="page"/.test(t));
      const self = p === 'index.html' ? null : p;   /* 首页在导航里没有自指入口 */
      if (self === null && marked.length) bad.push(`${p}: 首页不应有当前页标记，却有 ${marked.length} 个`);
      if (self !== null && marked.length !== 1) bad.push(`${p}: 当前页标记应为 1 个，实为 ${marked.length} 个`);
      for (const t of marked) {
        const href = (t.match(/\shref="([^"]+)"/) || [])[1];
        if (href !== self) bad.push(`${p}: 当前页标记指向 "${href}"，该指向自己 "${self}"`);
      }
    }
    if (bad.length) ng('A1b', `当前页标记错误：\n      ` + bad.join('\n      '));
    else ok('A1b', `当前页标记：四个子页各 1 个且指向自身，首页为 0（导航里无自指入口，brand 即回家）`);
  }

  /* A3 title / description / h1 */
  const titles = {};
  for (const p of PAGES) {
    const t = (src[p].match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
    const d = (src[p].match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1] || '';
    const h1 = (src[p].match(/<h1[\s>]/gi) || []).length;
    titles[p] = t.trim();
    if (!t.trim()) ng('A3', `${p} 缺 <title>`);
    if (!d.trim()) ng('A3', `${p} 缺 meta description`);
    if (h1 !== 1) ng('A3', `${p} 的 <h1> 数量 = ${h1}（必须恰好 1）`);
  }
  const dup = Object.entries(titles).filter(([p, t]) => t && PAGES.some((q) => q !== p && titles[q] === t));
  if (dup.length) ng('A3', `title 重复：${dup.map(([p]) => p).join(', ')}`);
  if (!fail.some((f) => f.includes('[A3]'))) ok('A3', `title 唯一且非空、description 齐、每页恰好 1 个 h1`);

  /* A4 SEO/分享标签 */
  const need = [['canonical', /<link\s+rel="canonical"/i], ['og:title', /property="og:title"/i],
    ['og:image', /property="og:image"/i], ['og:description', /property="og:description"/i]];
  for (const p of PAGES) {
    const miss = need.filter(([n, re]) => !re.test(src[p])).map(([n]) => n);
    if (miss.length) ng('A4', `${p} 缺：${miss.join(', ')}`);
    /* 🔴 规范 URL 不得以 .html 结尾。CF Pages 的 clean-URL 会把 /x.html **308** 到 /x，
       所以写 .html 的 canonical / og:url 声明的是一条**永不 200** 的地址。
       实测（2026-09-28）：官网五页的 canonical 与 og:url、产品跳转壳的 canonical 全中
       —— 页面能开、306 后也正常，静态检查看不出任何异样，只有对着「最终地址」比才发现。
       在此把守，防以后写回。 */
    [['canonical', /<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i],
     ['og:url', /<meta[^>]*property="og:url"[^>]*content="([^"]+)"/i]].forEach(([n, re]) => {
      const m = src[p].match(re);
      if (m && /\.html$/i.test(m[1].trim())) {
        ng('A4', `${p} 的 ${n} 指向 .html（会被 308）→ 应写无扩展名 clean URL：${m[1].trim()}`);
      }
    });
  }
  if (!fail.some((f) => f.includes('[A4]'))) ok('A4', `canonical / og:title / og:image / og:description 五页齐，且规范 URL 均为 clean URL（不以 .html 结尾）`);

  /* A5 站内链接全部落到真实文件 */
  const bad = [];
  let checked = 0;
  for (const p of PAGES) {
    const dir = LAND;
    const re = /(?:href|src)="([^"]+)"/gi;
    let m;
    while ((m = re.exec(src[p]))) {
      const url = m[1].trim();
      if (/^(https?:|mailto:|tel:|data:|#)/i.test(url)) continue;
      let t = url.split('#')[0].split('?')[0];
      if (!t) continue;
      let fp = t.endsWith('/') ? path.join(dir, t, 'index.html') : path.join(dir, t);
      if (!fp.startsWith(LAND)) fp = path.normalize(fp);
      checked++;
      if (!fs.existsSync(fp)) bad.push(`${p} → ${url}`);
    }
  }
  if (bad.length) ng('A5', `站内链接指向不存在的文件 ${bad.length} 处：\n      ` + bad.join('\n      '));
  else ok('A5', `站内 href/src 全部可达（共核 ${checked} 处）`);

  /* A6 data-zh 与 data-zh-html 互斥 */
  for (const p of PAGES) {
    const both = (src[p].match(/data-zh-html="[^"]*"[^>]*data-zh="|data-zh="[^"]*"[^>]*data-zh-html="/g) || []).length;
    if (both) ng('A6', `${p} 有 ${both} 处元素同时带 data-zh 与 data-zh-html（行为未定义）`);
  }
  if (!fail.some((f) => f.includes('[A6]'))) ok('A6', `data-zh / data-zh-html 互斥（无重叠元素）`);

  /* A7 城市任务区数：**逐城真值校验**（不是句式黑名单）
     2026-09-28 在线上抓到真实错误：官网写「北京、上海、成都各 9 个真实任务区 /
     nine real-world zones each」—— 实际只有上海是 9，北京与成都各 4（合计 17）。
     这个数字此前**不被任何字段覆盖**（count_corpus 当时未导出 zones），于是没人看守、
     静静挂在官网上。现在两处都补齐：count_corpus 导出 guideZones，这里做数字校验。

     🔴 为什么不用「各 / each」句式黑名单（第一版就是这么写的，当场被自己抓到）：
        正确表述「北京与成都**各**有 4 个」「Beijing and Chengdu have 4 zones **each**」
        本身就带「各/each」。句式黑名单会把**改对了的文案**判失败 —— 那是逼着人删掉
        正确写法的假阳性，比没检查更危险（审计纪律：假阳性比漏检更坏，因为它会
        训练人无视闸门）。错误的本质不是句式，是**数字**：把单城数字套给了多城。
        所以判据改为：任何「城市 × 数字 × 任务区/zones」共现的**子句**，该数字必须
        等于子句内每座城市的现算真值；相符就放行，不符才失败。
     另：判据自带 SELFTEST（见 auditZoneSelfTest）—— 必须先证明它能抓住已知错误、
     且不误伤已知正确表述，才会去判页面。否则判据本身失效时闸门会静默放行。 */
  {
    const C = countCorpus(), ZG = C.guideZones || {};
    const DEF = [
      { zh: '上海', en: 'shanghai' }, { zh: '北京', en: 'beijing' }, { zh: '成都', en: 'chengdu' },
    ].map((c) => ({ ...c, n: ZG[c.zh] }));
    const miss = DEF.filter((c) => typeof c.n !== 'number');
    if (miss.length || typeof C.guideZonesTotal !== 'number') {
      ng('A7', `**无法执行**：count_corpus 未给出 ${miss.map((c) => c.zh).join('/') || 'guideZonesTotal'} 的真值`
        + ` ⇒ 本判据会空转（静默放行）。先修 count_corpus 再谈页面。`);
    } else {
      const st = auditZoneSelfTest(DEF, C.guideZonesTotal);
      if (st.bad.length) {
        ng('A7', `**判据自测未通过** ⇒ 下面的页面结果不可信：\n      ` + st.bad.join('\n      '));
      } else {
        const bad = [];
        /* 两个来源**分别记账**（可见文本 / data-zh 属性文案），不合并成一个总数。
           原因见 auditZoneNumbers 里那段注释：曾因 spread 字符串导致英文侧整体失明，
           而合计数仍 > 0 ⇒ 空转检测也报不出来。逐来源记账能把这种失明直接暴露成
           「某来源 0 配对」。两侧都要求 > 0 也不是新假设：B4「双语闭合」本就要求
           中英双写，任务区文案两侧都在。 */
        const SRC = {
          '可见文本': PAGES.map((p) => visibleText(src[p])),
          'data-zh 属性': PAGES.flatMap((p) => zhAttrs(src[p])),
        };
        const counts = {};
        for (const [name, texts] of Object.entries(SRC)) {
          const r = auditZoneNumbers(texts, DEF, C.guideZonesTotal);
          counts[name] = r.pairs;
          if (r.pairs === 0) bad.push(`**来源失明**：${name} 侧 0 处配对（该来源整体没被扫到，或文案已不含城市名）`);
        }
        for (const p of PAGES) {
          const r = auditZoneNumbers([visibleText(src[p]), ...zhAttrs(src[p])], DEF, C.guideZonesTotal);
          for (const f of r.fails) bad.push(`${p} → ${f}`);
        }
        const pairs = Object.values(counts).reduce((a, b) => a + b, 0);
        if (bad.some((x) => x.startsWith('**来源失明**'))) {
          ng('A7', '断言覆盖不完整（未证明数字正确，判为失败）：\n      ' + bad.join('\n      '));
        } else if (pairs === 0) {
          ng('A7', '**断言空转**：全站未找到任何「城市 × 数字 × 任务区/zones」配对'
            + '（文案被改写成不含城市名？）⇒ 无法证明数字正确，判为失败而非放行。');
        } else if (bad.length) {
          ng('A7', `城市任务区数字与现算口径不符（真值：上海 ${DEF[0].n} / 北京 ${DEF[1].n} / 成都 ${DEF[2].n}，合计 ${C.guideZonesTotal}）：\n      ` + bad.join('\n      '));
        } else {
          ok('A7', `城市任务区数字逐城对账通过（核对 ${pairs} 处配对 = 可见文本 ${counts['可见文本']} + data-zh 属性 ${counts['data-zh 属性']}；`
            + `真值 上海 ${DEF[0].n} / 北京 ${DEF[1].n} / 成都 ${DEF[2].n}，合计 ${C.guideZonesTotal}；`
            + `判据自测 ${st.badN} 反例全抓 / ${st.goodN} 正例全放行）`);
        }
      }
    }
  }

  return { badLinks: bad.length };
}

/* ══════════════════ B/C. 真跑 ══════════════════ */
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const corpus = countCorpus();
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  const apk = ver.apk || {};

  if (!QUICK) staticChecks();
  else { G('A 静态一致性'); ok('A*', '--quick：跳过静态组'); }
  if (STATIC_ONLY) report();

  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ channel: 'chrome' });

  const netBad = [];
  const jsErr = [];
  const keepSeen = {};      /* 每页 data-keep 计数（有意保留中文的元素），用于记账 */

  /* ── B. 逐页 × 逐视口 ── */
  G('B 真跑渲染');
  const grid = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => jsErr.push(`${page.url().split('/').pop()} [${vp.name}] pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') jsErr.push(`${page.url().split('/').pop()} [${vp.name}] console: ${m.text()}`); });
    page.on('response', (r) => {
      const u = r.url();
      if (u.startsWith(base) && r.status() >= 400) netBad.push(`[${vp.name}] ${r.status()} ${u.slice(base.length)}`);
    });
    page.on('requestfailed', (r) => {
      if (r.url().startsWith(base)) netBad.push(`[${vp.name}] FAILED ${r.url().slice(base.length)} (${(r.failure() || {}).errorText})`);
    });

    for (const p of PAGES) {
      await page.goto(`${base}/landing/${p}?lang=en`, { waitUntil: 'load' });
      await page.waitForTimeout(320);

      /* B3 横向溢出。诊断要能直接指到「最内层的越界元素 + 它的祖先链」，
         否则只报一句「scrollWidth 785 > 768」等于没报 —— 无从下手。 */
      const ov = await page.evaluate(() => {
        const iw = window.innerWidth;
        const hits = Array.from(document.querySelectorAll('body *')).filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.right > iw + 1;
        });
        /* 只留最内层：自身越界、但没有子元素也越界 —— 那才是「推宽」的源头 */
        const inner = hits.filter((e) => !Array.from(e.children).some((c) => hits.indexOf(c) > -1));
        const label = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
          (e.className && e.className.toString ? '.' + e.className.toString().trim().split(/\s+/).join('.') : '');
        const chain = inner.slice(0, 3).map((e) => {
          const path = [];
          for (let n = e; n && n !== document.body && path.length < 4; n = n.parentElement) path.unshift(label(n));
          const cs = getComputedStyle(e);
          return {
            path: path.join(' ← '),
            right: Math.round(e.getBoundingClientRect().right),
            w: Math.round(e.getBoundingClientRect().width),
            css: `overflow-x:${cs.overflowX} min-width:${cs.minWidth} white-space:${cs.whiteSpace}`,
            txt: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 46),
          };
        });
        return { sw: document.documentElement.scrollWidth, iw, n: hits.length, chain };
      });
      if (ov.sw > ov.iw + 1) {
        ng('B3', `${p} [${vp.name}] 横向溢出 scrollWidth=${ov.sw} > ${ov.iw}（越界元素 ${ov.n} 个）\n` +
          ov.chain.map((c) => `      ${c.path}\n        right=${c.right} w=${c.w} ${c.css}\n        文本: ${c.txt}`).join('\n'));
      }

      /* B4 双语闭合 —— en 模式无 CJK 残留。
         带 data-keep 的元素是「有意保留中文」（引用中文例句/语言自称），**要记账不要静默**：
         计数打出来供人工确认，避免 data-keep 被当成消音器滥用。 */
      const leak = await page.evaluate(() => {
        const out = [];
        let keep = 0;
        document.querySelectorAll('[data-zh]').forEach((el) => {
          if (el.hasAttribute('data-keep')) { keep++; return; }
          const t = el.textContent;
          if (/[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(t)) {
            out.push({ sel: el.tagName.toLowerCase() + (el.className ? '.' + el.className.toString().split(' ')[0] : ''), zh: el.getAttribute('data-zh'), en: t.trim().slice(0, 60) });
          }
        });
        return { leaks: out, keep };
      });
      keepSeen[p] = leak.keep;
      if (leak.leaks.length) ng('B4', `${p} en 模式中文残留 ${leak.leaks.length} 处：\n      ` +
        leak.leaks.slice(0, 8).map((l) => `${l.sel}  en="${l.en}"  data-zh="${l.zh}"`).join('\n      '));

      /* B4' zh 模式必须等于源码 data-zh（双向真换） */
      const htmlAttrs = await page.evaluate(() => Array.from(document.querySelectorAll('[data-zh-html]')).map((e) => e.dataset.zhHtml));
      await page.evaluate(() => window.SinokySite && window.SinokySite.applyLang('zh'));
      await page.waitForTimeout(180);
      const zhMismatch = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('[data-zh]').forEach((el) => {
          if (el.textContent !== el.dataset.zh) out.push({ sel: el.tagName.toLowerCase(), got: el.textContent.trim().slice(0, 50), want: (el.dataset.zh || '').slice(0, 50) });
        });
        return out;
      });
      if (zhMismatch.length) ng('B4', `${p} zh 模式与 data-zh 不一致 ${zhMismatch.length} 处：\n      ` +
        zhMismatch.slice(0, 6).map((l) => `${l.sel}  got="${l.got}"  want="${l.want}"`).join('\n      '));
      /* data-zh-html 的判据是「回填后 innerHTML 逐字符等于属性值」。
         这同时能抓到一类隐蔽缺陷：属性里写了裸的 `<!` 之类会被解析成注释/标签的形状，
         于是中文版会**悄悄丢字**（曾实测：&lt;!DOCTYPE 写成单层转义，中文版这一句整段消失）。 */
      const zhHtmlBad = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('[data-zh-html]').forEach((e) => {
          if (e.innerHTML === e.dataset.zhHtml) return;
          out.push({
            sel: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '.' + (e.className || '').toString().split(' ')[0]),
            got: e.innerHTML.replace(/\s+/g, ' ').trim().slice(0, 70),
            want: (e.dataset.zhHtml || '').replace(/\s+/g, ' ').trim().slice(0, 70),
          });
        });
        return out;
      });
      if (zhHtmlBad.length) ng('B4', `${p} zh 模式 data-zh-html 未生效 ${zhHtmlBad.length} 处：\n      ` +
        zhHtmlBad.slice(0, 5).map((l) => `${l.sel}\n        got : ${l.got}\n        want: ${l.want}`).join('\n      '));

      /* 回 en，供截图 */
      await page.evaluate(() => window.SinokySite && window.SinokySite.applyLang('en'));
      await page.waitForTimeout(150);

      grid.push({ p, vp: vp.name, ov: ov.sw - ov.iw, leak: leak.leaks.length, zhBad: zhMismatch.length + zhHtmlBad.length });
    }

    /* 截图：每视口 5 页。必须先做一次滚动遍历把 .fade 的入场观察器全部触发，
       否则 fullPage 截图里全是 opacity:0 的空白段落 —— 那是取证方式错了，不是页面错了
       （本项目真被这个坑套过一次：看到首页中段整片空白，差点当成布局缺陷去改）。 */
    for (const p of PAGES) {
      await page.goto(`${base}/landing/${p}?lang=en`, { waitUntil: 'load' });
      await page.waitForTimeout(320);
      await sweep(page);
      await page.screenshot({ path: path.join(SHOTS, `site-${p.replace('.html', '')}-${vp.name}.png`), fullPage: true });
    }
    await ctx.close();
  }

  if (netBad.length) ng('B1', `网络非 200 ${netBad.length} 处：\n      ` + [...new Set(netBad)].slice(0, 15).join('\n      '));
  else ok('B1', `页面与全部子资源 HTTP 全 200（${PAGES.length} 页 × ${VIEWPORTS.length} 视口）`);
  if (jsErr.length) ng('B2', `JS 错误 ${jsErr.length} 条：\n      ` + [...new Set(jsErr)].slice(0, 12).join('\n      '));
  else ok('B2', `零 pageerror / 零 console error`);
  if (!fail.some((f) => f.includes('[B3]'))) ok('B3', `三视口 ${VIEWPORTS.map((v) => v.w).join('/')} 无横向溢出`);
  if (!fail.some((f) => f.includes('[B4]'))) {
    ok('B4', `双语闭合：en 无中文残留、zh 与源码 data-zh 逐条相等`);
    ok('B4', `data-keep（有意保留中文，人工确认项）共计 ${JSON.stringify(keepSeen)} —— 引用中文例句/语言自称，非遗漏`);
  }

  /* ── B5 首页数字溯源 ── */
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.goto(`${base}/landing/index.html?lang=en`, { waitUntil: 'load' });
  await p2.waitForTimeout(300);
  const stats = await p2.$$eval('.stat b', (els) => els.map((e) => e.textContent.trim()));
  /* 「必说句」= 主句音频文件数（*_main.mp3 = 137），不是「409 − 变体」。
     这两者不相等，曾让本闸门自己报过一次假警：409 是 SENT_AUDIO 里**去重后的句子**数，
     而 137 主句 + 274 变体 = 411 条文件引用 ≠ 409（有的句子共用同一份音频）。
     口径取文件数更稳，且与首页文案「每句都有真人发音」直接对应。 */
  const wantStats = [String(corpus.audioMain), String(corpus.sentAudio),
    String(corpus.scenes), String(corpus.cities), String(corpus.flashcards), String(corpus.languages)];
  if (stats.join(',') !== wantStats.join(',')) {
    ng('B5', `首页 .stat 数字与语料口径不符\n      页面: ${stats.join(' / ')}\n      口径: ${wantStats.join(' / ')}（来自 count_corpus.cjs）`);
  } else ok('B5', `首页 .stat 六个数字 === 语料口径现算值（${wantStats.join(' / ')}）`);

  /* ── B6 features 数字出处表覆盖 ── */
  await p2.goto(`${base}/landing/features.html?lang=en`, { waitUntil: 'load' });
  await p2.waitForTimeout(300);
  const feat = await p2.evaluate(() => document.body.innerText);
  const must = [corpus.audioMain, corpus.sentAudio, corpus.scenes, corpus.cities, corpus.cityGuides,
    corpus.flashcards, corpus.languages, corpus.days];
  const miss = must.filter((n) => !new RegExp('(^|\\D)' + n + '(\\D|$)').test(feat));
  if (miss.length) ng('B6', `features 页缺数字出处条目：${miss.join(', ')}`);
  else ok('B6', `features 页「数字出处」逐个覆盖对外口径（${must.join(' / ')}）`);

  /* ── B7 活数据节点不变量（A7）──
     规则：JS 回填的节点标 data-live，且**不得**带 data-zh/data-zh-html、不得嵌在带这两者的
     元素内部。这条不变量是「切语言把版本号冲成 —」那类缺陷的结构性防线 —— 与其每次靠
     B4 抓到症状，不如从结构上禁止产生症状的形状。 */
  const liveBad = [];
  for (const p of PAGES) {
    await p2.goto(`${base}/landing/${p}?lang=en`, { waitUntil: 'load' });
    const r = await p2.evaluate(() => {
      const bad = [];
      document.querySelectorAll('[data-live]').forEach((el) => {
        const self = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '.' + (el.className || ''));
        if (el.hasAttribute('data-zh') || el.hasAttribute('data-zh-html')) bad.push('同元素既 data-live 又 data-zh*：' + self);
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          if (n.hasAttribute('data-zh') || n.hasAttribute('data-zh-html')) {
            bad.push(`data-live 嵌在 data-zh* 内：${self} ← ${n.tagName.toLowerCase()}.${(n.className || '').toString().split(' ')[0]}`);
            break;
          }
        }
      });
      return bad;
    });
    liveBad.push(...r.map((x) => `${p}: ${x}`));
  }
  /* 反向：download.js 里所有回填目标都必须标了 data-live（否则是「未声明的活节点」，
     下次有人给它加 data-zh 就会被静默冲掉） */
  const dj = fs.readFileSync(path.join(LAND, 'download.js'), 'utf8');
  const targets = [...new Set([
    ...[...dj.matchAll(/setText\('(#[A-Za-z0-9_-]+)'/g)].map((m) => m[1]),
    '[data-apk-filename]', '[data-apk-filename-cmd]',
  ])];
  await p2.goto(`${base}/landing/download.html?lang=en`, { waitUntil: 'load' });
  const undeclared = await p2.evaluate((sels) => sels.filter((s) => {
    const e = document.querySelector(s);
    return e && !e.hasAttribute('data-live');
  }), targets);
  if (undeclared.length) liveBad.push(`download.html: 回填目标未声明 data-live → ${undeclared.join(', ')}`);
  if (liveBad.length) ng('B7', `活数据节点不变量被破坏 ${liveBad.length} 处：\n      ` + liveBad.join('\n      '));
  else ok('B7', `data-live 不变量成立：${targets.length} 个回填目标均已声明，且无一嵌在 data-zh/data-zh-html 内`);

  /* ── B8 无 JS 可读性（内容不得依赖 JS 才可见）──
     入场动效最容易把方向写反：默认 opacity:0、靠 JS 加 .in 才显示。于是脚本一旦没跑
     （用户禁用 JS，或本站之前的某个脚本抛错），HTML 里内容俱全而屏幕上整片空白，
     而且**没有任何报错** —— 这是最难发现的一类缺陷，必须靠「真的把 JS 关掉」来验。 */
  {
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
    const pn = await nojs.newPage();
    await pn.goto(`${base}/landing/index.html`, { waitUntil: 'load' });
    const inv = await pn.evaluate(() => {
      const els = Array.from(document.querySelectorAll('.fade'));
      const hidden = els.filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.99);
      return {
        total: els.length, hidden: hidden.length,
        names: hidden.slice(0, 5).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + (e.className || '').toString().split(' ').join('.')),
        chars: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
      };
    });
    await nojs.close();
    if (inv.hidden) ng('B8', `禁用 JS 时 ${inv.hidden}/${inv.total} 个动效块不可见 ⇒ 内容靠 JS 才显示（脆弱）：${inv.names.join(', ')}`);
    else ok('B8', `禁用 JS：${inv.total} 个动效块全部可见、正文 ${inv.chars} 字符（内容不依赖 JS 才可读）`);
  }

  /* ── B9 链接可见性：真跑实测「计算色 vs 有效背景」 ──
     为什么静态查不出来、必须真跑：site.css 的裸 `a` 兜底是 `a{color:inherit}`
     —— 链接颜色**取决于祖先**。静态工具看到 `inherit` 只能放弃计算，
     而这恰是本项目历史上真踩过的坑（v0.23.9：裸 <a> 掉到 UA 默认 #0000EE，
     深色底上 1.86:1，等于看不见；浏览器零报错、语法完全合法）。
     判据按 WCAG AA：普通文字 ≥ 4.5，大字（≥24px，或 ≥18.66px 且粗体）≥ 3。
     有效背景 = 沿祖先链向上合成第一个不透明背景（半透明背景要逐层 over 合成），
     一路到根都没有就用页面底色兜底。 */
  {
    const lp = await ctx2.newPage();
    const total = { a: 0, chip: 0 };
    const bad = [];
    const unknown = [];
    for (const pg of PAGES) {
      await lp.goto(`${base}/landing/${pg}?lang=en`, { waitUntil: 'load' });
      await lp.waitForTimeout(260);
      const rows = await lp.evaluate(() => {
        const parse = (c) => {
          const m = String(c).match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const p = m[1].split(/[,\s/]+/).filter((x) => x !== '').map(parseFloat);
          return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !isNaN(p[3]) ? p[3] : 1 };
        };
        const lum = (c) => {
          const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
        const over = (fg, bg) => ({
          r: fg.r * fg.a + bg.r * (1 - fg.a),
          g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
        });
        const effBg = (el) => {
          let acc = null, n = el;
          while (n && n.nodeType === 1) {
            const c = parse(getComputedStyle(n).backgroundColor);
            if (c && c.a > 0) {
              acc = acc ? over(acc, c) : c;
              if (c.a >= 0.999) return acc;
            }
            n = n.parentElement;
          }
          return acc || { r: 20, g: 26, b: 36, a: 1 };   // 兜底 = --bg #141a24
        };
        const hasOwnText = (el) => Array.from(el.childNodes)
          .some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
        const ownBg = (el) => {
          const c = parse(getComputedStyle(el).backgroundColor);
          return (c && c.a > 0) ? c : null;
        };
        const probe = (el, kind) => {
          const cs = getComputedStyle(el);
          const fg = parse(cs.color);
          const bg = effBg(el);
          const fs = parseFloat(cs.fontSize) || 16;
          const bold = parseInt(cs.fontWeight, 10) >= 700;
          const r = (fg && bg) ? Math.round(ratio(fg, bg) * 100) / 100 : null;
          return {
            kind,
            t: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22),
            cls: String(el.className || ''),
            fs: Math.round(fs * 10) / 10, bold,
            need: (fs >= 24 || (bold && fs >= 18.66)) ? 3 : 4.5,
            r, color: cs.color,
            bgc: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
          };
        };
        const out = [];
        /* ① 所有链接：颜色由祖先决定（site.css 的兜底是 a{color:inherit}）⇒ 静态算不出，必须实测 */
        Array.from(document.querySelectorAll('a'))
          .filter((el) => el.getClientRects().length)
          .forEach((el) => out.push(probe(el, 'a')));
        /* ② 任何「自己画了背景、且自己带文字」的元素：白字压红底这类缺陷就住在这里。
            只查这一类（而非全页所有文字）是为了既不把继承来的普通正文算进来，
            又不放过 chip / badge / 自定义按钮 —— 它们是 <span>/<div>，① 抓不到。 */
        Array.from(document.querySelectorAll('body *'))
          .filter((el) => el.tagName !== 'A' && el.getClientRects().length && hasOwnText(el) && ownBg(el))
          .forEach((el) => out.push(probe(el, 'chip')));
        return out;
      });
      rows.forEach((x) => {
        total[x.kind]++;
        if (x.r === null) unknown.push(`${pg} 「${x.t}」`);
        else if (x.r < x.need) {
          bad.push(`${pg} ${x.cls ? '.' + x.cls.trim().split(/\s+/).join('.') + ' ' : ''}「${x.t}」${x.color} on ${x.bgc} = ${x.r}:1 < ${x.need}（${x.fs}px${x.bold ? ' bold' : ''}）`);
        }
      });
    }
    await lp.close();
    if (bad.length) ng('B9', `文字对比度不足 ${bad.length} 处：\n      ` + bad.slice(0, 12).join('\n      '));
    else ok('B9', `文字对比度达 WCAG AA：${total.a} 个链接 + ${total.chip} 个自绘背景文字元素`
      + `（普通 4.5 / 大字 3，实测计算色 vs 有效背景）`
      + (unknown.length ? `；${unknown.length} 处颜色含非 rgb 值无法计算` : ''));
  }

  /* ── C. 下载页专项 ──
     页面有两条**互斥**的渲染分支（完整态 / 元数据待回写态），而线上 version.json 在任一时刻
     只处于其中一种。若只跑「现状」，另一条分支的断言就要等下次发版或 CI 回写时才第一次执行
     —— 等于把验证推给线上。所以跑三次：现状 + 完整态夹具 + 待回写态夹具。
     后两者用 page.route 注入，与 CI 是否已回写**无关** ⇒ 两条分支永远都被真跑。 */
  G('C 下载页');
  /* 展示层惯用「v」前缀（v0.29.1），version.json 存的是裸版本号（0.29.1）。
     比对时剥掉前缀 —— 但**只剥前缀**，不放过任何其他差异：这样既能容忍显示约定，
     又仍然是「逐字符绑定」的强断言。 */
  const norm = (s) => (s || '').trim();
  const vnorm = (s) => (s || '').trim().replace(/^v/i, '');
  const VPROBE = () => {
    const vis = (s) => { const e = document.querySelector(s); return !!(e && e.getClientRects().length); };
    const a = document.querySelector('[data-apk-link]');
    return {
      ver: (document.querySelector('#apk-ver') || {}).textContent,
      size: (document.querySelector('#apk-size') || {}).textContent,
      md5: (document.querySelector('#apk-md5') || {}).textContent,
      file: (document.querySelector('#apk-filename') || {}).textContent,
      href: a ? a.getAttribute('href') : null,
      sizeVis: vis('#apk-size'), md5Vis: vis('#apk-md5'),
      pendingVis: vis('#apk-pending'), failVis: vis('#load-fail'),
      /* 首屏加载态（2026-09-28 新增）。注意**两条方向相反**的断言都要有：
         回填「之前」它必须可见（否则「—」又被裸留给用户 —— C8 守），
         回填「之后」它必须不可见（否则页面永远在说「正在读取」—— 下面守）。 */
      loadingVis: vis('#dl-loading'),
      busy: (() => { const c = document.querySelector('#dl-card'); return c ? c.getAttribute('aria-busy') : null; })(),
    };
  };
  const CASES = [
    { code: 'C1', label: '现状 version.json', shot: 'site-download-zh-md.png', patch: null },
    {
      code: 'C4', label: '完整态夹具（CI 已回写）', shot: 'site-download-full.png',
      // 夹具 md5 是**故意合成的**，只用于验证「页面确实逐字符绑定 version.json」，
      // 不冒充任何真实产物；真实 md5 由 CI 出包后回写。
      patch: (v) => { v.apk.md5 = '0123456789abcdef0123456789abcdef'; v.apk.size = 24152640; return v; },
    },
    {
      code: 'C7', label: '待回写态夹具（md5 空 / size 0）', shot: 'site-download-pending.png',
      patch: (v) => { v.apk.md5 = ''; v.apk.size = 0; return v; },
    },
  ];

  for (const cs of CASES) {
    const code = cs.code;
    const bad = (m) => ng(code, '[' + cs.label + '] ' + m);
    const p3 = await ctx2.newPage();
    let payload = null;
    if (cs.patch) {
      payload = cs.patch(JSON.parse(JSON.stringify(ver)));
      await p3.route('**/version.json*', (route) => route.fulfill({
        status: 200, contentType: 'application/json;charset=utf-8', body: JSON.stringify(payload),
      }));
    }
    await p3.goto(`${base}/landing/download.html?lang=en`, { waitUntil: 'load' });
    /* 🔴 等**条件**而不是等固定时间。定长等待会制造假阴性：本地 500ms 够、弱网不够，
       那时探针会把「还在进行」判成「没回填」，逼人去改本来正确的东西
       （线上版 shot_landing_live 正是这么翻过一次车）。顺带把回填耗时量出来
       —— 它就是「首屏占位窗口」这个指标本身，每跑一次都有数。 */
    const tFill = Date.now();
    await p3.waitForFunction(
      () => { const e = document.querySelector('#apk-ver'); return !!(e && e.textContent.trim() !== '—'); },
      null, { timeout: 10000 },
    ).catch(() => {});
    const fillMs = Date.now() - tFill;

    const eff = payload ? payload.apk : apk;        // 本用例的期望值
    const pendingMeta = !eff.md5 || !eff.size;
    const before = fail.length;
    const bind = await p3.evaluate(VPROBE);

    if (vnorm(bind.ver) !== vnorm(eff.version)) bad(`#apk-ver = "${norm(bind.ver)}"，应为 "${eff.version}"`);
    if (eff.url && norm(bind.href) !== eff.url) bad(`主按钮 href = "${norm(bind.href)}"，应 === "${eff.url}"`);
    if (norm(bind.file).indexOf(String(eff.version)) < 0) bad(`#apk-filename = "${norm(bind.file)}" 未含版本号 ${eff.version}`);
    if (pendingMeta) {
      if (bind.sizeVis) bad('#apk-size 仍可见（应为隐藏，不留裸「—」）');
      if (bind.md5Vis) bad('#apk-md5 仍可见（应为隐藏，不留裸「—」）');
      if (!bind.pendingVis) bad('缺 #apk-pending 显式说明（静默降级）');
      if (bind.failVis) bad('同时显示了 #load-fail —— 两种成因的说明互斥，不该并存');
    } else {
      if (!/^\d+(\.\d+)?\s*(MB|KB)$/i.test(norm(bind.size))) bad(`#apk-size 形态异常："${norm(bind.size)}"（应为「24.0 MB」形）`);
      if (norm(bind.md5).toLowerCase() !== String(eff.md5).toLowerCase()) bad(`#apk-md5 与 version.json 不符（页面 "${norm(bind.md5)}"）`);
      if (!bind.sizeVis) bad('完整态下 #apk-size 被隐藏了（有值就该显示）');
      if (!bind.md5Vis) bad('完整态下 #apk-md5 被隐藏了（有值就该显示）');
      if (bind.pendingVis) bad('完整态下不该出现 #apk-pending（元数据是齐的）');
    }
    /* ── A8 首屏加载态必须已被撤掉 ──
       「正在读取版本信息…」只有在**还在读**的时候才该出现。回填结束后它若还在，
       用户已经拿到结果、页面却还在说在读取 —— 比不给状态更坏。 */
    if (bind.loadingVis) bad('回填完成后 #dl-loading 仍可见 —— 加载态没撤，页面会一直说「正在读取」');
    if (bind.busy) bad(`回填完成后 #dl-card 的 aria-busy 仍是「${bind.busy}」—— 该摘掉`);

    /* 切语言不得清空（含「不得把已隐藏的待回写字段复活」） */
    await p3.evaluate(() => window.SinokySite && window.SinokySite.applyLang('zh'));
    await p3.waitForTimeout(400);
    const after = await p3.evaluate(VPROBE);
    if (vnorm(after.ver) !== vnorm(eff.version)) bad(`切中文后 #apk-ver 变成 "${norm(after.ver)}"（语言切换清空了 JS 回填值）`);
    if (pendingMeta) {
      if (after.md5Vis) bad(`切中文后 #apk-md5 变成可见的「${norm(after.md5)}」（隐藏的待回写字段被复活）`);
      if (!after.pendingVis) bad('切中文后 #apk-pending 说明丢失');
    } else if (norm(after.md5).toLowerCase() !== String(eff.md5).toLowerCase()) {
      bad(`切中文后 #apk-md5 被清空："${norm(after.md5)}"`);
    }

    /* 不得出现「无说明的占位」：有可见「—」就必须同时有显式降级说明。
       ⚠️ 只数**可见**占位 —— 隐藏元素（display:none）的 textContent 仍是「—」，
       拿 textContent 直接数会把「已正确隐藏」误判成「静默占位」。 */
    const dash = await p3.evaluate(() => {
      const vis = (e) => !!(e && e.getClientRects().length);
      const dashed = Array.from(document.querySelectorAll('#apk-ver,#apk-size,#apk-md5,#apk-filename'))
        .filter((e) => vis(e) && /^[—-]$/.test(e.textContent.trim()));
      return {
        n: dashed.length, ids: dashed.map((e) => '#' + e.id),
        explained: vis(document.querySelector('#load-fail')) || vis(document.querySelector('#apk-pending')),
      };
    });
    if (dash.n && !dash.explained) bad(`有 ${dash.n} 个可见占位「—」（${dash.ids.join(', ')}）且无任何显式降级说明`);

    if (fail.length === before) {
      ok(code, cs.label + '：版本绑定全等（' + eff.version
        + (pendingMeta ? ' · 体积/校验值已隐藏并有显式说明，无裸「—」' : ` / ${String(eff.md5).slice(0, 12)}… / ${eff.size}B`)
        + ' · 回填 ' + fillMs + 'ms）');
    }
    await p3.screenshot({ path: path.join(SHOTS, cs.shot), fullPage: true });
    await p3.close();
  }
  /* ── C8 首屏加载态：**反向验证**「它真的出现过」 ──
     ⚠️ 只在回填后断言「#dl-loading 已隐藏」是不够的：如果它压根没渲染过，
     那条断言同样恒真（「空断言恒真」的老坑）。所以这里把 version.json 人为延迟 900ms，
     在**等待窗口内**采样 —— 这才分得清「加载态生效」和「加载态不存在」。
     另外它顺手量出「首屏占位窗口」的真实长度：延迟多久，就该看到多久的加载态。 */
  {
    const p8 = await ctx2.newPage();
    await p8.route('**/version.json*', async (route) => {
      await new Promise((r) => setTimeout(r, 900));
      await route.continue();
    });
    await p8.goto(`${base}/landing/download.html?lang=en`, { waitUntil: 'domcontentloaded' });
    await p8.waitForTimeout(350);            // 仍在 900ms 延迟窗口内
    const during = await p8.evaluate(VPROBE);
    if (!during.loadingVis) ng('C8', '延迟窗口内 #dl-loading 不可见 —— 加载态没生效，用户看到的仍是裸「—」');
    if (during.busy !== 'true') ng('C8', `延迟窗口内 #dl-card 的 aria-busy = ${JSON.stringify(during.busy)}（应为 "true"）`);
    await p8.waitForFunction(
      () => { const e = document.querySelector('#dl-loading'); return !!(e && !e.getClientRects().length); },
      null, { timeout: 10000 },
    ).catch(() => {});
    const after8 = await p8.evaluate(VPROBE);
    if (after8.loadingVis) ng('C8', '回填结束后 #dl-loading 仍在（加载态没撤）');
    if (after8.busy) ng('C8', `回填结束后 aria-busy 仍在（${JSON.stringify(after8.busy)}）`);
    if (!fail.some((f) => f.includes('[C8]'))) {
      ok('C8', '首屏加载态：延迟窗口内可见且 aria-busy=true · 回填结束后自动撤掉（证明它不是「从没出现过」）');
    }
    await p8.screenshot({ path: path.join(SHOTS, 'site-download-loading.png') }).catch(() => {});
    await p8.close();
  }
  await ctx2.close();
  await browser.close();
  srv.close();

  /* ── 汇总 ── */
  report();
})().catch((e) => { console.error('✗ 验收脚本自身异常：' + (e && e.stack || e)); process.exit(2); });

/* 汇总与退出码（抽成函数是为了 --static-only 能走同一条收尾路径 —— 两份收尾代码
   迟早会分叉，然后「静态组失败但退出码 0」这种事就会悄悄发生）。 */
function report() {
  console.log('\n════════ 官网真跑验收 ════════');
  pass.forEach((l) => console.log('  ✓ ' + l));
  if (fail.length) {
    console.log('');
    fail.forEach((l) => console.log('  ✗ ' + l));
  }
  console.log('─────────────────────────────');
  console.log(`通过 ${pass.length} 项，失败 ${fail.length} 项`);
  if (STATIC_ONLY) console.log('（--static-only：仅 A 组，未启浏览器）');
  else console.log('截图：_internal/_shots/site-*.png');
  console.log('口径：node _internal/count_corpus.cjs（改文案后必须重跑）');
  process.exit(fail.length ? 1 : 0);
}
