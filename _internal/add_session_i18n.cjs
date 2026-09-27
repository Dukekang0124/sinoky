#!/usr/bin/env node
/* v0.26.0 一次性开发脚本：为 Daily Session 2.0 新增文案补齐 6 语言。
   用法：node _internal/add_session_i18n.cjs
   规则：已存在的 key 一律**跳过不覆盖**（保护既有译文）；新增 key 才写入。
   不进 web 构建（build-web.mjs 只拷白名单目录）。 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'langs');

const ADD = {
  /* ---- 会话面板 ---- */
  'Practice session':     { zh:'今日练习', es:'Sesión de práctica', ru:'Сессия практики', vi:'Buổi luyện tập', id:'Sesi latihan', th:'ช่วงฝึกวันนี้' },
  'Say it':               { zh:'说这句', es:'Dilo', ru:'Скажите', vi:'Nói đi', id:'Ucapkan', th:'พูดเลย' },
  'Hear':                 { zh:'听示范', es:'Escuchar', ru:'Послушать', vi:'Nghe', id:'Dengar', th:'ฟัง' },
  'Next':                 { zh:'下一句', es:'Siguiente', ru:'Далее', vi:'Tiếp', id:'Berikutnya', th:'ถัดไป' },
  'Open scene':           { zh:'打开场景', es:'Abrir escenario', ru:'Открыть сцену', vi:'Mở tình huống', id:'Buka skenario', th:'เปิดสถานการณ์' },
  'Nothing queued yet — open any scene to start practising.': {
    zh:'今天还没有排队任务 —— 打开任意场景就能开始练。',
    es:'Aún no hay nada en cola: abre cualquier escenario para empezar a practicar.',
    ru:'Пока ничего не запланировано — откройте любую сцену, чтобы начать практику.',
    vi:'Chưa có gì trong hàng đợi — mở bất kỳ tình huống nào để bắt đầu luyện.',
    id:'Belum ada antrean — buka skenario apa pun untuk mulai berlatih.',
    th:'ยังไม่มีคิว — เปิดสถานการณ์ใดก็ได้เพื่อเริ่มฝึก'
  },
  /* ---- 结算 ---- */
  'lines attempted this session': {
    zh:'本次练过的句子', es:'frases intentadas en esta sesión', ru:'фраз за эту сессию',
    vi:'câu đã luyện trong buổi này', id:'kalimat dicoba sesi ini', th:'ประโยคที่ฝึกในรอบนี้'
  },
  'Average score':        { zh:'平均分', es:'Puntuación media', ru:'Средний балл', vi:'Điểm trung bình', id:'Skor rata-rata', th:'คะแนนเฉลี่ย' },
  'Nailed it':            { zh:'完全说对', es:'Clavadas', ru:'Получилось', vi:'Nói chuẩn', id:'Berhasil', th:'พูดถูกเป๊ะ' },
  'Your plan updates based on today’s results.': {
    zh:'你的计划会根据今天的表现自动调整。',
    es:'Tu plan se ajusta según los resultados de hoy.',
    ru:'План обновляется по результатам сегодняшнего дня.',
    vi:'Kế hoạch của bạn cập nhật dựa trên kết quả hôm nay.',
    id:'Rencana kamu menyesuaikan berdasarkan hasil hari ini.',
    th:'แผนของคุณจะปรับตามผลของวันนี้'
  },
  /* ---- 可解释性（为什么练这句）---- */
  'Why this line':        { zh:'为什么练这句', es:'Por qué esta frase', ru:'Почему эта фраза', vi:'Vì sao chọn câu này', id:'Kenapa kalimat ini', th:'ทำไมเลือกประโยคนี้' },
  'your weak spot':       { zh:'你的薄弱点', es:'tu punto débil', ru:'ваше слабое место', vi:'điểm yếu của bạn', id:'titik lemah kamu', th:'จุดอ่อนของคุณ' },
  'due for review':       { zh:'到复习时间了', es:'toca repasar', ru:'пора повторить', vi:'đến hạn ôn', id:'waktunya diulang', th:'ถึงกำหนดทบทวน' },
  'for your city':        { zh:'贴合你要去的城市', es:'para tu ciudad', ru:'для вашего города', vi:'cho thành phố của bạn', id:'untuk kota kamu', th:'สำหรับเมืองของคุณ' },
  'a fresh line':         { zh:'一句新句子', es:'una frase nueva', ru:'новая фраза', vi:'một câu mới', id:'kalimat baru', th:'ประโยคใหม่' },
  /* ---- 闭环可见证据 ---- */
  'Start today’s session': {
    zh:'开始今日练习', es:'Empezar la sesión de hoy', ru:'Начать сессию на сегодня',
    vi:'Bắt đầu buổi luyện hôm nay', id:'Mulai sesi hari ini', th:'เริ่มฝึกของวันนี้'
  },
  '{n} of today’s lines are new since your last session': {
    zh:'今天的句子里有 {n} 句是刚换上的',
    es:'{n} frases de hoy son nuevas desde tu última sesión',
    ru:'{n} фраз на сегодня новые с прошлой сессии',
    vi:'{n} câu hôm nay là mới so với buổi trước',
    id:'{n} kalimat hari ini baru sejak sesi terakhir',
    th:'มี {n} ประโยคของวันนี้ที่ใหม่จากการฝึกครั้งก่อน'
  }
};

const LANGS = ['zh','es','ru','vi','id','th'];
let added = 0, skipped = 0;
const missing = [];

LANGS.forEach(function(l){
  const f = path.join(DIR, l + '.json');
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  Object.keys(ADD).forEach(function(k){
    const tr = ADD[k][l];
    if(!tr){ missing.push(l + ':' + k); return; }
    if(Object.prototype.hasOwnProperty.call(data, k)){ skipped++; return; }
    data[k] = tr; added++;
  });
  fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
  console.log(l + '.json → keys=' + Object.keys(data).length);
});
console.log('added=' + added + ' skipped(existing)=' + skipped + ' missing=' + missing.length);
if(missing.length) console.log('MISSING:', missing.join(', '));
