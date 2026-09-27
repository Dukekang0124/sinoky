#!/usr/bin/env node
/* v0.29.0 一次性开发脚本：为 M6 复盘收口 + M5 策略切换新增文案补齐 6 语言。
   用法：node _internal/add_retro_i18n.cjs
   规则：① 已存在的 key 一律**跳过不覆盖**（保护既有译文）；只写新 key。
         ② **保留原文件行尾**（langs/*.json 在仓库里是 CRLF）—— 否则整个文件
            会因为行尾变化产生上千行无意义 diff，把真实改动淹没。
   不进 web 构建（build-web.mjs 只拷白名单目录）。 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'langs');

const ADD = {
  'Trip retro': {
    zh:'行程复盘', es:'Repaso del viaje', ru:'Итоги поездки',
    vi:'Tổng kết chuyến đi', id:'Rekap perjalanan', th:'สรุปทริป'
  },
  'Make my trip card': {
    zh:'生成我的行程卡', es:'Crear mi tarjeta de viaje', ru:'Создать карточку поездки',
    vi:'Tạo thẻ chuyến đi của tôi', id:'Buat kartu perjalanan saya', th:'สร้างการ์ดทริปของฉัน'
  },
  'archived': {
    zh:'已归档', es:'archivado', ru:'в архиве',
    vi:'đã lưu trữ', id:'terarsip', th:'เก็บถาวรแล้ว'
  },
  'avg': {
    zh:'平均', es:'media', ru:'сред.',
    vi:'trung bình', id:'rata-rata', th:'เฉลี่ย'
  },
  '{n} lines said': {
    zh:'已开口 {n} 句', es:'{n} frases dichas', ru:'Сказано фраз: {n}',
    vi:'Đã nói {n} câu', id:'{n} kalimat diucapkan', th:'พูดไป {n} ประโยค'
  },
  'nothing recorded': {
    zh:'还没有记录', es:'sin registros', ru:'пока нет записей',
    vi:'chưa có dữ liệu', id:'belum ada catatan', th:'ยังไม่มีข้อมูล'
  },
  'tones': {
    zh:'声调', es:'tonos', ru:'тоны',
    vi:'thanh điệu', id:'nada', th:'เสียงวรรณยุกต์'
  },
  '{n}-tone words': {
    zh:'{n} 声字', es:'palabras de tono {n}', ru:'слова с {n}-м тоном',
    vi:'từ thanh {n}', id:'kata nada {n}', th:'คำเสียงที่ {n}'
  },
  'tricky first sounds': {
    zh:'容易混的声母', es:'sonidos iniciales difíciles', ru:'сложные начальные звуки',
    vi:'âm đầu khó', id:'bunyi awal yang sulit', th:'เสียงต้นที่ยาก'
  },
  'ending sounds': {
    zh:'韵母收尾', es:'sonidos finales', ru:'конечные звуки',
    vi:'âm cuối', id:'bunyi akhir', th:'เสียงท้าย'
  },
  'you missed this 3× — trying a different way': {
    zh:'这句连错 3 次 —— 已换一种练法', es:'Fallaste esta 3 veces: probamos otra forma',
    ru:'Три промаха подряд — пробуем иначе', vi:'Sai câu này 3 lần — đổi cách khác',
    id:'Salah 3× — coba cara lain', th:'พลาด 3 ครั้ง — ลองวิธีอื่น'
  },
  'You missed this 3× — so today we change the approach': {
    zh:'这句你连错 3 次 —— 今天换个做法', es:'Fallaste esta 3 veces: hoy cambiamos el enfoque',
    ru:'Три промаха подряд — сегодня меняем подход', vi:'Sai câu này 3 lần — hôm nay đổi cách',
    id:'Salah 3× — hari ini kita ganti cara', th:'พลาด 3 ครั้ง — วันนี้เปลี่ยนวิธี'
  },
  'break it into single sounds': {
    zh:'拆成单字练', es:'separarla en sonidos sueltos', ru:'разбить на отдельные звуки',
    vi:'tách thành từng âm', id:'pecah jadi per suku bunyi', th:'แยกเป็นเสียงเดี่ยว'
  },
  'try it another way': {
    zh:'换个说法', es:'decirla de otra forma', ru:'сказать иначе',
    vi:'nói cách khác', id:'bilang dengan cara lain', th:'พูดอีกแบบ'
  },
  'Practise sound by sound': {
    zh:'一个字一个字练', es:'Practicar sonido a sonido', ru:'Тренировать по звукам',
    vi:'Luyện từng âm', id:'Latih per suara', th:'ซ้อมทีละเสียง'
  },
  'Say it another way': {
    zh:'换个说法说', es:'Decirlo de otra forma', ru:'Сказать иначе',
    vi:'Nói cách khác', id:'Bilang dengan cara lain', th:'พูดอีกแบบดู'
  }
};

const LANGS = ['zh', 'es', 'ru', 'vi', 'id', 'th'];
let added = 0, skipped = 0;
const missing = [];

LANGS.forEach(function(l){
  const f = path.join(DIR, l + '.json');
  const raw = fs.readFileSync(f, 'utf8');
  const crlf = raw.indexOf('\r\n') >= 0;                 /* 🔴 保留原行尾，防整文件 diff */
  const data = JSON.parse(raw);
  const before = Object.keys(data).length;
  Object.keys(ADD).forEach(function(k){
    const tr = ADD[k][l];
    if(!tr){ missing.push(l + ':' + k); return; }
    if(Object.prototype.hasOwnProperty.call(data, k)){ skipped++; return; }
    data[k] = tr; added++;
  });
  let out = JSON.stringify(data, null, 2);
  if(crlf) out = out.replace(/\n/g, '\r\n');
  fs.writeFileSync(f, out, 'utf8');
  console.log(l + '.json → ' + before + ' → ' + Object.keys(data).length + ' keys' + (crlf ? ' (CRLF)' : ''));
});
console.log('added=' + added + ' skipped(existing)=' + skipped + ' missing=' + missing.length);
if(missing.length) console.log('MISSING:', missing.join(', '));
