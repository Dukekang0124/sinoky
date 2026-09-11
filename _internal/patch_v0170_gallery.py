# -*- coding: utf-8 -*-
"""v0.17.0 原生保存到相册：给 CI 注入的 UpdatePlugin 加 saveImageToGallery
（重做版 —— 修正上一版的**偏移失效 bug**）

上一版的错：先算好 heredoc 终止符的字节偏移 j，然后先插入 7 行 import（这让 j 之后的所有
偏移都位移了），再用过期的 j 去切分文件 → 方法被插进了 downloadAndInstall 的函数体中间。
花括号平衡（13 开 / 18 闭）把它抓了出来。

本版改法：**全部用字符串替换，不依赖任何字节偏移**；并在插入前先断言方法自身的括号平衡。
"""
import os, subprocess

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W_PATH = os.path.join(APP, ".github", "workflows", "apk.yml")
b = open(W_PATH, "rb").read()
assert b.count(b"\n") == b.count(b"\r\n") and b.count(b"\r\n") > 100, "apk.yml 不是纯 CRLF"
assert b"saveImageToGallery" not in b, "已注入过，中止"
assert b.count(b'cat > "$PKGDIR/UpdatePlugin.java"') == 1

IND = " " * 10
TERM = b"\r\n          EOF\r\n"
assert b.count(TERM) == 1, f"heredoc 终止符命中 {b.count(TERM)} 次"

# ---------- ① 方法体（先断言自身括号平衡，再插入）----------
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
assert METHOD.count("{") == METHOD.count("}"), f"方法花括号不平衡 {METHOD.count('{')}/{METHOD.count('}')}"
assert METHOD.count("(") == METHOD.count(")"), f"方法圆括号不平衡 {METHOD.count('(')}/{METHOD.count(')')}"
print("方法自身括号平衡 OK：{ }", METHOD.count("{"), "| ( )", METHOD.count("("))

meth = "".join((IND + ln if ln.strip() else "") + "\n" for ln in METHOD.split("\n")).replace("\n", "\r\n")
b = b.replace(TERM, meth.encode("utf-8") + TERM)          # ← 字符串替换，不用偏移
print("① 方法已插入")

# ---------- ② 新增 import（字符串替换）----------
IMPORTS = ["import android.content.ContentResolver;", "import android.content.ContentValues;",
           "import android.graphics.Bitmap;", "import android.graphics.BitmapFactory;",
           "import android.provider.MediaStore;", "import android.util.Base64;",
           "import java.io.OutputStream;"]
ANCHOR = b"import android.content.Intent;\r\n"
assert b.count(ANCHOR) == 1
imp = "".join((IND + x + "\n") for x in IMPORTS).replace("\n", "\r\n").encode("utf-8")
b = b.replace(ANCHOR, ANCHOR + imp)
print("② import 已插入:", len(IMPORTS))

open(W_PATH, "wb").write(b)
W = b.decode("utf-8")
print("写盘:", len(b), "B | 裸LF:", b.count(b"\n") - b.count(b"\r\n"))
assert b.count(b"\n") == b.count(b"\r\n")

# ---------- ③ 独立复核：把方法块从文件里切出来再验一次 ----------
i = W.find("/* v0.17.0 分享卡片存相册")
j = W.find(TERM.decode("utf-8"), i)
blk = W[i:j]
print("\n=== 切出的方法块 ===")
print("  长度:", len(blk), "| 含 download failed:", "download failed" in blk)
print("  花括号:", blk.count("{"), "/", blk.count("}"), "-> 平衡:", blk.count("{") == blk.count("}"))
print("  圆括号:", blk.count("("), "/", blk.count(")"), "-> 平衡:", blk.count("(") == blk.count(")"))
assert "download failed" not in blk, "方法被插进了别的方法体内（偏移失效 bug 复发）"
assert blk.count("{") == blk.count("}"), "花括号不平衡"
assert blk.count("(") == blk.count(")")
assert blk.rstrip().endswith("}"), "方法没有以 } 收尾"
print("  首行:", blk.split("\r\n")[0])
print("  末行:", blk.split("\r\n")[-1])

# ---------- ④ 关键位置关系：方法必须在 downloadAndInstall 之后、EOF 之前 ----------
p_dl  = W.find("public void downloadAndInstall")
p_new = W.find("public void saveImageToGallery")
p_eof = W.find(TERM.decode("utf-8"))
print("\n顺序: downloadAndInstall", p_dl, "< saveImageToGallery", p_new, "< EOF", p_eof)
assert p_dl < p_new < p_eof, "插入位置不对"

# ---------- ⑤ YAML + 完整性 ----------
import yaml
y = yaml.safe_load(W)
runs = [st["run"] for job in y["jobs"].values() for st in job.get("steps", []) if st.get("run")]
assert any("saveImageToGallery" in r for r in runs), "方法没落在 run 脚本里"
print("\nYAML 解析 OK | run 步骤:", len(runs))
assert W.count("@PluginMethod") == 4, W.count("@PluginMethod")
assert W.count("registerPlugin(UpdatePlugin") >= 1, "插件注册语句被破坏"
assert W.count("::error::MainActivity not found") == 1, "后续步骤被破坏"
assert W.count(TERM.decode("utf-8")) == 1, "heredoc 终止符异常"
assert y["jobs"]["build"]["steps"], "步骤列表异常"
print("全部校验通过")
