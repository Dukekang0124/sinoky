# -*- coding: utf-8 -*-
"""v0.23.17 drill 字典键合并（只补不覆盖，5 语言 + zh）。ru 含西里尔、th 含泰文断言。"""
import os, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LANGS = ['zh','es','ru','vi','id','th']

NEW = {
 'zh': {
   'Nono made you a drill': '诺诺为你出了道题',
   'Based on your weak spots, try saying this:': '针对你的薄弱点，试着说这句：',
   'Nono is preparing a drill for you…': '诺诺正在为你出题…',
   'Coach offline — tap any line above to practise': '教练离线——点上面任意一句练习',
 },
 'es': {
   'Nono made you a drill': 'Nono te preparó un ejercicio',
   'Based on your weak spots, try saying this:': 'Según tus puntos débiles, intenta decir esto:',
   'Nono is preparing a drill for you…': 'Nono está preparando un ejercicio para ti…',
   'Coach offline — tap any line above to practise': 'Coach sin conexión — toca cualquier frase de arriba',
 },
 'ru': {
   'Nono made you a drill': 'Ноно приготовил тебе упражнение',
   'Based on your weak spots, try saying this:': 'По твоим слабым местам, попробуй сказать это:',
   'Nono is preparing a drill for you…': 'Ноно готовит для тебя упражнение…',
   'Coach offline — tap any line above to practise': 'Тренер офлайн — нажми любую фразу выше',
 },
 'vi': {
   'Nono made you a drill': 'Nono đã tạo một bài tập cho bạn',
   'Based on your weak spots, try saying this:': 'Dựa trên điểm yếu của bạn, hãy thử nói câu này:',
   'Nono is preparing a drill for you…': 'Nono đang chuẩn bị bài tập cho bạn…',
   'Coach offline — tap any line above to practise': 'Huấn luyện viên offline — chạm câu nào cũng được bên trên',
 },
 'id': {
   'Nono made you a drill': 'Nono membuat latihan untukmu',
   'Based on your weak spots, try saying this:': 'Berdasarkan kelemahanmu, coba ucapkan ini:',
   'Nono is preparing a drill for you…': 'Nono sedang menyiapkan latihan untukmu…',
   'Coach offline — tap any line above to practise': 'Coach offline — ketuk kalimat mana saja di atas',
 },
 'th': {
   'Nono made you a drill': 'โนโน่สร้างแบบฝึกสำหรับคุณ',
   'Based on your weak spots, try saying this:': 'ตามจุดอ่อนของคุณ ลองพูดประโยคนี้:',
   'Nono is preparing a drill for you…': 'โนโน่กำลังเตรียมแบบฝึกให้คุณ…',
   'Coach offline — tap any line above to practise': 'โค้ชออฟไลน์ — แตะประโยคใดก็ได้ด้านบนเพื่อฝึก',
 },
}

added_total = 0
for lg in LANGS:
    p = os.path.join(ROOT, 'langs', lg + '.json')
    d = json.load(open(p, encoding='utf-8'))
    before = len(d)
    for k, v in NEW[lg].items():
        if k not in d:
            d[k] = v
            added_total += 1
    json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    open(p, 'a', encoding='utf-8').write('\n')
    after = len(d)
    # charset 断言
    if lg == 'ru' and not any(ord(c) > 0x0400 for c in NEW['ru'].values().__str__()):
        pass
    print('%s: %d -> %d (+%d)' % (lg, before, after, after-before))

# 字符集断言（只针对本批新增 key）
def has_cyr(s): return any(0x0400 <= ord(c) <= 0x04FF for c in s)
def has_thai(s): return any(0x0E00 <= ord(c) <= 0x0E7F for c in s)
for k, v in NEW['ru'].items():
    if not has_cyr(v): print('WARN ru missing cyrillic: %s' % k)
for k, v in NEW['th'].items():
    if not has_thai(v): print('WARN th missing thai: %s' % k)
print('ADDED_TOTAL=%d' % added_total)
