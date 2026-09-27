#!/usr/bin/env node
/* v0.25.0 一次性开发脚本：为 LearnerModel / Path / Placement 新增文案补齐 6 语言。
   用法：node _internal/add_lm_i18n.cjs
   规则：已存在的 key 一律**跳过不覆盖**（保护既有译文）；新增 key 才写入。
   不进 web 构建（build-web.mjs 只拷白名单目录）。 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'langs');

const ADD = {
  /* ---- 向导新增两步（HTML 文本节点，applyI18n 按 trim 后精确匹配）---- */
  'Where are you':        { zh:'你要去', es:'¿A dónde', ru:'Куда вы', vi:'Bạn đang', id:'Anda mau', th:'คุณจะไป' },
  'heading?':             { zh:'哪里？', es:'vas?', ru:'направляетесь?', vi:'đi đâu?', id:'ke mana?', th:'ที่ไหน?' },
  "Pick a city and your arrival date — we'll build a last-minute pack of the lines you'll actually need. Skip if you have no fixed plan.": {
    zh:'选一个城市和抵达日期——我们会给你打包好真正用得上的那几句。没有固定计划的话，跳过就行。',
    es:'Elige una ciudad y tu fecha de llegada: te prepararemos un paquete de frases que de verdad usarás. Si no tienes un plan fijo, sáltalo.',
    ru:'Выберите город и дату приезда — мы соберём набор фраз, которые вам действительно пригодятся. Нет точного плана — пропустите.',
    vi:'Chọn một thành phố và ngày đến — chúng tôi sẽ gom sẵn những câu bạn thật sự cần. Không có kế hoạch cố định thì bỏ qua.',
    id:'Pilih kota dan tanggal kedatangan — kami akan menyiapkan kumpulan kalimat yang benar-benar Anda butuhkan. Tidak ada rencana pasti? Lewati saja.',
    th:'เลือกเมืองและวันเดินทาง — เราจะเตรียมประโยคที่คุณจะได้ใช้จริงไว้ให้ ถ้ายังไม่มีแผนแน่นอน ข้ามไปได้เลย'
  },
  'Arrival date':         { zh:'抵达日期', es:'Fecha de llegada', ru:'Дата приезда', vi:'Ngày đến', id:'Tanggal kedatangan', th:'วันเดินทาง' },
  '(optional)':           { zh:'（可不填）', es:'(opcional)', ru:'(необязательно)', vi:'(không bắt buộc)', id:'(opsional)', th:'(ไม่บังคับ)' },
  'Your mother tongue?':  { zh:'你的母语是什么？', es:'¿Cuál es tu lengua materna?', ru:'Ваш родной язык?', vi:'Tiếng mẹ đẻ của bạn?', id:'Bahasa ibu Anda?', th:'ภาษาหลักของคุณ?' },
  'This shapes how we explain tones and word order — it is not the app language.': {
    zh:'这会影响我们怎么给你讲声调和语序——不是 App 的界面语言。',
    es:'Esto define cómo te explicamos los tonos y el orden de las palabras: no es el idioma de la app.',
    ru:'От этого зависит, как мы объясняем тоны и порядок слов. Это не язык интерфейса.',
    vi:'Điều này quyết định cách chúng tôi giải thích thanh điệu và trật tự từ — không phải ngôn ngữ giao diện.',
    id:'Ini menentukan cara kami menjelaskan nada dan urutan kata — bukan bahasa antarmuka.',
    th:'สิ่งนี้กำหนดวิธีที่เราอธิบายวรรณยุกต์และลำดับคำ ไม่ใช่ภาษาของแอป'
  },
  /* ---- M1 Placement ---- */
  'Quick placement':      { zh:'快速定位', es:'Prueba rápida', ru:'Быстрый тест', vi:'Xếp lớp nhanh', id:'Tes cepat', th:'วัดระดับเร็ว ๆ' },
  'Listen — what did you hear?': { zh:'听——你听到了什么？', es:'Escucha: ¿qué oíste?', ru:'Слушайте — что вы услышали?', vi:'Nghe — bạn nghe được gì?', id:'Dengar — apa yang Anda dengar?', th:'ฟัง — คุณได้ยินอะไร?' },
  'Play again':           { zh:'再听一遍', es:'Reproducir otra vez', ru:'Повторить', vi:'Phát lại', id:'Putar lagi', th:'เล่นอีกครั้ง' },
  'How is this said?':    { zh:'这句怎么读？', es:'¿Cómo se dice?', ru:'Как это произносится?', vi:'Câu này đọc thế nào?', id:'Bagaimana cara membacanya?', th:'คำนี้อ่านว่าอย่างไร?' },
  'Skip this':            { zh:'跳过', es:'Saltar', ru:'Пропустить', vi:'Bỏ qua', id:'Lewati', th:'ข้าม' },
  'Correct':              { zh:'答对了', es:'Correcto', ru:'Верно', vi:'Đúng rồi', id:'Benar', th:'ถูกต้อง' },
  'Not quite':            { zh:'还差一点', es:'Casi', ru:'Почти', vi:'Chưa đúng', id:'Hampir', th:'ใกล้แล้ว' },
  'Review':               { zh:'复习', es:'Repaso', ru:'Повторение', vi:'Ôn tập', id:'Ulasan', th:'ทบทวน' },
  "We've placed you":     { zh:'已为你定位', es:'Ya te hemos ubicado', ru:'Мы определили ваш уровень', vi:'Đã xác định trình độ của bạn', id:'Kami sudah menilai level Anda', th:'เราจัดระดับให้คุณแล้ว' },
  'Level':                { zh:'水平', es:'Nivel', ru:'Уровень', vi:'Trình độ', id:'Level', th:'ระดับ' },
  'Accuracy':             { zh:'正确率', es:'Precisión', ru:'Точность', vi:'Độ chính xác', id:'Akurasi', th:'ความแม่นยำ' },
  "Start today's path":   { zh:'开始今天的路径', es:'Empezar la ruta de hoy', ru:'Начать сегодняшний путь', vi:'Bắt đầu lộ trình hôm nay', id:'Mulai jalur hari ini', th:'เริ่มเส้นทางวันนี้' },
  /* ---- M2 Path ---- */
  "Today's path":         { zh:'今日路径', es:'Ruta de hoy', ru:'Путь на сегодня', vi:'Lộ trình hôm nay', id:'Jalur hari ini', th:'เส้นทางวันนี้' },
  'say 3 lines today':    { zh:'今天说 3 句', es:'di 3 frases hoy', ru:'скажите 3 фразы сегодня', vi:'nói 3 câu hôm nay', id:'ucapkan 3 kalimat hari ini', th:'พูด 3 ประโยควันนี้' },
  'Finish the journey':   { zh:'完成这趟旅程', es:'Terminar el viaje', ru:'Завершить путешествие', vi:'Hoàn thành hành trình', id:'Selesaikan perjalanan', th:'จบการเดินทาง' },
  'Must say':             { zh:'必说', es:'Obligatorio', ru:'Обязательно', vi:'Bắt buộc', id:'Wajib', th:'ต้องพูด' },
  'Bonus':                { zh:'顺带', es:'Extra', ru:'Бонус', vi:'Thêm', id:'Bonus', th:'โบนัส' },
  'Mark node done':       { zh:'标记本节点完成', es:'Marcar como hecho', ru:'Отметить как пройденное', vi:'Đánh dấu đã xong', id:'Tandai selesai', th:'ทำเครื่องหมายว่าเสร็จ' },
  'Re-test my level':     { zh:'重新测一次水平', es:'Volver a evaluar mi nivel', ru:'Пройти тест заново', vi:'Kiểm tra lại trình độ', id:'Tes ulang level saya', th:'วัดระดับใหม่' }
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

/* 校验依赖 key 是否齐备（PLACE.finish 复用既有档位文案） */
const zh = JSON.parse(fs.readFileSync(path.join(DIR,'zh.json'),'utf8'));
['Absolute beginner','Some basics','I can get by'].forEach(function(k){
  console.log('dep "' + k + '" → ' + (Object.prototype.hasOwnProperty.call(zh,k) ? 'OK' : 'MISSING'));
});
