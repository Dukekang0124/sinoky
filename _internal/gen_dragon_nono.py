# -*- coding: utf-8 -*-
"""生成 金龙盘诺诺 主视觉 assets/brand/dragon-nono.svg
关键手法：
1. 龙身 = 沿中心线采样 + 法线偏移生成「变宽实心多边形」（近头粗 60 → 近尾细 13），
   彻底解决等粗描边像软管的问题；鳍/鳞/爪全部由中心线参数化定位。
2. 遮挡 = 龙身画两遍：一遍在诺诺身后，一遍裁剪到诺诺剪影（clipPath）后压在诺诺身上，
   零接缝、无需切分路径。
3. 配色与诺诺原型统一：深墨绿 #16302C 描边、奶白 #FBF6E9、卫衣红 #D8402F、肉垫粉 #EE8A7A。
"""
import math, os

APP = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
OUT = os.path.join(APP, "assets", "brand", "dragon-nono.svg")

INK = "#16302C"      # 统一描边（诺诺原型同色）
GOLD = "#D9B678"     # 龙身鎏金
GOLD_LT = "#F2E4C4"  # 龙腹/高光
GOLD_DK = "#A8834A"
RED = "#D8402F"      # 卫衣红 / 龙鬃 / 背鳍
CREAM = "#FBF6E9"    # 奶白绒毛
PINK = "#EE8A7A"     # 肉垫/腮红
TEAL = "#8ab8b2"

# 龙身中心线：4 段三次贝塞尔（颈→过顶→左侧→底→尾）
SEGS = [
    ((560, 345), (610, 250), (490, 194), (340, 200)),
    ((340, 200), (210, 205), (132, 270), (150, 392)),
    ((150, 392), (166, 500), (210, 596), (340, 612)),
    ((340, 612), (450, 622), (528, 590), (582, 522)),
]


def bez(p0, c1, c2, p1, t):
    m = 1 - t
    return (m**3*p0[0] + 3*m*m*t*c1[0] + 3*m*t*t*c2[0] + t**3*p1[0],
            m**3*p0[1] + 3*m*m*t*c1[1] + 3*m*t*t*c2[1] + t**3*p1[1])


def sample(n_per=48):
    pts = []
    for i, s in enumerate(SEGS):
        for k in range(n_per + (1 if i == len(SEGS) - 1 else 0)):
            t = k / n_per
            u = (i + t) / len(SEGS)
            pts.append((u, bez(*s, t)))
    return pts


PTS = sample()
US = [p[0] for p in PTS]


def geom_at(u):
    """返回 (点, 单位切向, 外法线, 半宽)"""
    i = min(range(len(US)), key=lambda k: abs(US[k] - u))
    i2 = min(max(i + 1, 1), len(PTS) - 1)
    i1 = max(i2 - 1, 0)
    p = PTS[i][1]
    dx = PTS[i2][1][0] - PTS[i1][1][0]
    dy = PTS[i2][1][1] - PTS[i1][1][1]
    L = math.hypot(dx, dy) or 1
    tx, ty = dx / L, dy / L
    nx, ny = -ty, tx          # 外法线方向
    w = 13 + 47 * ((1 - u) ** 0.72)
    return p, (tx, ty), (nx, ny), w


def poly(u0, u1, pad):
    """生成从 u0 到 u1 的变宽带状多边形（闭合路径数据）"""
    sel = [p for p in PTS if u0 - 1e-9 <= p[0] <= u1 + 1e-9]
    if len(sel) < 3:
        sel = PTS[:6]
    left, right = [], []
    for u, pt in sel:
        i = min(range(len(US)), key=lambda k: abs(US[k] - u))
        i2 = min(max(i + 1, 1), len(PTS) - 1)
        i1 = max(i2 - 1, 0)
        dx = PTS[i2][1][0] - PTS[i1][1][0]
        dy = PTS[i2][1][1] - PTS[i1][1][1]
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        h = (13 + 47 * ((1 - u) ** 0.72)) / 2 + pad
        left.append((pt[0] + nx * h, pt[1] + ny * h))
        right.append((pt[0] - nx * h, pt[1] - ny * h))
    seq = left + right[::-1]
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in seq) + " Z"
    return d


def centerline(u0, u1, off, step=0.01):
    """沿中心线偏移 off（外法线正向）的折线 path（用于腹线高光）"""
    out, u = [], u0
    while u <= u1 + 1e-9:
        p, t, n, w = geom_at(u)
        out.append((p[0] + n[0] * off, p[1] + n[1] * off))
        u += step
    return "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in out)


def fins(u_list, sizes):
    out = []
    for u, ln in zip(u_list, sizes):
        p, t, n, w = geom_at(u)
        bw = w * 0.36
        ox, oy = p[0] + n[0] * (w / 2), p[1] + n[1] * (w / 2)
        b1 = (ox - t[0] * bw, oy - t[1] * bw)
        b2 = (ox + t[0] * bw, oy + t[1] * bw)
        tip = (ox + n[0] * ln, oy + n[1] * ln)
        out.append(f'<path d="M{b1[0]:.1f},{b1[1]:.1f} L{tip[0]:.1f},{tip[1]:.1f} L{b2[0]:.1f},{b2[1]:.1f} Z" fill="{RED}"/>')
    return "\n      ".join(out)


def scales(u0, u1, step=0.052):
    out, u = [], u0
    while u <= u1:
        p, t, n, w = geom_at(u)
        a = (p[0] - n[0] * w * 0.34, p[1] - n[1] * w * 0.34)
        b = (p[0] + n[0] * w * 0.30, p[1] + n[1] * w * 0.30)
        out.append(f'M{a[0]:.1f},{a[1]:.1f} L{b[0]:.1f},{b[1]:.1f}')
        u += step
    return " ".join(out)


# 爪：取 u=0.90 处的龙身，向内伸出前肢
CP, CT, CN, CW = geom_at(0.90)

body_filled = f"""    <path d="{poly(0.0, 0.62, 5)}" fill="{INK}"/>
    <path d="{poly(0.38, 1.0, 5)}" fill="{INK}"/>
    <path d="{poly(0.0, 0.62, 0)}" fill="{GOLD}"/>
    <path d="{poly(0.38, 1.0, 0)}" fill="{GOLD}"/>
    <path d="{centerline(0.02, 0.60, -13)}" fill="none" stroke="{GOLD_LT}" stroke-width="6" stroke-linecap="round" opacity=".5"/>
    <path d="{centerline(0.40, 0.97, -13)}" fill="none" stroke="{GOLD_LT}" stroke-width="6" stroke-linecap="round" opacity=".45"/>
    <path d="{scales(0.07, 0.58)}" fill="none" stroke="{INK}" stroke-width="2.4" opacity=".18" stroke-linecap="round"/>
    <path d="{scales(0.63, 0.95)}" fill="none" stroke="{INK}" stroke-width="2.4" opacity=".18" stroke-linecap="round"/>
    {fins([0.055, 0.115, 0.185, 0.255, 0.325, 0.395], [30, 33, 32, 29, 26, 23])}"""

HEAD = f"""  <g id="dn-head" transform="translate(556,280) scale(.94)">
    <g stroke="{INK}" stroke-width="20" stroke-linecap="round" fill="none">
      <path d="M-16,-46 C-24,-76 -18,-108 -4,-132"/>
      <path d="M-12,-98 C-28,-108 -38,-120 -42,-136"/>
      <path d="M-4,-76 C10,-84 20,-92 24,-104"/>
      <path d="M26,-42 C32,-72 44,-94 62,-108"/>
      <path d="M44,-78 C58,-82 68,-88 74,-100"/>
      <path d="M36,-58 C50,-62 60,-68 66,-78"/>
    </g>
    <path d="M30,-50 C60,-70 96,-70 116,-52 C92,-48 66,-40 44,-28 Z" fill="{RED}" stroke="{INK}" stroke-width="6"/>
    <path d="M40,-30 C76,-34 106,-16 116,10 C92,-2 62,-6 40,-6 Z" fill="{RED}" stroke="{INK}" stroke-width="6"/>
    <path d="M40,-8 C74,0 96,20 100,48 C82,26 60,14 38,10 Z" fill="{RED}" stroke="{INK}" stroke-width="6"/>
    <path d="M34,12 C62,26 74,50 70,76 C58,52 42,34 26,24 Z" fill="{RED}" stroke="{INK}" stroke-width="6"/>
    <path d="M42,-34 C64,-46 84,-40 88,-20 C74,-8 52,-12 42,-34 Z" fill="{GOLD}" stroke="{INK}" stroke-width="8"/>
    <g stroke="{GOLD_LT}" stroke-width="11" stroke-linecap="round" fill="none">
      <path d="M-16,-46 C-24,-76 -18,-108 -4,-132"/>
      <path d="M-12,-98 C-28,-108 -38,-120 -42,-136"/>
      <path d="M-4,-76 C10,-84 20,-92 24,-104"/>
      <path d="M26,-42 C32,-72 44,-94 62,-108"/>
      <path d="M44,-78 C58,-82 68,-88 74,-100"/>
      <path d="M36,-58 C50,-62 60,-68 66,-78"/>
    </g>
    <circle cx="0" cy="0" r="57" fill="{INK}"/>
    <ellipse cx="-70" cy="2" rx="47" ry="34" fill="{INK}"/>
    <path d="M-108,18 C-84,38 -44,44 -16,34 C-30,20 -72,10 -108,18 Z" fill="#8E2A20"/>
    <ellipse cx="-62" cy="40" rx="38" ry="21" fill="{INK}"/>
    <circle cx="0" cy="0" r="52" fill="{GOLD}"/>
    <ellipse cx="-70" cy="2" rx="42" ry="29" fill="{GOLD}"/>
    <ellipse cx="-62" cy="40" rx="33" ry="16" fill="{GOLD}"/>
    <path d="M-100,4 C-72,16 -36,22 -6,18" fill="none" stroke="{INK}" stroke-width="4" opacity=".35" stroke-linecap="round"/>
    <path d="M-96,22 L-88,40 L-78,26 Z" fill="{CREAM}" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M-62,30 L-56,44 L-46,32 Z" fill="{CREAM}" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>
    <ellipse cx="-18" cy="-24" rx="20" ry="19" fill="{CREAM}" stroke="{INK}" stroke-width="5"/>
    <circle cx="-16" cy="-22" r="11" fill="{INK}"/>
    <circle cx="-22" cy="-29" r="4.5" fill="{CREAM}"/>
    <path d="M-48,-42 C-28,-54 -2,-54 16,-44" fill="none" stroke="{INK}" stroke-width="12" stroke-linecap="round"/>
    <path d="M-118,-16 C-126,-30 -114,-38 -100,-34 C-106,-26 -110,-20 -118,-16 Z" fill="{GOLD}" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
    <ellipse cx="-108" cy="-22" rx="6" ry="5" fill="{INK}"/>
    <path d="M-112,-30 C-124,-34 -130,-22 -122,-14" fill="none" stroke="{INK}" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M-114,-24 C-130,-36 -138,-56 -132,-70" fill="none" stroke="{RED}" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M-106,-30 C-122,-44 -130,-62 -124,-76" fill="none" stroke="{RED}" stroke-width="4" stroke-linecap="round" opacity=".85"/>
  </g>"""

NONO = f"""  <g id="dn-nono" transform="translate(0,-16)">
    <ellipse cx="340" cy="664" rx="50" ry="19" fill="{CREAM}" stroke="{INK}" stroke-width="5"/>
    <ellipse cx="302" cy="678" rx="33" ry="21" fill="{INK}"/>
    <ellipse cx="382" cy="678" rx="33" ry="21" fill="{INK}"/>
    <path d="M262,556 C232,530 212,504 208,482" fill="none" stroke="{INK}" stroke-width="56" stroke-linecap="round"/>
    <path d="M262,556 C232,530 212,504 208,482" fill="none" stroke="{RED}" stroke-width="46" stroke-linecap="round"/>
    <circle cx="270" cy="302" r="36" fill="{INK}"/>
    <circle cx="410" cy="302" r="36" fill="{INK}"/>
    <path d="M240,516 C228,600 236,640 258,658 L422,658 C444,640 452,600 440,516 C404,542 276,542 240,516 Z" fill="{RED}" stroke="{INK}" stroke-width="6"/>
    <path d="M330,290 C328,272 332,258 340,250 C344,264 344,278 342,290 Z" fill="{CREAM}" stroke="{INK}" stroke-width="4"/>
    <path d="M342,290 C346,270 354,258 364,252 C364,268 358,280 352,290 Z" fill="{CREAM}" stroke="{INK}" stroke-width="4"/>
    <path d="M318,292 C314,278 314,266 320,258 C326,268 328,280 328,291 Z" fill="{CREAM}" stroke="{INK}" stroke-width="4"/>
    <ellipse cx="340" cy="398" rx="104" ry="98" fill="{CREAM}" stroke="{INK}" stroke-width="7"/>
    <ellipse cx="298" cy="392" rx="34" ry="40" fill="{INK}" transform="rotate(-20 298 392)"/>
    <ellipse cx="382" cy="392" rx="34" ry="40" fill="{INK}" transform="rotate(20 382 392)"/>
    <circle cx="304" cy="392" r="19" fill="{CREAM}" stroke="{INK}" stroke-width="3.5"/>
    <circle cx="306" cy="393" r="11" fill="{INK}"/>
    <circle cx="301" cy="387" r="4" fill="{CREAM}"/>
    <path d="M362,398 Q382,372 402,398" fill="none" stroke="{CREAM}" stroke-width="7" stroke-linecap="round"/>
    <path d="M328,428 Q340,419 352,428 Q352,444 340,445 Q328,444 328,428 Z" fill="{INK}"/>
    <path d="M316,450 Q340,478 364,450 Z" fill="#8E2A20"/>
    <ellipse cx="340" cy="466" rx="9" ry="5" fill="#E8796E"/>
    <ellipse cx="254" cy="438" rx="18" ry="10" fill="{PINK}" opacity=".45"/>
    <ellipse cx="426" cy="438" rx="18" ry="10" fill="{PINK}" opacity=".45"/>
    <path d="M232,548 C228,502 274,490 340,490 C406,490 452,502 448,548 C402,568 278,568 232,548 Z" fill="{RED}" stroke="{INK}" stroke-width="6"/>
    <path d="M320,512 C318,530 317,546 316,560" fill="none" stroke="{CREAM}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="316" cy="563" r="5" fill="{CREAM}" stroke="{INK}" stroke-width="2.5"/>
    <path d="M362,512 C364,530 365,546 366,560" fill="none" stroke="{CREAM}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="366" cy="563" r="5" fill="{CREAM}" stroke="{INK}" stroke-width="2.5"/>
    <rect x="298" y="586" width="84" height="56" rx="12" fill="#C43A2A" stroke="{INK}" stroke-width="5"/>
    <ellipse cx="202" cy="466" rx="31" ry="29" fill="{INK}"/>
    <ellipse cx="202" cy="455" rx="7" ry="6" fill="{PINK}"/>
    <ellipse cx="186" cy="473" rx="6.5" ry="5" fill="{PINK}"/>
    <ellipse cx="219" cy="473" rx="6.5" ry="5" fill="{PINK}"/>
    <ellipse cx="202" cy="481" rx="11" ry="8" fill="{PINK}"/>
    <path d="M428,552 C452,576 460,596 458,614" fill="none" stroke="{INK}" stroke-width="52" stroke-linecap="round"/>
    <path d="M428,552 C452,576 460,596 458,614" fill="none" stroke="{RED}" stroke-width="42" stroke-linecap="round"/>
    <ellipse cx="460" cy="626" rx="26" ry="24" fill="{INK}"/>
  </g>"""

CLAW = f"""  <g id="dn-claw">
    <path d="M{CP[0]:.0f},{CP[1]:.0f} C466,586 442,596 428,612" fill="none" stroke="{INK}" stroke-width="36" stroke-linecap="round"/>
    <path d="M{CP[0]:.0f},{CP[1]:.0f} C466,586 442,596 428,612" fill="none" stroke="{GOLD}" stroke-width="28" stroke-linecap="round"/>
    <g stroke="{INK}" stroke-width="9" stroke-linecap="round" fill="none">
      <path d="M438,606 C430,620 424,630 420,640"/>
      <path d="M450,616 C446,630 444,640 442,648"/>
      <path d="M464,622 C464,636 464,644 462,652"/>
    </g>
  </g>"""

CLOUDS = f"""  <g opacity=".28">
    <use href="#dn-cloud" transform="translate(120,112)"/>
    <use href="#dn-cloud" transform="translate(430,92) scale(.72)"/>
    <use href="#dn-cloud" transform="translate(66,556) scale(.58)"/>
    <use href="#dn-cloud" transform="translate(628,660) scale(.5)"/>
  </g>"""

SEAL = f"""  <path d="M40,700 H640" stroke="#c9a86c" stroke-width="1.5" opacity=".35"/>
  <rect x="40" y="706" width="600" height="26" fill="url(#dn-meander)" opacity=".4"/>
  <rect x="574" y="608" width="64" height="64" rx="10" fill="#C2362B" stroke="#F5F1E8" stroke-width="3"/>
  <path d="M606,616 v6" stroke="#F5F1E8" stroke-width="4" stroke-linecap="round"/>
  <path d="M588,628 H624" stroke="#F5F1E8" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M596,638 H616" stroke="#F5F1E8" stroke-width="4.5" stroke-linecap="round"/>
  <rect x="592" y="646" width="28" height="20" rx="2" fill="none" stroke="#F5F1E8" stroke-width="4.5"/>"""

svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 760" width="680" height="760" preserveAspectRatio="xMidYMid meet" role="img" aria-label="金龙盘诺诺">
  <defs>
    <g id="dn-cloud">
      <path d="M-30,0 H30" stroke="{TEAL}" stroke-width="6" stroke-linecap="round" fill="none"/>
      <circle cx="-18" cy="-8" r="14" fill="none" stroke="{TEAL}" stroke-width="4"/>
      <circle cx="4" cy="-16" r="19" fill="none" stroke="{TEAL}" stroke-width="4"/>
      <circle cx="24" cy="-6" r="12" fill="none" stroke="{TEAL}" stroke-width="4"/>
      <path d="M-40,6 a10,10 0 1 0 8,-16" fill="none" stroke="{TEAL}" stroke-width="4" stroke-linecap="round"/>
    </g>
    <pattern id="dn-meander" width="30" height="26" patternUnits="userSpaceOnUse">
      <path d="M3,24 V5 H27 V24 H11 V11 H19" fill="none" stroke="#c9a86c" stroke-width="2.5" stroke-linejoin="round"/>
    </pattern>
    <g id="dn-body">
{body_filled}
    </g>
    <clipPath id="dn-nono-clip">
      <ellipse cx="340" cy="382" rx="114" ry="108"/>
      <path d="M228,492 C214,584 224,638 250,666 L432,666 C458,638 468,584 454,492 Z"/>
      <path d="M220,528 C216,478 268,464 340,464 C412,464 464,478 460,528 C410,554 270,554 220,528 Z"/>
      <circle cx="460" cy="610" r="36"/>
      <circle cx="202" cy="450" r="41"/>
    </clipPath>
  </defs>

{CLOUDS}

  <use href="#dn-body"/>
  <path d="M582,522 C614,500 648,492 668,500 C650,522 630,538 604,546 C612,526 604,514 582,522 Z" fill="{RED}" stroke="{INK}" stroke-width="6"/>

  {NONO}

  <g clip-path="url(#dn-nono-clip)"><use href="#dn-body"/></g>
  {CLAW}
  {HEAD}

{SEAL}
</svg>
"""
open(OUT, "wb").write(svg.encode("utf-8"))
print("written", OUT, len(svg), "bytes")
print("body samples:", len(PTS))
