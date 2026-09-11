# -*- coding: utf-8 -*-
"""apk.yml 原生保存插件 —— v3（修 lint NewApi + 加失败诊断）

前两轮 CI 都停在「Build APK」exit 1，只有 `Process completed with exit code 1` 一条注解，
拿不到 javac/lint 原文（日志端点需鉴权，且拿 token 的命令被安全策略拦下）。

根因推断（与「能过注入步骤、只在 gradle 挂」这一现象一致）：
  API 29 的 MediaStore 常量（RELATIVE_PATH / IS_PENDING）写在线程的**匿名内部类**里。
  lint 的 NewApi 检查**跨不过匿名类边界**——匿名类里看不到外层方法里的 `SDK_INT` 早退守卫，
  于是判定「调用了高于 minSdk 的 API」→ assembleRelease 会跑 lintVitalRelease → 失败。
修法：把 API 29 的代码挪进一个单独标注 `@TargetApi(29)` 的私有方法，调用方保持早退判断。

另外给 workflow 的「Build APK」步骤加失败诊断：把 gradle 输出 tee 到文件，失败时
把 error 行以 `::error:` 注解抛出来 —— 这样下次失败能直接看到原文，不用再赌一轮。
"""
import os, re, subprocess, shutil

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GIT = shutil.which("git") or r"C:\Users\Admin\AppData\Local\hermes\git\cmd\git.EXE"
W_PATH = os.path.join(APP, ".github", "workflows", "apk.yml")

# ---- 从干净版（v0.16.0 终验提交，未含任何插件补丁）重打 ----
r = subprocess.run([GIT, "-C", APP, "checkout", "5ec0ceb", "--", ".github/workflows/apk.yml"],
                   capture_output=True, text=True, encoding="utf-8", errors="replace")
assert r.returncode == 0, r.stderr
b = open(W_PATH, "rb").read()
assert b"saveImageToGallery" not in b and b.count(b"\n") == b.count(b"\r\n")
print("干净起点:", len(b), "B")

IND = " " * 10
START = b'cat > "$PKGDIR/UpdatePlugin.java"'
CLS_TAIL = b"\r\n            }\r\n          }\r\n          EOF\r\n"
assert b.find(START) > 0 and b.count(CLS_TAIL) == 1

# ============================================================
# ① 方法（API 29 的部分单独放 @TargetApi(29) 私有方法）
# ============================================================
METHOD = """/* v0.17.0 分享卡片存相册。
   Android 10+（API 29）起，往 MediaStore 写本 App 生成的图片不需要任何存储权限；
   API < 29 需要 WRITE_EXTERNAL_STORAGE，本项目未申请该权限 → 明确返回 saved:false，
   由前端回退到长按保存 —— 宁可不做，也不弹一个莫名其妙的授权给用户。

   ⚠️ 结构铁律（踩坑记录）：用到 API 29 常量的代码**必须集中在单个 @TargetApi(29) 方法内**。
   若写在线程的匿名内部类里，lint 的 NewApi 检查跨不过匿名类边界（匿名类里看不到外层
   方法的 SDK_INT 早退守卫）→ assembleRelease 会跑 lintVitalRelease 而失败，
   表现为 CI「Build APK」exit 1，且注解里只有一句 exit code 1，极难定位。 */
@PluginMethod
public void saveImageToGallery(final PluginCall call) {
  final String dataUrl = call.getString("dataUrl");
  final String filename = call.getString("filename");
  if (dataUrl == null || dataUrl.length() == 0) { call.reject("dataUrl required"); return; }
  final JSObject out = new JSObject();
  out.put("saved", false);
  if (Build.VERSION.SDK_INT < 29) { call.resolve(out); return; }
  final String name = (filename == null || filename.length() == 0) ? "sinoky-share.png" : filename;
  final byte[] raw = decodeDataUrl(dataUrl);
  if (raw == null) { call.resolve(out); return; }
  new Thread(new Runnable() {
    @Override
    public void run() {
      boolean ok = false;
      try { ok = writeToGallery(raw, name); } catch (Exception e) { ok = false; }
      JSObject ret = new JSObject();
      ret.put("saved", ok);
      call.resolve(ret);
    }
  }).start();
}

/* data:image/png;base64,xxxx → 原始字节。只用 android.util.Base64（API 8），不涉及新 API。 */
private byte[] decodeDataUrl(String dataUrl) {
  try {
    String b64 = dataUrl;
    int comma = b64.indexOf(',');
    if (comma >= 0) { b64 = b64.substring(comma + 1); }
    return Base64.decode(b64, Base64.DEFAULT);
  } catch (Exception e) {
    return null;
  }
}

/* 写进系统相册：MediaStore + RELATIVE_PATH（API 29+）→ 零存储权限。
   @TargetApi(29) 是对 lint 的显式声明：调用方已做 SDK_INT 早退，但 lint 跨不过
   匿名内部类边界，所以这里必须显式标注，否则 release 构建的 lintVital 会失败。 */
@android.annotation.TargetApi(29)
private boolean writeToGallery(byte[] raw, String name) throws Exception {
  Bitmap bmp = BitmapFactory.decodeByteArray(raw, 0, raw.length);
  if (bmp == null) { return false; }
  ContentValues cv = new ContentValues();
  cv.put(MediaStore.Images.Media.DISPLAY_NAME, name);
  cv.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
  cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Sinoky");
  cv.put(MediaStore.Images.Media.IS_PENDING, 1);
  ContentResolver cr = getContext().getContentResolver();
  Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
  if (uri == null) { return false; }
  OutputStream os = cr.openOutputStream(uri);
  if (os == null) { return false; }
  bmp.compress(Bitmap.CompressFormat.PNG, 100, os);
  os.flush();
  os.close();
  cv.clear();
  cv.put(MediaStore.Images.Media.IS_PENDING, 0);
  cr.update(uri, cv, null, null);
  return true;
}"""
assert METHOD.count("{") == METHOD.count("}"), (METHOD.count("{"), METHOD.count("}"))
assert METHOD.count("(") == METHOD.count(")")
print("方法括号平衡:", METHOD.count("{"), METHOD.count("("))

meth = "".join((IND + ln if ln.strip() else "") + "\n" for ln in METHOD.split("\n")).replace("\n", "\r\n")
b = b.replace(CLS_TAIL, b"\r\n            }\r\n" + meth.encode("utf-8") + b"\r\n          }\r\n          EOF\r\n")

IMPORTS = ["import android.content.ContentResolver;", "import android.content.ContentValues;",
           "import android.graphics.Bitmap;", "import android.graphics.BitmapFactory;",
           "import android.provider.MediaStore;", "import android.util.Base64;",
           "import java.io.OutputStream;"]
ANCHOR = b"import android.content.Intent;\r\n"
assert b.count(ANCHOR) == 1
b = b.replace(ANCHOR, ANCHOR + "".join((IND + x + "\n") for x in IMPORTS).replace("\n", "\r\n").encode("utf-8"))
print("① 方法 + 7 个 import 已插入")

# ============================================================
# ② Build APK 步骤加失败诊断
# ============================================================
OLD_STEP = b"      - name: Build APK\r\n        run: cd android && ./gradlew assemble${{ env.BUILD_TYPE == 'debug' && 'Debug' || 'Release' }} --no-daemon\r\n"
assert b.count(OLD_STEP) == 1, f"Build APK 步骤命中 {b.count(OLD_STEP)} 次"
NEW_STEP = """      - name: Build APK
        run: |
          cd android
          set +e
          ./gradlew assemble${{ env.BUILD_TYPE == 'debug' && 'Debug' || 'Release' }} --no-daemon 2>&1 | tee /tmp/gradle.log
          RC=${PIPESTATUS[0]}
          if [ "$RC" -ne 0 ]; then
            ERR=$(grep -nE "error:|错误:|cannot find symbol|Execution failed|What went wrong|> Task .*FAILED|Unresolved reference|lint found|NewApi|requires API level|is not abstract|incompatible" /tmp/gradle.log | head -25 | tr '\\n' '~')
            echo "::error title=gradle-build-failed::${ERR}"
            TAIL=$(tail -45 /tmp/gradle.log | tr '\\n' '~')
            echo "::error title=gradle-tail::${TAIL}"
          fi
          exit "$RC"
"""
b = b.replace(OLD_STEP, NEW_STEP.replace("\n", "\r\n").encode("utf-8"))
print("② Build APK 步骤已加失败诊断（错误行会以 ::error:: 抛出）")

open(W_PATH, "wb").write(b)
W = b.decode("utf-8")
assert b.count(b"\n") == b.count(b"\r\n")
print("写盘:", len(b), "B | 裸LF:", b.count(b"\n") - b.count(b"\r\n"))

# ============================================================
# ③ 结构断言（含上次漏掉的「必须在类内」）
# ============================================================
i2 = W.find('cat > "$PKGDIR/UpdatePlugin.java"')
j2 = W.find("\r\n          EOF\r\n", i2)
java = W[i2:j2].split("\r\n", 1)[1]
nocom = re.sub(r"//[^\r\n]*", "", re.sub(r"/\*[\s\S]*?\*/", "", java))
lines = nocom.split("\n")
co = ml = None
for n, ln in enumerate(lines, 1):
    if "class UpdatePlugin" in ln: co = n
    if "public void saveImageToGallery" in ln: ml = n
depth = 0; cc = None; md = None
for n, ln in enumerate(lines, 1):
    for ch in ln:
        if ch == "{": depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and cc is None and co and n >= co: cc = n
    if n == ml: md = depth
print(f"\n类开 {co} | 类闭 {cc} | 方法行 {ml} | 方法处深度 {md}")
assert md is not None and md >= 1 and cc and ml < cc, f"方法不在类内 ({md}, {ml}, {cc})"
print("✅ 方法在类内")

# API 29 用法必须在 @TargetApi(29) 方法内
w = W.find("@android.annotation.TargetApi(29)")
assert w > 0, "缺少 @TargetApi(29)"
seg = W[W.find("private boolean writeToGallery"):W.find("private boolean writeToGallery")+2000]
assert "RELATIVE_PATH" in seg and "IS_PENDING" in seg, "API29 用法不在 @TargetApi 方法内"
# 反向：除了 writeToGallery 之外不许再出现 API29 常量
c29 = W.count("RELATIVE_PATH") + W.count("IS_PENDING")
assert c29 == 3, f"API29 常量出现 {c29} 次（应为 3：1 个 RELATIVE_PATH + 2 个 IS_PENDING，全在 @TargetApi 方法内）"
print("✅ API 29 用法全在 @TargetApi(29) 方法内")

import yaml
y = yaml.safe_load(W)
steps = [st for job in y["jobs"].values() for st in job.get("steps", [])]
runs = [st["run"] for st in steps if st.get("run")]
assert any("saveImageToGallery" in x for x in runs)
buildstep = [st for st in steps if st.get("name") == "Build APK"][0]["run"]
assert "tee /tmp/gradle.log" in buildstep and "gradle-build-failed" in buildstep, "Build APK 诊断未生效"
print("✅ YAML 合法 | steps", len(steps), "| @PluginMethod", W.count("@PluginMethod"))
print("✅ Build APK 步骤含失败诊断")
print("\n全部通过")
