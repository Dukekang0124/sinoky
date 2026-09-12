# -*- coding: utf-8 -*-
"""v0.22.0 诺诺 IP 接入：给 6 个语言包补 1 个新 UI key

为什么必须补：T(s) 在字典缺 key 时**直接返回英文原文**（index.html L3658-3661），
所以新增 UI 文案若不入字典，就等于所有语言都 fallback 成英文 —— 直接踩中
项目「零英文 fallback」验收线。

新 key 的来历：原 nonoState 的 sorry 标签是 'Nono is helping…'（「Nono 在帮你…」），
但该状态实际用在「录音失败 / 麦克风被拦 / 打分低分(acc<70)」这类失败位 ——
语义错位（P0-4）。改成 'No worries — try again'。

格式铁律：这些文件是 CRLF、2 空格缩进、原始 UTF-8、末行 `}` 无换行。
故不用 json.dump（会重排 + 转义 + 改行尾），改为在最后一个 key 后插入文本。
"""
import io
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", ".."))
LANGS = os.path.join(APP, "langs")

NEW_KEY = "No worries — try again"
TRANS = {
    "zh": "没关系——再来一次",
    "es": "No pasa nada — inténtalo otra vez",
    "ru": "Ничего страшного — попробуй ещё раз",
    "vi": "Không sao đâu — thử lại lần nữa",
    "id": "Tidak apa-apa — coba sekali lagi",
    "th": "ไม่เป็นไร — ลองอีกครั้ง",
}


def main():
    report = []
    for lg, val in TRANS.items():
        p = os.path.join(LANGS, lg + ".json")
        b = open(p, "rb").read()

        # 幂等：已经有这个 key 就跳过
        if NEW_KEY.encode("utf-8") in b:
            report.append((lg, "already", len(json.loads(b.decode("utf-8")))))
            continue

        assert b.count(b"\r\n") == b.count(b"\n"), "%s 有裸 LF" % lg
        assert b.endswith(b"\r\n}"), "%s 结尾不是 CRLF+} : %r" % (lg, b[-6:])

        before = json.loads(b.decode("utf-8"))
        assert NEW_KEY not in before

        # 转义（当前 6 个译文都不含 " 和 \，但保留防御）
        esc = val.replace("\\", "\\\\").replace('"', '\\"')
        add = (',\r\n  "' + NEW_KEY + '": "' + esc + '"\r\n}').encode("utf-8")

        idx = b.rfind(b"\r\n}")
        assert idx == len(b) - len(b"\r\n}"), "%s 最后一个 \\r\\n} 不在末尾" % lg
        out = b[:idx] + add

        after = json.loads(out.decode("utf-8"))
        assert len(after) == len(before) + 1, "%s key 数增量异常" % lg
        assert after[NEW_KEY] == val
        assert out.count(b"\r\n") == out.count(b"\n"), "%s 插入后出现裸 LF" % lg

        open(p, "wb").write(out)
        report.append((lg, "added", len(after)))

    print("  lang  状态      key数")
    for lg, st, n in report:
        print("  %-5s %-9s %d %s" % (lg, st, n, "OK" if n == 574 else "!!"))


if __name__ == "__main__":
    main()
