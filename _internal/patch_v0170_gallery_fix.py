# -*- coding: utf-8 -*-
"""apk.yml 原生保存插件 —— 终版（在干净原始文件上一次性打对）

两次踩坑记录（都值得记住）：
  坑A 偏移失效：先算好 heredoc 终止符偏移 j，却先插入 import（移动了偏移），再用过期 j 切分
      → 方法被插进 downloadAndInstall 函数体中间。由「方法块花括号平衡」抓到。
  坑B 插到类外：heredoc 终止符 EOF 的上一行**正是类的闭合 `}`**，所以「插在 EOF 之前」=
      插到了类外面 → javac: class, interface, or enum expected（CI Build APK 失败）。
      而我当时的守卫只验了「在 downloadAndInstall 之后、EOF 之前」——恰好漏掉「必须在类内」。
  坑C 剪贴残留尾随空格：从类外剪出后再插回时，`}` 后面残留 10 个空格导致锚点失配。

本版：从 git 干净版一次性打；插入点 = **类闭合括号之前**；新增「类内深度」结构断言。
"""
import os, re, subprocess, shutil, sys

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GIT = shutil.which("git") or r"C:\Users\Admin\AppData\Local\hermes\git\cmd\git.EXE"
W_PATH = os.path.join(APP, ".github", "workflows", "apk.yml")

# 先回到未打插件补丁的版本（v0.16.0 终验提交），保证起点干净
CLEAN = "5ec0ceb"
r = subprocess.run([GIT, "-C", APP, "checkout", CLEAN, "--", ".github/workflows/apk.yml"],
                   capture_output=True, text=True, encoding="utf-8", errors="replace")
print("恢复干净版 rc:", r.returncode, (r.stderr or "").strip()[:150])
assert r.returncode == 0

b = open(W_PATH, "rb").read()
assert b.count(b"\n") == b.count(b"\r\n"), "不是纯 CRLF"
assert b"saveImageToGallery" not in b, "干净版里不该有我的方法"
print("干净版长度:", len(b), "| @PluginMethod:", b.count(b"@PluginMethod"))

START = b'cat > "$PKGDIR/UpdatePlugin.java"'
i = b.find(START); assert i > 0
CLS_TAIL = b"\r\n            }\r\n          }\r\n          EOF\r\n"   # 12空格} → 10空格} → EOF
assert b.count(CLS_TAIL) == 1, f"类尾锚点命中 {b.count(CLS_TAIL)} 次"
print("类尾锚点唯一 ✔（12空格} 收 downloadAndInstall → 10空格} 收类 → EOF）")

IND = " " * 10
METHOD = """/* v0.17.0 分享卡片存相册。
   Android 10+（API 29）起，往 MediaStore 写本 App 生成的图片不需要任何存储权限；
   API < 29 需要 WRITE_EXTERNAL_STORAGE，本项目未申请该权限 → 明确返回 saved:false，
   由前端回退到长按保存 —— 宁可不做，也不弹一个莫名其妙的授权给用户。 */
@PluginMethod
public void saveImageToGallery(final PluginCall call) {
  final String dataUrl = call.getString("dataUrl");
  final String filename = call.getString("filename");
  if (dataUrl == null || dataUrl.length() == 0) { call.reject("dataUrl required"); return; }
  final JSObject fail = new JSObject();
  fail.put("saved", false);
  if (Build.VERSION.SDK_INT < 29) { call.resolve(fail); return; }
  new Thread(new Runnable() {
    @Override
    public void run() {
      try {
        String b64 = dataUrl;
        int comma = b64.indexOf(',');
        if (comma >= 0) { b64 = b64.substring(comma + 1); }
        byte[] raw = Base64.decode(b64, Base64.DEFAULT);
        Bitmap bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length);
        if (bmp == null) { call.resolve(fail); return; }
        ContentValues cv = new ContentValues();
        String name = (filename == null || filename.length() == 0) ? "sinoky-share.png" : filename;
        cv.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        cv.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
        cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Sinoky");
        cv.put(MediaStore.Images.Media.IS_PENDING, 1);
        ContentResolver cr = getContext().getContentResolver();
        Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
        if (uri == null) { call.resolve(fail); return; }
        OutputStream os = cr.openOutputStream(uri);
        boolean ok = false;
        if (os != null) {
          bmp.compress(Bitmap.CompressFormat.PNG, 100, os);
          os.flush();
          os.close();
          ok = true;
        }
        cv.clear();
        cv.put(MediaStore.Images.Media.IS_PENDING, 0);
        cr.update(uri, cv, null, null);
        JSObject ret = new JSObject();
        ret.put("saved", ok);
        call.resolve(ret);
      } catch (Exception e) {
        call.resolve(fail);
      }
    }
  }).start();
}"""
assert METHOD.count("{") == METHOD.count("}") and METHOD.count("(") == METHOD.count(")")

meth = "".join((IND + ln if ln.strip() else "") + "\n" for ln in METHOD.split("\n")).replace("\n", "\r\n")
# 插入点：12空格} 之后、10空格} 之前 —— 即类内最后
b = b.replace(CLS_TAIL, b"\r\n            }\r\n" + meth.encode("utf-8") + b"\r\n          }\r\n          EOF\r\n")
print("① 方法已插入类内")

IMPORTS = ["import android.content.ContentResolver;", "import android.content.ContentValues;",
           "import android.graphics.Bitmap;", "import android.graphics.BitmapFactory;",
           "import android.provider.MediaStore;", "import android.util.Base64;",
           "import java.io.OutputStream;"]
ANCHOR = b"import android.content.Intent;\r\n"
assert b.count(ANCHOR) == 1
b = b.replace(ANCHOR, ANCHOR + "".join((IND + x + "\n") for x in IMPORTS).replace("\n", "\r\n").encode("utf-8"))
print("② import 已插入:", len(IMPORTS))

open(W_PATH, "wb").write(b)
W = b.decode("utf-8")
print("写盘:", len(b), "B | 裸LF:", b.count(b"\n") - b.count(b"\r\n"))
assert b.count(b"\n") == b.count(b"\r\n")

# ============ 结构断言（这次把「必须在类内」补上）============
i2 = W.find('cat > "$PKGDIR/UpdatePlugin.java"')
j2 = W.find("\r\n          EOF\r\n", i2)
java = W[i2:j2].split("\r\n", 1)[1]
nocom = re.sub(r"//[^\r\n]*", "", re.sub(r"/\*[\s\S]*?\*/", "", java))
lines = nocom.split("\n")
cls_open = myline = None
for n, ln in enumerate(lines, 1):
    if "class UpdatePlugin" in ln: cls_open = n
    if "public void saveImageToGallery" in ln: myline = n
depth = 0; cls_close = None; my_depth = None
for n, ln in enumerate(lines, 1):
    for ch in ln:
        if ch == "{": depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and cls_close is None and n >= (cls_open or 1): cls_close = n
    if n == myline: my_depth = depth
print(f"\n类开 {cls_open} | 类闭 {cls_close} | 方法行 {myline} | 方法处深度 {my_depth}")
assert my_depth is not None and my_depth >= 1, f"❌ 方法不在类内（深度 {my_depth}）"
assert cls_close is None or myline < cls_close, f"❌ 方法在类闭之后（{myline} >= {cls_close}）"
print("✅ 方法确在类内（深度 >= 1 且行号在类闭合之前）")

blk = W[W.find("/* v0.17.0 "):W.find("\r\n          EOF", W.find("/* v0.17.0 "))]
assert blk.count("{") == blk.count("}") and blk.count("(") == blk.count(")")
assert "download failed" not in blk and "call.resolve();          /*" not in blk
print("✅ 方法块自身括号平衡、未混入他人代码")

import yaml
y = yaml.safe_load(W)
runs = [st["run"] for job in y["jobs"].values() for st in job.get("steps", []) if st.get("run")]
assert any("saveImageToGallery" in x for x in runs)
assert W.count("@PluginMethod") == 4 and W.count("registerPlugin(UpdatePlugin") >= 1
assert W.count("\r\n          EOF\r\n") == 1
print("✅ YAML 合法 | run 步骤", len(runs), "| @PluginMethod", W.count("@PluginMethod"),
      "| import 数", sum(1 for l in W.split("\r\n") if l.strip().startswith("import ")))
print("\n全部通过")
