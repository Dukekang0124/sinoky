# -*- coding: utf-8 -*-
# v0.23.16 L3 仪表盘字典键合并（只补不覆盖，5 语言 + zh；en 走 key fallback）。
import os, json, glob, re
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
LANGS = sorted(glob.glob(os.path.join(ROOT, 'langs', '*.json')))
TR = {
  'AI effect self-check': {'zh':'AI 效果自检','es':'Autochequeo del efecto de la IA','ru':'Самопроверка эффекта ИИ','vi':'Tự kiểm tra hiệu quả AI','id':'Cek efek AI','th':'ตรวจสอบผลลัพธ์ AI เอง'},
  "Does Nono's AI coaching make you speak more? Here is the loop.": {'zh':'诺诺的 AI 点评真的让你更愿意开口吗？这是闭环数据。','es':'¿El entrenamiento con IA de Nono te hace hablar más? Este es el bucle.','ru':'ИИ-тренировка Ноно заставляет вас говорить больше? Вот цикл.','vi':'Huấn luyện AI của Nono có giúp bạn nói nhiều hơn không? Đây là vòng lặp.','id':'Apakah coaching AI Nono membuatmu lebih banyak bicara? Ini loop-nya.','th':'การโค้วชิ่ง AI ของนอนนอทำให้คุณพูดมากขึ้นไหม? นี่คือลูป.'},
  'AI coached you': {'zh':'诺诺已为你点评','es':'Nono te entrenó','ru':'Ноно тренировал вас','vi':'Nono đã huấn luyện bạn','id':'Nono melatih kamu','th':'นอนนอโค้วชิ่งคุณแล้ว'},
  'times Nono gave a tailored tip': {'zh':'诺诺给出专属建议的次数','es':'veces que Nono dio un consejo a medida','ru':'раз Ноно давал персональный совет','vi':'số lần Nono đưa ra lời khuyên riêng','id':'kali Nono memberi tips khusus','th':'ครั้งที่นอนนอให้คำแนะนำเฉพาะตัว'},
  'You came back to drill': {'zh':'你回来重练了','es':'Volviste a practicar','ru':'Вы вернулись тренироваться','vi':'Bạn quay lại luyện tập','id':'Kamu kembali berlatih','th':'คุณกลับมาฝึกซ้อม'},
  'times you practiced after a tip': {'zh':'收到建议后你练习的次数','es':'veces que practicaste tras un consejo','ru':'раз вы тренировались после совета','vi':'số lần bạn tập sau một lời khuyên','id':'kali kamu berlatih setelah tips','th':'ครั้งที่คุณฝึกหลังได้คำแนะนำ'},
  'Loop rate': {'zh':'闭环率','es':'Tasa de bucle','ru':'Коэффициент цикла','vi':'Tỷ lệ vòng lặp','id':'Rasio loop','th':'อัตราลูป'},
  'coaching → you speak again': {'zh':'点评 → 你再次开口','es':'entrenamiento → hablas otra vez','ru':'тренировка → вы снова говорите','vi':'huấn luyện → bạn nói lại','id':'coaching → kamu bicara lagi','th':'โค้วชิ่ง → คุณพูดอีกครั้ง'},
  'Offline fallback': {'zh':'离线兜底','es':'Respaldo sin conexión','ru':'Резерв офлайн','vi':'Dự phòng ngoại tuyến','id':'Cadangan offline','th':'สำรองออฟไลน์'},
  'coach missed (offline/timeout)': {'zh':'点评未命中（离线/超时）','es':'entrenador falló (offline/timeout)','ru':'тренер пропустил (офлайн/таймаут)','vi':'huấn luyện viên trượt (offline/timeout)','id':'coach gagal (offline/timeout)','th':'โค้ชพลาด (ออฟไลน์/หมดเวลา)'},
}
for f in LANGS:
    base = os.path.basename(f); lang = base[:-5]
    d = json.load(open(f, encoding='utf-8'))
    added = 0
    for k, tr in TR.items():
        if k in d: continue
        if lang == 'en':
            d[k] = k
        else:
            v = tr.get(lang)
            if v is None:
                print('WARN no tr for', lang, k); d[k] = k
            else:
                d[k] = v
            added += 1
    if lang == 'ru':
        for k, v in d.items():
            if not re.search('[Ѐ-ӿ]', v):
                print('WARN ru missing cyrillic at', k)
    if lang == 'th':
        for k, v in d.items():
            if not re.search('[฀-๿]', v):
                print('WARN th missing thai at', k)
    json.dump(d, open(f, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    open(f, 'a', encoding='utf-8').write('\n')
    print(base, 'added', added)
