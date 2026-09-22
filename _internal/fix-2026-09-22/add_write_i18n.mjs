// v0.23.20 B2：把"语法/写作教练"卡新增的 14 个 T() 键追加进 6 个非英文语言包。
// 英文键即原文（en 走兜底），其余 6 语必须逐键翻译，否则非英文用户看到英文（违反零英文 fallback 验收线）。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LANG_DIR = resolve(process.cwd(), 'langs') + '/';
const LANGS = ['zh', 'es', 'ru', 'vi', 'id', 'th'];

const TRANS = {
  'Write a sentence': {
    zh: '写一句中文', es: 'Escribe una frase', ru: 'Напиши фразу',
    vi: 'Viết một câu', id: 'Tulis satu kalimat', th: 'เขียนหนึ่งประโยค',
  },
  'Nono checks your Chinese and helps you say it right.': {
    zh: '诺诺帮你检查中文，改顺了再读出来。',
    es: 'Nono revisa tu chino y te ayuda a decirlo bien.',
    ru: 'Ноно проверит твой китайский и поможет сказать правильно.',
    vi: 'Nono kiểm tra tiếng Trung của bạn và giúp bạn nói đúng.',
    id: 'Nono memeriksa bahasa Mandarinmu dan membantumu mengucapkannya dengan benar.',
    th: 'โนโนตรวจภาษาจีนของคุณและช่วยให้คุณพูดได้ถูกต้อง',
  },
  'Write one sentence with each of these characters:': {
    zh: '用下面这几个字各写一句话：',
    es: 'Escribe una frase con cada uno de estos caracteres:',
    ru: 'Напиши по одному предложению с каждым из этих иероглифов:',
    vi: 'Viết một câu với mỗi chữ sau:',
    id: 'Tulis satu kalimat dengan setiap aksara berikut:',
    th: 'เขียนหนึ่งประโยคด้วยตัวอักษรแต่ละตัวต่อไปนี้:',
  },
  'Write a short sentence in Chinese about today.': {
    zh: '用中文写一句关于今天的话。',
    es: 'Escribe una frase corta en chino sobre hoy.',
    ru: 'Напиши короткое предложение по-китайски о сегодняшнем дне.',
    vi: 'Viết một câu ngắn bằng tiếng Trung về hôm nay.',
    id: 'Tulis satu kalimat pendek dalam bahasa Mandarin tentang hari ini.',
    th: 'เขียนประโยคสั้นๆ เป็นภาษาจีนเกี่ยวกับวันนี้',
  },
  'Introduce yourself in Chinese (name, where you are from, what you like).': {
    zh: '用中文介绍一下你自己（名字、来自哪里、喜欢什么）。',
    es: 'Preséntate en chino (nombre, de dónde eres, qué te gusta).',
    ru: 'Расскажи о себе по-китайски (имя, откуда ты, что любишь).',
    vi: 'Giới thiệu bản thân bằng tiếng Trung (tên, quê quán, sở thích).',
    id: 'Perkenalkan dirimu dalam bahasa Mandarin (nama, asal, kesukaanmu).',
    th: 'แนะนำตัวเป็นภาษาจีน (ชื่อ มาจากไหน ชอบอะไร)',
  },
  'Write one sentence in Chinese about what you did today.': {
    zh: '用中文写一句你今天做了什么。',
    es: 'Escribe una frase en chino sobre lo que hiciste hoy.',
    ru: 'Напиши по-китайски одно предложение о том, что ты сделал сегодня.',
    vi: 'Viết một câu tiếng Trung về việc bạn đã làm hôm nay.',
    id: 'Tulis satu kalimat dalam bahasa Mandarin tentang apa yang kamu lakukan hari ini.',
    th: 'เขียนหนึ่งประโยคภาษาจีนเกี่ยวกับสิ่งที่คุณทำวันนี้',
  },
  'Translate into Chinese:': {
    zh: '翻译成中文：', es: 'Traduce al chino:', ru: 'Переведи на китайский:',
    vi: 'Dịch sang tiếng Trung:', id: 'Terjemahkan ke bahasa Mandarin:', th: 'แปลเป็นภาษาจีน:',
  },
  'I would like to drink tea.': {
    zh: '我想喝茶。', es: 'Quiero tomar té.', ru: 'Я хочу выпить чаю.',
    vi: 'Tôi muốn uống trà.', id: 'Saya ingin minum teh.', th: 'ฉันอยากดื่มชา',
  },
  'Write your Chinese sentence here…': {
    zh: '在这里写下你的中文句子…',
    es: 'Escribe aquí tu frase en chino…',
    ru: 'Напиши здесь своё предложение по-китайски…',
    vi: 'Viết câu tiếng Trung của bạn ở đây…',
    id: 'Tulis kalimat bahasa Mandarinmu di sini…',
    th: 'เขียนประโยคภาษาจีนของคุณที่นี่…',
  },
  'Check my Chinese': {
    zh: '检查我的中文', es: 'Revisar mi chino', ru: 'Проверить мой китайский',
    vi: 'Kiểm tra tiếng Trung của tôi', id: 'Periksa bahasa Mandarin saya', th: 'ตรวจภาษาจีนของฉัน',
  },
  'Read it out': {
    zh: '读出来', es: 'Léelo en voz alta', ru: 'Прочитай вслух',
    vi: 'Đọc to lên', id: 'Bacakan dengan lantang', th: 'อ่านออกเสียง',
  },
  'Nono is checking…': {
    zh: '诺诺正在批改…', es: 'Nono está revisando…', ru: 'Ноно проверяет…',
    vi: 'Nono đang kiểm tra…', id: 'Nono sedang memeriksa…', th: 'โนโนกำลังตรวจ…',
  },
  'Coach offline — try again in a moment.': {
    zh: '教练离线——稍后再试一次。',
    es: 'Coach desconectado — inténtalo de nuevo en un momento.',
    ru: 'Тренер офлайн — попробуй ещё раз чуть позже.',
    vi: 'Huấn luyện viên offline — thử lại sau một lát.',
    id: 'Coach offline — coba lagi sebentar lagi.',
    th: 'โค้ชออฟไลน์ — ลองอีกครั้งในอีกสักครู่',
  },
  'Write something first': {
    zh: '先写点什么吧', es: 'Escribe algo primero', ru: 'Сначала что-нибудь напиши',
    vi: 'Viết gì đó trước đã', id: 'Tulis sesuatu dulu', th: 'เขียนอะไรสักอย่างก่อน',
  },
};

const KEYS = Object.keys(TRANS);
let changed = 0;
for (const l of LANGS) {
  const file = LANG_DIR + l + '.json';
  const j = JSON.parse(readFileSync(file, 'utf8'));
  let add = 0;
  for (const key of KEYS) {
    if (!Object.prototype.hasOwnProperty.call(j, key)) {
      const v = (TRANS[key] && TRANS[key][l]) ? TRANS[key][l] : null;
      if (v == null) { console.error('MISSING translation: ' + l + ' :: ' + key); process.exit(1); }
      j[key] = v; add++; changed++;
    }
  }
  writeFileSync(file, JSON.stringify(j, null, 2) + '\n', 'utf8');
  console.log(l + '.json -> +' + add + ' keys (total ' + Object.keys(j).length + ')');
}
console.log('TOTAL new keys written:', changed);
