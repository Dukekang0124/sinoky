# -*- coding: utf-8 -*-
# T4 图标兜底：用现有 icons/icon-512.png 生成 APK/PWA 需要的一套图标
# 豆包 A9（1024 + 自适应前景/背景）到位后由康哥替换，本脚本产物即作废
import io, os
from PIL import Image

ROOT = r"D:\写作工具\知识管理\01-Projects-项目\求职与作品集\03-作品集\Sinoky\sinoky-app"
SRC = os.path.join(ROOT, "icons", "icon-512.png")
OUT = os.path.join(ROOT, "..", "_internal", "apk-icons")  # git 外 + 不参与部署
os.makedirs(OUT, exist_ok=True)

BG = (20, 26, 36, 255)        # #141a24
img = Image.open(SRC).convert("RGBA")
print("source:", img.size, img.mode)

# 1) 1024 主图标（放大兜底）
icon1024 = img.resize((1024, 1024), Image.LANCZOS)
icon1024.save(os.path.join(OUT, "icon-1024.png"))

# 2) 自适应图标：前景 = 图标内容缩到 66%（Android 会裁切安全区），背景 = 纯色
fg = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
inner = img.resize((288, 288), Image.LANCZOS)          # 432 * 2/3
fg.paste(inner, ((432 - 288) // 2, (432 - 288) // 2), inner)
fg.save(os.path.join(OUT, "ic_launcher_foreground.png"))

bgimg = Image.new("RGBA", (432, 432), BG)
bgimg.save(os.path.join(OUT, "ic_launcher_background.png"))

# 3) 方形各尺寸（PWA/商店备用）
for s in (192, 512):
    img.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, "icon-%d.png" % s))

for f in sorted(os.listdir(OUT)):
    p = os.path.join(OUT, f)
    print("OK", f, Image.open(p).size, round(os.path.getsize(p) / 1024, 1), "KB")
