#!/usr/bin/env node
/* v0.28.0 一次性开发脚本：为 M5 主动引擎（Proactive）新增文案补齐 6 语言。
   用法：node _internal/add_pro_i18n.cjs
   规则：① 已存在的 key 一律**跳过不覆盖**（保护既有译文）；只写新 key。
         ② **保留原文件行尾**（langs/*.json 在仓库里是 CRLF）—— 否则整个文件
            会因为行尾变化产生上千行无意义 diff，把真实改动淹没。
   不进 web 构建（build-web.mjs 只拷白名单目录）。 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'langs');

const ADD = {
  'Trip pack': {
    zh:'行程包', es:'Paquete de viaje', ru:'Набор для поездки',
    vi:'Gói chuyến đi', id:'Paket perjalanan', th:'ชุดเดินทาง'
  },
  'You go to {city} {when} — practise these {n} lines today.': {
    zh:'你{when}去{city} —— 今天先练这 {n} 句。',
    es:'Vas a {city} {when}: practica estas {n} frases hoy.',
    ru:'Ты едешь в {city} {when} — потренируй эти {n} фраз сегодня.',
    vi:'Bạn đến {city} {when} — hãy luyện {n} câu này hôm nay.',
    id:'Kamu ke {city} {when} — latih {n} kalimat ini hari ini.',
    th:'คุณจะไป {city} {when} — ซ้อม {n} ประโยคนี้วันนี้'
  },
  'Start the {n}-line pack': {
    zh:'开始 {n} 句行程包', es:'Empezar el paquete de {n} frases',
    ru:'Начать набор из {n} фраз', vi:'Bắt đầu gói {n} câu',
    id:'Mulai paket {n} kalimat', th:'เริ่มชุด {n} ประโยค'
  },
  'Keep the streak alive': {
    zh:'保住连胜', es:'Mantén la racha', ru:'Сохрани серию',
    vi:'Giữ chuỗi ngày', id:'Jaga rentetan', th:'รักษาสตรีค'
  },
  'Your {n}-day streak has not moved today — 2 minutes saves it.': {
    zh:'你的 {n} 天连胜今天还没动 —— 2 分钟就能保住。',
    es:'Tu racha de {n} días no se ha movido hoy: 2 minutos la salvan.',
    ru:'Твоя серия из {n} дней сегодня не двигалась — 2 минуты её спасут.',
    vi:'Chuỗi {n} ngày của bạn hôm nay chưa nhúc nhích — 2 phút là giữ được.',
    id:'Rentetan {n} harimu belum bergerak hari ini — 2 menit menyelamatkannya.',
    th:'สตรีค {n} วันของคุณวันนี้ยังไม่ขยับ — 2 นาทีก็รักษาไว้ได้'
  },
  '2-minute session': {
    zh:'2 分钟练一组', es:'Sesión de 2 minutos', ru:'Сессия на 2 минуты',
    vi:'Buổi 2 phút', id:'Sesi 2 menit', th:'เซสชัน 2 นาที'
  },
  'Review is due': {
    zh:'该复习了', es:'Toca repasar', ru:'Пора повторить',
    vi:'Đến lúc ôn tập', id:'Waktunya mengulang', th:'ถึงเวลาทบทวน'
  },
  '{n} lines have come round for review.': {
    zh:'有 {n} 句到了该复习的时候。',
    es:'{n} frases toca repasar.', ru:'{n} фраз пора повторить.',
    vi:'{n} câu đã đến lúc ôn.', id:'{n} kalimat perlu diulang.',
    th:'มี {n} ประโยคถึงเวลาทบทวน'
  },
  'Review now': {
    zh:'开始复习', es:'Repasar ahora', ru:'Повторить сейчас',
    vi:'Ôn ngay', id:'Ulang sekarang', th:'ทบทวนเลย'
  },
  'No pack for that city yet.': {
    zh:'这座城市还没有行程包。', es:'Todavía no hay paquete para esa ciudad.',
    ru:'Для этого города пока нет набора.', vi:'Chưa có gói cho thành phố đó.',
    id:'Belum ada paket untuk kota itu.', th:'ยังไม่มีชุดสำหรับเมืองนั้น'
  },
  'That pack has no lines yet.': {
    zh:'这个行程包还没有句子。', es:'Ese paquete aún no tiene frases.',
    ru:'В этом наборе пока нет фраз.', vi:'Gói này chưa có câu nào.',
    id:'Paket itu belum punya kalimat.', th:'ชุดนี้ยังไม่มีประโยค'
  },
  'Say each line out loud. Tap ✓ once you have said it.': {
    zh:'每句大声说一遍，说完点 ✓。',
    es:'Di cada frase en voz alta. Toca ✓ cuando la hayas dicho.',
    ru:'Скажи каждую фразу вслух. Нажми ✓, когда скажешь.',
    vi:'Đọc to từng câu. Nhấn ✓ sau khi đã nói.',
    id:'Ucapkan tiap kalimat dengan lantang. Ketuk ✓ setelah kamu ucapkan.',
    th:'พูดแต่ละประโยคออกเสียงดัง ๆ แตะ ✓ เมื่อพูดแล้ว'
  },
  'Listen': {
    zh:'听一遍', es:'Escuchar', ru:'Слушать',
    vi:'Nghe', id:'Dengar', th:'ฟัง'
  },
  'Full city guide': {
    zh:'完整城市攻略', es:'Guía completa de la ciudad', ru:'Полный гид по городу',
    vi:'Cẩm nang thành phố đầy đủ', id:'Panduan kota lengkap', th:'คู่มือเมืองฉบับเต็ม'
  },
  'Done for today': {
    zh:'今天就到这', es:'Hecho por hoy', ru:'На сегодня хватит',
    vi:'Hôm nay thế là đủ', id:'Cukup untuk hari ini', th:'วันนี้พอแล้ว'
  },
  '🎉 Whole pack done — {city} is ready for you.': {
    zh:'🎉 整包说完 —— {city} 等你来。',
    es:'🎉 Paquete completo: {city} te espera.',
    ru:'🎉 Набор пройден — {city} ждёт тебя.',
    vi:'🎉 Xong cả gói — {city} đang chờ bạn.',
    id:'🎉 Paket selesai — {city} menantimu.',
    th:'🎉 ครบทั้งชุดแล้ว — {city} รอคุณอยู่'
  },
  'Tell Sinoky where you are going — it will pack the lines to practise before you land.': {
    zh:'告诉 Sinoky 你要去哪儿 —— 它会打包好落地前该练的句子。',
    es:'Dile a Sinoky a dónde vas: preparará las frases para practicar antes de aterrizar.',
    ru:'Скажи Sinoky, куда ты едешь, — он соберёт фразы для практики перед посадкой.',
    vi:'Cho Sinoky biết bạn sẽ đi đâu — nó sẽ gói sẵn những câu cần luyện trước khi hạ cánh.',
    id:'Beri tahu Sinoky ke mana kamu pergi — ia akan menyiapkan kalimat untuk dilatih sebelum mendarat.',
    th:'บอก Sinoky ว่าคุณจะไปไหน — มันจะรวบรวมประโยคให้ซ้อมก่อนลงเครื่อง'
  },
  '{city} — {n} days to go. Push reminders will pack the right lines.': {
    zh:'{city} —— 还有 {n} 天。推送提醒会替你打包该练的句子。',
    es:'{city}: quedan {n} días. Los recordatorios prepararán las frases correctas.',
    ru:'{city} — осталось {n} дней. Напоминания соберут нужные фразы.',
    vi:'{city} — còn {n} ngày. Nhắc nhở sẽ gói đúng những câu cần luyện.',
    id:'{city} — tinggal {n} hari. Pengingat akan menyiapkan kalimat yang tepat.',
    th:'{city} — เหลืออีก {n} วัน การแจ้งเตือนจะรวบรวมประโยคที่ควรซ้อม'
  },
  'Trip saved.': {
    zh:'行程已保存。', es:'Viaje guardado.', ru:'Поездка сохранена.',
    vi:'Đã lưu chuyến đi.', id:'Perjalanan disimpan.', th:'บันทึกแผนเดินทางแล้ว'
  },
  'Trip cleared.': {
    zh:'行程已清除。', es:'Viaje borrado.', ru:'Поездка удалена.',
    vi:'Đã xoá chuyến đi.', id:'Perjalanan dihapus.', th:'ลบแผนเดินทางแล้ว'
  },
  'none': {
    zh:'不设置', es:'ninguno', ru:'нет',
    vi:'không', id:'tidak ada', th:'ไม่ระบุ'
  },
  'today': {
    zh:'今天', es:'hoy', ru:'сегодня', vi:'hôm nay', id:'hari ini', th:'วันนี้'
  },
  'tomorrow': {
    zh:'明天', es:'mañana', ru:'завтра', vi:'ngày mai', id:'besok', th:'พรุ่งนี้'
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
