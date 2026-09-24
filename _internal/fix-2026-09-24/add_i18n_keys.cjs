#!/usr/bin/env node
/* add_i18n_keys.cjs —— v0.24.1 新增字典 key（27 条 × 6 语言）
 *
 * 与 patch_i18n.py 配对：先在 index.html 里把盲区文案包上 T()，
 * 再由本脚本补齐 6 个字典。key 必须与运行时实际字符串逐字符一致
 * （含 emoji / 标点 / HTML 标签），故跑完立刻用 scripts/check-i18n.mjs 复核。
 *
 * 覆盖范围：
 *   A. VIEW_HINT 6 条（key 经 T(cfg.html) 变量传入，闸门 A 看不见 → 靠本脚本手工保证）
 *   B. chrome：限额芯片 2 / 剩余次数模板 1 / 声调纠错 2 / 声调名 5 / 注入段标题 1
 *   C. tourHtml 整卡 10 条
 *   D. 注入段正文 1 条
 *
 * 幂等：已存在的 key 跳过（按 JSON 解析结果判断，不靠字符串搜索）。
 * 用法：node _internal/fix-2026-09-24/add_i18n_keys.cjs [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..', '..');
const LANGS = ['zh', 'es', 'ru', 'vi', 'id', 'th'];
const DRY = process.argv.includes('--dry-run');

/* ── 教学演示部分（拼音 nǐ hǎo、声调符号 ā á ǎ à、▶ 🐢 0.5×）在所有语言中保持原样不译。 */
const NEW = {
  /* ===== A. VIEW_HINT（6 条）===== */
  '<b>先听，再跟我念 3 遍。</b><br>Tap the mic and say it out loud.': {
    zh: '<b>先听，再跟我念 3 遍。</b><br>点麦克风，大声说出来。',
    es: '<b>Escucha primero, repite 3 veces.</b><br>Toca el micrófono y dilo en voz alta.',
    ru: '<b>Сначала слушайте, потом повторите 3 раза.</b><br>Нажмите микрофон и скажите вслух.',
    vi: '<b>Nghe trước, rồi đọc theo 3 lần.</b><br>Nhấn mic và nói to lên.',
    id: '<b>Dengar dulu, lalu tirukan 3 kali.</b><br>Tekan mikrofon dan ucapkan dengan lantang.',
    th: '<b>ฟังก่อน แล้วพูดตาม 3 ครั้ง</b><br>แตะไมค์แล้วพูดออกมาดัง ๆ',
  },
  '<b>读一句，说一句。</b><br>Reading it is not the same as saying it.': {
    zh: '<b>读一句，说一句。</b><br>看懂不等于会说。',
    es: '<b>Lee una frase, di una frase.</b><br>Leerlo no es lo mismo que decirlo.',
    ru: '<b>Прочитайте фразу — и скажите её.</b><br>Прочитать не то же самое, что сказать.',
    vi: '<b>Đọc một câu, nói một câu.</b><br>Đọc hiểu không giống như nói ra.',
    id: '<b>Baca satu kalimat, ucapkan satu kalimat.</b><br>Membaca tidak sama dengan mengucapkan.',
    th: '<b>อ่านหนึ่งประโยค พูดหนึ่งประโยค</b><br>อ่านออกไม่เหมือนพูดออก',
  },
  '<b>选一句，说 3 遍。</b><br>Slow the first time, real the third.': {
    zh: '<b>选一句，说 3 遍。</b><br>第一遍慢，第三遍正常速度。',
    es: '<b>Elige una frase y dila 3 veces.</b><br>La primera despacio, la tercera a velocidad real.',
    ru: '<b>Выберите фразу и скажите её 3 раза.</b><br>Первый раз медленно, третий — в обычном темпе.',
    vi: '<b>Chọn một câu, nói 3 lần.</b><br>Lần đầu chậm, lần ba tốc độ thật.',
    id: '<b>Pilih satu kalimat, ucapkan 3 kali.</b><br>Pertama pelan, ketiga dengan tempo asli.',
    th: '<b>เลือกหนึ่งประโยค พูด 3 ครั้ง</b><br>ครั้งแรกช้า ๆ ครั้งที่สามความเร็วจริง',
  },
  '<b>挑一句，说给我听。</b><br>You saved these — now say them out loud.': {
    zh: '<b>挑一句，说给我听。</b><br>这些是你收藏的句子 —— 现在大声说出来。',
    es: '<b>Elige una frase y dímela.</b><br>Estas las guardaste tú — ahora dila en voz alta.',
    ru: '<b>Выберите фразу и скажите её мне.</b><br>Вы сами их сохранили — теперь скажите вслух.',
    vi: '<b>Chọn một câu, nói cho tôi nghe.</b><br>Đây là câu bạn đã lưu — giờ hãy nói to lên.',
    id: '<b>Pilih satu kalimat, ucapkan padaku.</b><br>Ini kalimat yang kamu simpan — sekarang ucapkan lantang.',
    th: '<b>เลือกหนึ่งประโยค พูดให้ฉันฟัง</b><br>นี่คือประโยคที่คุณบันทึกไว้ — ตอนนี้พูดออกมาดัง ๆ',
  },
  '<b>看懂了，也要说出来。</b><br>Understanding it is not the same as saying it.': {
    zh: '<b>看懂了，也要说出来。</b><br>看懂不等于会说。',
    es: '<b>Si lo entiendes, dìlo.</b><br>Entenderlo no es lo mismo que decirlo.',
    ru: '<b>Поняли — скажите вслух.</b><br>Понимать не то же самое, что говорить.',
    vi: '<b>Hiểu rồi cũng phải nói ra.</b><br>Hiểu không giống như nói ra.',
    id: '<b>Sudah paham pun harus diucapkan.</b><br>Paham tidak sama dengan mengucapkan.',
    th: '<b>เข้าใจแล้วก็ต้องพูดออกมา</b><br>เข้าใจไม่เหมือนพูดออก',
  },
  '<b>每一枚勋章，都是你开口换来的。</b><br>Say one more line — the next one is close.': {
    zh: '<b>每一枚勋章，都是你开口换来的。</b><br>再说一句 —— 下一枚就不远了。',
    es: '<b>Cada insignia la ganaste hablando.</b><br>Di una frase más — la siguiente está cerca.',
    ru: '<b>Каждая медаль получена за речь.</b><br>Скажите ещё фразу — следующая близко.',
    vi: '<b>Mỗi huy hiệu đều do bạn nói mà có.</b><br>Nói thêm một câu — cái tiếp theo sắp tới.',
    id: '<b>Setiap lencana kamu dapat dari berbicara.</b><br>Ucapkan satu kalimat lagi — yang berikutnya sudah dekat.',
    th: '<b>ทุกเหรียญคือผลจากการที่คุณพูด</b><br>พูดอีกประโยค — เหรียญต่อไปใกล้แล้ว',
  },

  /* ===== B. chrome ===== */
  '✅ Unlocked · unlimited': {
    zh: '✅ 已解锁 · 不限次数',
    es: '✅ Desbloqueado · sin límite',
    ru: '✅ Разблокировано · без ограничений',
    vi: '✅ Đã mở khóa · không giới hạn',
    id: '✅ Terbuka · tanpa batas',
    th: '✅ ปลดล็อกแล้ว · ไม่จำกัด',
  },
  '{n} {feat} left today': {
    zh: '今天还剩 {n} 次{feat}',
    es: 'Te quedan {n} {feat} hoy',
    ru: 'Сегодня осталось {n} {feat}',
    vi: 'Hôm nay còn {n} {feat}',
    id: 'Sisa {n} {feat} hari ini',
    th: 'วันนี้เหลือ {n} {feat}',
  },
  'should be': {
    zh: '应为',
    es: 'debe ser',
    ru: 'должен быть',
    vi: 'phải là',
    id: 'seharusnya',
    th: 'ควรเป็น',
  },
  ' · tone should be': {
    zh: ' · 声调应为',
    es: ' · el tono debe ser',
    ru: ' · тон должен быть',
    vi: ' · thanh phải là',
    id: ' · nada seharusnya',
    th: ' · เสียงควรเป็น',
  },
  'Nono will show you around': {
    zh: '诺诺带你认识',
    es: 'Nono te enseña el lugar',
    ru: 'Ноно покажет вам всё',
    vi: 'Nono dẫn bạn tham quan',
    id: 'Nono akan mengajakmu berkeliling',
    th: 'โนโนจะพาคุณรู้จัก',
  },
  '1st tone': {
    zh: '一声', es: '1er tono', ru: '1-й тон', vi: 'thanh 1', id: 'nada 1', th: 'เสียงที่ 1',
  },
  '2nd tone': {
    zh: '二声', es: '2do tono', ru: '2-й тон', vi: 'thanh 2', id: 'nada 2', th: 'เสียงที่ 2',
  },
  '3rd tone': {
    zh: '三声', es: '3er tono', ru: '3-й тон', vi: 'thanh 3', id: 'nada 3', th: 'เสียงที่ 3',
  },
  '4th tone': {
    zh: '四声', es: '4to tono', ru: '4-й тон', vi: 'thanh 4', id: 'nada 4', th: 'เสียงที่ 4',
  },
  'neutral tone': {
    zh: '轻声', es: 'tono neutro', ru: 'нейтральный тон', vi: 'thanh nhẹ', id: 'nada netral', th: 'เสียงเบา',
  },

  /* ===== C. tourHtml（整卡 10 条）===== */
  '👋 New here?': {
    zh: '👋 第一次来？',
    es: '👋 ¿Primera vez aquí?',
    ru: '👋 Впервые здесь?',
    vi: '👋 Lần đầu đến đây?',
    id: '👋 Baru di sini?',
    th: '👋 มาใหม่ใช่ไหม?',
  },
  '60 SECONDS': {
    zh: '60 秒', es: '60 SEGUNDOS', ru: '60 СЕКУНД', vi: '60 GIÂY', id: '60 DETIK', th: '60 วินาที',
  },
  'Three steps — that is the whole app:': {
    zh: '三步 —— 整个应用就这么简单：',
    es: 'Tres pasos — toda la app es esto:',
    ru: 'Три шага — вот и всё приложение:',
    vi: 'Ba bước — cả ứng dụng chỉ có vậy:',
    id: 'Tiga langkah — itulah seluruh aplikasinya:',
    th: 'สามขั้นตอน — ทั้งแอปมีแค่นี้:',
  },
  ['<b>New to Chinese?</b> Characters do not tell you how to say them — that is what the small ' +
   'letters above them are for (pinyin: <b>nǐ hǎo</b>). The little marks are tones: ā á ǎ à — ' +
   'four tones, four different words. Tap ▶ to hear any line; tap 🐢 to slow it down — tap again ' +
   'for slower (0.5×, best for hearing the tones).']: {
    zh: '<b>第一次学中文？</b>汉字本身看不出怎么念 —— 上面那行小字就是干这个用的（拼音：<b>nǐ hǎo</b>）。那些小符号是声调：ā á ǎ à —— 四个声调，四个不同的词。点 ▶ 听任意一句；点 🐢 放慢 —— 再点一次更慢（0.5×，最适合听声调）。',
    es: '<b>¿Nuevo en el chino?</b> Los caracteres no dicen cómo se pronuncian — para eso están las letras pequeñas de encima (pinyin: <b>nǐ hǎo</b>). Las marcas son tonos: ā á ǎ à — cuatro tonos, cuatro palabras distintas. Toca ▶ para oír cualquier frase; toca 🐢 para ir más lento — toca otra vez para ir aún más lento (0.5×, lo mejor para oír los tonos).',
    ru: '<b>Впервые за китайский?</b> По иероглифу не видно, как его читать — для этого и нужны маленькие буквы над ним (пиньинь: <b>nǐ hǎo</b>). Значки над ними — это тоны: ā á ǎ à — четыре тона, четыре разных слова. Нажмите ▶, чтобы услышать любую фразу; нажмите 🐢 для замедления — ещё раз для ещё медленнее (0.5×, лучше всего для тонов).',
    vi: '<b>Mới học tiếng Trung?</b> Chữ Hán không cho biết đọc thế nào — đó là việc của hàng chữ nhỏ phía trên (bính âm: <b>nǐ hǎo</b>). Các dấu nhỏ là thanh điệu: ā á ǎ à — bốn thanh, bốn từ khác nhau. Chạm ▶ để nghe bất kỳ câu nào; chạm 🐢 để đọc chậm — chạm lần nữa để chậm hơn (0.5×, tốt nhất để nghe thanh điệu).',
    id: '<b>Baru belajar bahasa Mandarin?</b> Aksara Han tidak menunjukkan cara membacanya — untuk itulah huruf kecil di atasnya (pinyin: <b>nǐ hǎo</b>). Tanda kecil itu nada: ā á ǎ à — empat nada, empat kata berbeda. Ketuk ▶ untuk mendengar baris mana pun; ketuk 🐢 untuk memperlambat — ketuk lagi untuk lebih lambat (0.5×, paling baik untuk mendengar nada).',
    th: '<b>เพิ่งเริ่มเรียนจีน?</b> ตัวจีนบอกไม่ได้ว่าอ่านอย่างไร — ตัวอักษรเล็กด้านบนมีไว้เพื่อสิ่งนี้ (พินอิน: <b>nǐ hǎo</b>) เครื่องหมายเล็ก ๆ คือเสียงวรรณยุกต์: ā á ǎ à — สี่เสียง สี่คำที่ต่างกัน แตะ ▶ เพื่อฟังประโยคใดก็ได้ แตะ 🐢 เพื่อให้ช้าลง — แตะอีกครั้งให้ช้าลงกว่าเดิม (0.5× เหมาะที่สุดสำหรับฟังเสียงวรรณยุกต์)',
  },
  '1️⃣ Tap a line below → listen, cover the Chinese, <b>say it out loud 3×</b>. Speaking is the whole point.': {
    zh: '1️⃣ 点下面任意一句 → 听，遮住中文，<b>大声说 3 遍</b>。开口才是重点。',
    es: '1️⃣ Toca una frase abajo → escucha, tapa el chino, <b>dila en voz alta 3×</b>. Hablar es lo único que importa.',
    ru: '1️⃣ Нажмите любую фразу ниже → слушайте, закройте китайский, <b>скажите вслух 3×</b>. Главное — говорить.',
    vi: '1️⃣ Chạm vào một câu bên dưới → nghe, che chữ Hán, <b>nói to 3 lần</b>. Nói ra mới là điều quan trọng.',
    id: '1️⃣ Ketuk satu baris di bawah → dengar, tutup aksara Han, <b>ucapkan lantang 3×</b>. Berbicara itu intinya.',
    th: '1️⃣ แตะประโยคด้านล่าง → ฟัง ปิดอักษรจีน <b>พูดออกมาดัง ๆ 3 ครั้ง</b> การพูดคือหัวใจ',
  },
  '2️⃣ Do one <b>Day</b> card a day — the streak keeps you coming back.': {
    zh: '2️⃣ 每天做一张<b>每日</b>卡 —— 连续打卡让你坚持下来。',
    es: '2️⃣ Haz una tarjeta de <b>Día</b> al día — la racha te hace volver.',
    ru: '2️⃣ Делайте одну карточку <b>Дня</b> в день — серия возвращает вас обратно.',
    vi: '2️⃣ Mỗi ngày làm một thẻ <b>Ngày</b> — chuỗi ngày giúp bạn quay lại.',
    id: '2️⃣ Kerjakan satu kartu <b>Hari</b> setiap hari — rentetan hari membuatmu kembali.',
    th: '2️⃣ ทำการ์ด<b>วัน</b>วันละใบ — สตรีคช่วยให้คุณกลับมาทุกวัน',
  },
  '3️⃣ Open <b>Tones</b> for 1 minute — train your ear: four tones, four different words.': {
    zh: '3️⃣ 打开<b>声调</b>练 1 分钟 —— 练耳朵：四个声调，四个不同的词。',
    es: '3️⃣ Abre <b>Tonos</b> 1 minuto — entrena el oído: cuatro tonos, cuatro palabras distintas.',
    ru: '3️⃣ Откройте <b>Тоны</b> на 1 минуту — тренируйте слух: четыре тона, четыре разных слова.',
    vi: '3️⃣ Mở <b>Thanh điệu</b> trong 1 phút — luyện tai: bốn thanh, bốn từ khác nhau.',
    id: '3️⃣ Buka <b>Nada</b> selama 1 menit — latih pendengaran: empat nada, empat kata berbeda.',
    th: '3️⃣ เปิด<b>เสียงวรรณยุกต์</b> 1 นาที — ฝึกหู: สี่เสียง สี่คำที่ต่างกัน',
  },
  '4️⃣ Want to <b>write</b> characters too? Open <b>Cards</b> → tap ✍️ <b>Strokes</b> — watch the stroke order, then trace it yourself.': {
    zh: '4️⃣ 还想<b>写</b>汉字？打开<b>汉字卡片</b> → 点 ✍️ <b>笔顺</b> —— 看笔顺，然后自己描一遍。',
    es: '4️⃣ ¿También quieres <b>escribir</b> caracteres? Abre <b>Tarjetas</b> → toca ✍️ <b>Trazos</b> — mira el orden de trazos y repítelo tú.',
    ru: '4️⃣ Хотите ещё и <b>писать</b> иероглифы? Откройте <b>Карточки</b> → нажмите ✍️ <b>Черты</b> — смотрите порядок черт и повторяйте сами.',
    vi: '4️⃣ Muốn <b>viết</b> chữ Hán nữa? Mở <b>Thẻ</b> → chạm ✍️ <b>Nét</b> — xem thứ tự nét rồi tự viết theo.',
    id: '4️⃣ Mau juga <b>menulis</b> aksara Han? Buka <b>Kartu</b> → ketuk ✍️ <b>Goresan</b> — lihat urutan goresan, lalu tirukan sendiri.',
    th: '4️⃣ อยาก<b>เขียน</b>ตัวจีนด้วยไหม? เปิด<b>การ์ด</b> → แตะ ✍️ <b>ลำดับขีด</b> — ดูลำดับขีดแล้วลากตามเอง',
  },
  '🔒 Recordings are never saved · 💬 Feedback (bottom-left) any time': {
    zh: '🔒 录音不会保存 · 💬 随时反馈（左下角）',
    es: '🔒 Las grabaciones nunca se guardan · 💬 Comentarios (abajo a la izquierda) cuando quieras',
    ru: '🔒 Записи не сохраняются · 💬 Отзыв (слева внизу) в любой момент',
    vi: '🔒 Bản ghi không bao giờ được lưu · 💬 Góp ý (góc dưới bên trái) bất cứ lúc nào',
    id: '🔒 Rekaman tidak pernah disimpan · 💬 Masukan (kiri bawah) kapan saja',
    th: '🔒 ไม่บันทึกเสียง · 💬 ส่งความคิดเห็น (มุมซ้ายล่าง) ได้ทุกเมื่อ',
  },
  "Got it — let's speak": {
    zh: '明白，开口说！',
    es: 'Entendido — ¡a hablar!',
    ru: 'Понятно — давайте говорить!',
    vi: 'Hiểu rồi — nói thôi!',
    id: 'Mengerti — ayo bicara!',
    th: 'เข้าใจแล้ว — มาพูดกันเลย!',
  },

  /* ===== D. 注入段正文 ===== */
  'I’m Nono 🐼 — here are the three things that matter. Want the full map? Tap me any time.': {
    zh: '我是诺诺 🐼 —— 这三件事最重要。想要完整地图？随时点我。',
    es: 'Soy Nono 🐼 — estas son las tres cosas que importan. ¿Quieres el mapa completo? Tócame cuando quieras.',
    ru: 'Я Ноно 🐼 — вот три главные вещи. Нужна полная карта? Нажмите на меня в любой момент.',
    vi: 'Mình là Nono 🐼 — đây là ba điều quan trọng nhất. Muốn xem toàn bộ bản đồ? Chạm vào mình bất cứ lúc nào.',
    id: 'Aku Nono 🐼 — ini tiga hal yang penting. Mau peta lengkapnya? Ketuk aku kapan saja.',
    th: 'ฉันคือโนโน 🐼 — นี่คือสามสิ่งสำคัญ อยากได้แผนที่เต็ม ๆ ไหม? แตะฉันได้ทุกเมื่อ',
  },
};

/* ── 校验：每条 key 必须 6 语言齐备且非空 */
let bad = 0;
for (const [k, v] of Object.entries(NEW)) {
  for (const l of LANGS) {
    if (!v[l] || !String(v[l]).trim()) { console.error('✗ 译文缺失：' + l + ' / ' + JSON.stringify(k.slice(0, 60))); bad++; }
  }
}
if (bad) { console.error('\n译文表有 ' + bad + ' 处缺失，未写盘。'); process.exit(1); }

console.log('== add_i18n_keys.cjs ==');
console.log('待补 key：' + Object.keys(NEW).length + ' 条 × ' + LANGS.length + ' 语言');
console.log('模式：' + (DRY ? 'DRY-RUN（不写盘）' : '写入') + '\n');

let totalAdded = 0;
for (const l of LANGS) {
  const p = path.join(APP, 'langs', l + '.json');
  const raw = fs.readFileSync(p, 'utf8');
  const obj = JSON.parse(raw);
  const missing = Object.keys(NEW).filter((k) => !Object.prototype.hasOwnProperty.call(obj, k));
  if (!missing.length) { console.log('  = ' + l + '：无需新增（已齐备）'); continue; }

  const block = missing.map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(NEW[k][l])).join(',\n');
  const i = raw.lastIndexOf('}');
  let out = raw.slice(0, i).replace(/\s+$/, '') + ',\n' + block + '\n}\n';

  /* 写前自检：能解析且 key 数正确 */
  const after = JSON.parse(out);
  if (Object.keys(after).length !== Object.keys(obj).length + missing.length) {
    console.error('✗ ' + l + '：合并后 key 数不符，未写盘');
    process.exit(1);
  }
  if (!DRY) fs.writeFileSync(p, out, 'utf8');
  totalAdded += missing.length;
  console.log('  ✓ ' + l + '：新增 ' + missing.length + ' 条（' + Object.keys(obj).length + ' → ' + Object.keys(after).length + '）');
}
console.log('\n合计新增 ' + totalAdded + ' 条译文。');
