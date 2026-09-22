// v0.23.19 B1：把"自适应日计划"卡的 5 个新 T() 键追加进 6 个非英文语言包。
// 英文键即原文（en 走兜底），其余 6 语需逐键翻译，否则非英文用户会看到英文（违反零英文 fallback 验收线）。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LANG_DIR = resolve(process.cwd(), 'langs') + '/';
const LANGS = ['zh', 'es', 'ru', 'vi', 'id', 'th'];

// 英文键 -> 各语言翻译。en 不需要文件（T 未命中即返回英文键）。
const TRANS = {
  "Nono's plan for you": {
    zh: '诺诺为你定的今日计划',
    es: 'Plan de Nono para ti',
    ru: 'План Ноно для тебя',
    vi: 'Kế hoạch của Nono cho bạn',
    id: 'Rencana Nono untukmu',
    th: 'แผนของโนโนสำหรับคุณ',
  },
  'A short daily plan based on your progress.': {
    zh: '根据你的进度生成的一份简短每日计划。',
    es: 'Un breve plan diario según tu progreso.',
    ru: 'Короткий план на день по твоему прогрессу.',
    vi: 'Một kế hoạch ngắn mỗi ngày dựa trên tiến độ của bạn.',
    id: 'Rencana harian singkat berdasarkan progresmu.',
    th: 'แผนประจำวันสั้นๆ ตามความก้าวหน้าของคุณ',
  },
  'Start with a line': {
    zh: '从一句开始练',
    es: 'Empieza con una frase',
    ru: 'Начни с одной фразы',
    vi: 'Bắt đầu với một câu',
    id: 'Mulai dari satu kalimat',
    th: 'เริ่มจากประโยคหนึ่งประโยค',
  },
  'Nono is planning your day…': {
    zh: '诺诺正在为你规划今天…',
    es: 'Nono está planeando tu día…',
    ru: 'Ноно планирует твой день…',
    vi: 'Nono đang lên kế hoạch cho ngày của bạn…',
    id: 'Nono sedang menyusun rencana harimu…',
    th: 'โนโนกำลังวางแผนวันของคุณ…',
  },
  'Coach offline — just open any scene and say a line.': {
    zh: '教练离线——随便打开一个场景说一句就好。',
    es: 'Coach desconectado — abre cualquier escena y di una frase.',
    ru: 'Тренер офлайн — открой любую сцену и скажи фразу.',
    vi: 'Huấn luyện viên offline — hãy mở bất kỳ cảnh nào và nói một câu.',
    id: 'Coach offline — buka saja scene mana pun dan ucapkan satu kalimat.',
    th: 'โค้ชออฟไลน์ — เปิดฉากใดก็ได้แล้วพูดหนึ่งประโยค',
  },
};

let changed = 0;
for (const l of LANGS) {
  const file = LANG_DIR + l + '.json';
  const j = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of Object.keys(TRANS)) {
    if (!Object.prototype.hasOwnProperty.call(j, key)) {
      j[key] = TRANS[key][l];
      changed++;
    }
  }
  // 保持插入顺序：JSON.stringify 对字符串键保留顺序；末尾加换行与现有风格一致
  writeFileSync(file, JSON.stringify(j, null, 2) + '\n', 'utf8');
  console.log(l + '.json -> +' + Object.keys(TRANS).length + ' keys (total ' + Object.keys(j).length + ')');
}
console.log('TOTAL new keys written:', changed);
