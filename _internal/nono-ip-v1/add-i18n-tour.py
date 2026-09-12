# -*- coding: utf-8 -*-
"""v0.23.0 诺诺功能导览：给 6 个语言包补 6 个新 UI key

为什么必须补：T(s) 在字典缺 key 时**直接返回英文原文**，所以新增 UI 文案若不入
字典，等于所有语言都 fallback 成英文 —— 踩中项目「零英文 fallback」验收线。

新 key 的来历：v0.23.0 新增「诺诺带你认识产品」导览（patch.js §8），
其骨架按钮/标签需要走 T()。导览的**功能说明正文**保持硬编码（与既有
VIEW_HINT / nonoContextGreet 的教学提示同风格：英文为主 + 中文为学习目标），
不入字典 —— 这与项目现状一致。

可复用 key 已确认存在，不重复添加：
  'Practise' / 'Chat' / 'Close' / 'Next →' / 'Skip for now'

格式铁律（踩过的坑）：这些文件是 CRLF、2 空格缩进、原始 UTF-8、末行 `}` 无换行。
故**不用 json.dump**（会重排 + 转义 + 改行尾，产生上千行 diff），
改为在最后一个 key 后做文本级插入。
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, "..", ".."))
LANGS = os.path.join(APP, "langs")

NEWS = {
    "Tour": {
        "zh": "导览", "es": "Recorrido", "ru": "Экскурсия",
        "vi": "Tham quan", "id": "Tur", "th": "ทัวร์",
    },
    "Show me around": {
        "zh": "带我逛一圈", "es": "Muéstrame el lugar", "ru": "Покажи мне всё",
        "vi": "Dẫn tôi một vòng", "id": "Tunjukkan sekelilingnya", "th": "พาเที่ยวหน่อย",
    },
    "Not sure where to start? Let me show you around.": {
        "zh": "不知道从哪儿开始？我带你逛一圈。",
        "es": "¿No sabes por dónde empezar? Deja que te muestre.",
        "ru": "Не знаете, с чего начать? Я всё покажу.",
        "vi": "Chưa biết bắt đầu từ đâu? Để tôi dẫn bạn một vòng.",
        "id": "Bingung mau mulai dari mana? Aku tunjukkan.",
        "th": "ไม่รู้จะเริ่มตรงไหน? ให้ฉันพาเที่ยวหน่อย",
    },
    "You've seen the whole place.": {
        "zh": "你已经逛完一圈了。", "es": "Ya has visto todo.", "ru": "Вы всё осмотрели.",
        "vi": "Bạn đã xem hết rồi.", "id": "Kamu sudah lihat semuanya.", "th": "คุณเห็นครบแล้ว",
    },
    "Finish": {
        "zh": "完成", "es": "Terminar", "ru": "Готово",
        "vi": "Xong", "id": "Selesai", "th": "เสร็จ",
    },
    "Take me there": {
        "zh": "带我去", "es": "Llévame allí", "ru": "Отведи меня",
        "vi": "Đưa tôi đến đó", "id": "Antar aku ke sana", "th": "พาไปที่นั่น",
    },
}


def esc(s):
    return s.replace("\\", "\\\\").replace('"', '\\"')


def main():
    print("=== v0.23.0 导览：补 %d 个 key × 6 语言 ===" % len(NEWS))
    for lg in ("zh", "es", "ru", "vi", "id", "th"):
        p = os.path.join(LANGS, lg + ".json")
        b = open(p, "rb").read()
        before_n = len(json.loads(b.decode("utf-8")))

        todo = [(k, v[lg]) for k, v in NEWS.items()
                if ('"%s"' % k).encode("utf-8") not in b]
        if not todo:
            print("  %-3s 已有全部 key，跳过（%d key）" % (lg, before_n))
            continue

        assert b.count(b"\r\n") == b.count(b"\n"), "%s 有裸 LF" % lg
        assert b.endswith(b"\r\n}"), "%s 结尾不是 CRLF+} : %r" % (lg, b[-6:])

        items = ',\r\n'.join('  "%s": "%s"' % (esc(k), esc(v)) for k, v in todo)
        add = (",\r\n" + items + "\r\n}").encode("utf-8")
        idx = b.rfind(b"\r\n}")
        assert idx == len(b) - len(b"\r\n}"), "%s 最后一个 \\r\\n} 不在末尾" % lg
        out = b[:idx] + add

        # 写完必须自证：行尾未变、key 齐全、UTF-8 可解析
        assert out.count(b"\r\n") == out.count(b"\n"), "%s 写完出现裸 LF" % lg
        assert out.endswith(b"\r\n}")
        j = json.loads(out.decode("utf-8"))
        for k, _ in todo:
            assert k in j, "%s 缺 key %r" % (lg, k)
        open(p, "wb").write(out)
        print("  %-3s +%d key：%d → %d" % (lg, len(todo), before_n, len(j)))

    # 终局断言：6 语言 key 数必须完全一致（否则说明某语言漏了）
    counts = {}
    for lg in ("zh", "es", "ru", "vi", "id", "th"):
        counts[lg] = len(json.loads(open(os.path.join(LANGS, lg + ".json"), "rb")
                                     .read().decode("utf-8")))
    uniq = set(counts.values())
    assert len(uniq) == 1, "6 语言 key 数不一致：%r" % counts
    print("=== 完成：6 语言各 %d key（一致）===" % counts["zh"])


if __name__ == "__main__":
    main()
