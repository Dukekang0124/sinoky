# -*- coding: utf-8 -*-
"""i18n 字典合并 v1（2026-09-22）—— 为本轮修复补齐 6 语种译文。
铁律：只补不覆盖；ru 必含西里尔 / th 必含泰文；写回 indent=1 + ensure_ascii=False + 末尾换行；LF 保留。
"""
import json, io, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.normpath(os.path.join(HERE, '..', '..', 'langs'))
LANGS = ['zh', 'es', 'ru', 'vi', 'id', 'th']

# key: (zh, es, ru, vi, id, th)
M = {
'Quota used up for today': ('今天的额度用完了','Se acabó tu cuota de hoy','Дневная квота исчерпана','Hạn mức hôm nay đã dùng hết','Kuota hari ini sudah habis','โควตาของวันนี้หมดแล้ว'),
'Nice work installing the app — but the free quota is limited each day. Add me on WeChat <b>{wx}</b> to unlock everything (permanently).': ('装到手机已经很给力了，但免费额度每天有限。加我微信 <b>{wx}</b> 解锁全部功能（永久）。','¡Bien hecho al instalar la app! Pero la cuota gratuita es limitada cada día. Añádeme en WeChat <b>{wx}</b> para desbloquear todo (para siempre).','Класс, что установили приложение! Но бесплатная квота ограничена каждый день. Добавьте меня в WeChat <b>{wx}</b>, чтобы разблокировать всё (навсегда).','Cài app là giỏi lắm rồi — nhưng hạn mức miễn phí mỗi ngày có giới hạn. Thêm tôi trên WeChat <b>{wx}</b> để mở khoá tất cả (vĩnh viễn).','Hebat sudah memasang aplikasinya — tapi kuota gratis terbatas setiap hari. Tambahkan saya di WeChat <b>{wx}</b> untuk membuka semua fitur (permanen).','ติดตั้งแอปแล้วเยี่ยมมาก — แต่โควตาฟรีมีจำกัดในแต่ละวัน เพิ่มฉันเป็นเพื่อนที่ WeChat <b>{wx}</b> เพื่อปลดล็อกทุกอย่าง (ถาวร)'),
'① Tap "Copy WeChat ID"<br>② Open WeChat → top-right ＋ → Add Contacts<br>③ Paste {wx} → send the unlock code': ('① 点「复制微信号」<br>② 打开微信 → 右上角 ＋ → 添加朋友<br>③ 粘贴 {wx} → 发「解锁码」','① Toca «Copiar ID de WeChat»<br>② Abre WeChat → ＋ arriba a la derecha → Añadir contactos<br>③ Pega {wx} → envía el código de desbloqueo','① Нажмите «Скопировать ID WeChat»<br>② Откройте WeChat → «＋» вверху справа → Добавить контакты<br>③ Вставьте {wx} → отправьте код разблокировки','① Chạm «Sao chép WeChat ID»<br>② Mở WeChat → ＋ góc trên bên phải → Thêm bạn<br>③ Dán {wx} → gửi mã mở khoá','① Ketuk «Salin ID WeChat»<br>② Buka WeChat → ＋ di kanan atas → Tambah Kontak<br>③ Tempel {wx} → kirim kode pembuka','① แตะ «คัดลอก WeChat ID»<br>② เปิด WeChat → ＋ มุมขวาบน → เพิ่มเพื่อน<br>③ วาง {wx} → ส่งรหัสปลดล็อก'),
'Copy WeChat ID': ('复制微信号','Copiar ID de WeChat','Скопировать ID WeChat','Sao chép WeChat ID','Salin ID WeChat','คัดลอก WeChat ID'),
'I have added WeChat — unlock everything': ('我已添加微信，解锁全部功能','Ya añadí WeChat — desbloquear todo','Я добавил WeChat — разблокировать всё','Tôi đã thêm WeChat — mở khoá tất cả','Saya sudah menambahkan WeChat — buka semua','เพิ่ม WeChat แล้ว — ปลดล็อกทั้งหมด'),
'Or enter an unlock code': ('或输入解锁码','O introduce un código de desbloqueo','Или введите код разблокировки','Hoặc nhập mã mở khoá','Atau masukkan kode pembuka','หรือกรอกรหัสปลดล็อก'),
'Unlock': ('解锁','Desbloquear','Разблокировать','Mở khoá','Buka kunci','ปลดล็อก'),
'Free uses are used up for today': ('今天的免费次数用完了','Se acabaron los usos gratis de hoy','Бесплатные попытки на сегодня закончились','Số lần dùng miễn phí hôm nay đã hết','Jumlah penggunaan gratis hari ini sudah habis','จำนวนครั้งฟรีของวันนี้หมดแล้ว'),
'Free version has a daily limit — install the app for unlimited use. All your learning data is kept.': ('免费版每天有限额，装 App 后不限次数 —— 你的学习数据会全部保留。','La versión gratuita tiene límite diario: instala la app para uso ilimitado. Todos tus datos de aprendizaje se conservan.','У бесплатной версии дневной лимит: установите приложение для неограниченного использования. Все данные обучения сохранятся.','Bản miễn phí có giới hạn mỗi ngày — cài app để dùng không giới hạn. Toàn bộ dữ liệu học của bạn vẫn được giữ.','Versi gratis punya batas harian — pasang aplikasinya untuk penggunaan tanpa batas. Semua data belajarmu tetap tersimpan.','เวอร์ชันฟรีมีโควตาต่อวัน — ติดตั้งแอปเพื่อใช้ไม่จำกัด ข้อมูลการเรียนของคุณจะถูกเก็บไว้ทั้งหมด'),
'Free chat is {n} rounds a day. Install the app for unlimited use.': ('诺诺聊天每天免费 {n} 轮。装 App 后不限次数。','El chat gratis es de {n} rondas al día. Instala la app para uso ilimitado.','Бесплатный чат — {n} раундов в день. Установите приложение для неограниченного использования.','Chat miễn phí mỗi ngày {n} lượt. Cài app để dùng không giới hạn.','Chat gratis {n} ronde per hari. Pasang aplikasinya untuk tanpa batas.','แชตฟรีวันละ {n} รอบ ติดตั้งแอปเพื่อใช้ไม่จำกัด'),
'Tone training is {n} questions a day for free. Install the app for unlimited use.': ('声调训练每天免费 {n} 题。装 App 后不限次数。','El entrenamiento de tonos es de {n} preguntas gratis al día. Instala la app para uso ilimitado.','Тренировка тонов — {n} вопросов в день бесплатно. Установите приложение для неограниченного использования.','Luyện thanh điệu miễn phí mỗi ngày {n} câu. Cài app để dùng không giới hạn.','Latihan nada gratis {n} soal per hari. Pasang aplikasinya untuk tanpa batas.','ฝึกวรรณยุกต์ฟรีวันละ {n} ข้อ ติดตั้งแอปเพื่อใช้ไม่จำกัด'),
'{n} new lines a day for free. Install the app for unlimited use.': ('每天免费练 {n} 句新内容。装 App 后不限次数。','{n} frases nuevas gratis al día. Instala la app para uso ilimitado.','{n} новых фраз в день бесплатно. Установите приложение для неограниченного использования.','Miễn phí {n} câu mới mỗi ngày. Cài app để dùng không giới hạn.','Gratis {n} kalimat baru per hari. Pasang aplikasinya untuk tanpa batas.','ฟรี {n} ประโยคใหม่ต่อวัน ติดตั้งแอปเพื่อใช้ไม่จำกัด'),
'Install App · Unlimited': ('装 App · 不限次数','Instalar app · Ilimitado','Установить приложение · Без лимита','Cài app · Không giới hạn','Pasang Aplikasi · Tanpa Batas','ติดตั้งแอป · ไม่จำกัด'),
'Practise review for today': ('今天先练复习','Hoy repasa con el modo Repaso','На сегодня — повторение','Hôm nay luyện Ôn tập trước','Hari ini latih Ulangan dulu','วันนี้ฝึกโหมดทบทวนก่อน'),
'WeChat ID copied: {wx} — add me on WeChat to unlock': ('微信号已复制：{wx}，去微信加我解锁','ID de WeChat copiado: {wx} — añádeme en WeChat para desbloquear','ID WeChat скопирован: {wx} — добавьте меня в WeChat, чтобы разблокировать','Đã sao chép WeChat ID: {wx} — thêm tôi trên WeChat để mở khoá','ID WeChat disalin: {wx} — tambahkan saya di WeChat untuk membuka','คัดลอก WeChat ID แล้ว: {wx} — เพิ่มฉันบน WeChat เพื่อปลดล็อก'),
'✅ Everything unlocked · thanks for the support!': ('✅ 已解锁全部功能 · 感谢支持！','✅ Todo desbloqueado · ¡gracias por tu apoyo!','✅ Всё разблокировано · спасибо за поддержку!','✅ Đã mở khoá tất cả · cảm ơn bạn đã ủng hộ!','✅ Semua terbuka · terima kasih atas dukungannya!','✅ ปลดล็อกครบทุกอย่างแล้ว · ขอบคุณที่สนับสนุน!'),
'That code is not right — get one from WeChat {wx}': ('解锁码不对，加微信 {wx} 领取','Ese código no es correcto: consíguelo por WeChat {wx}','Код неверный — получите его в WeChat {wx}','Mã chưa đúng — lấy mã qua WeChat {wx}','Kode salah — dapatkan kodenya lewat WeChat {wx}','รหัสไม่ถูกต้อง — รับรหัสได้ที่ WeChat {wx}'),
'Unlock removed': ('已撤销解锁','Desbloqueo cancelado','Разблокировка отменена','Đã huỷ mở khoá','Pembukaan dibatalkan','ยกเลิกการปลดล็อกแล้ว'),
'New lines spoken': ('新句开口','Frases nuevas habladas','Новые фразы (вслух)','Câu mới đã nói','Kalimat baru diucapkan','ประโยคใหม่ที่ได้พูด'),
'Read & score': ('跟读打分','Leer y puntuar','Читать и оценивать','Đọc và chấm điểm','Baca & nilai','อ่านและให้คะแนน'),
'Nono chat': ('诺诺聊天','Chat con Nono','Чат с Ноно','Chat với Nono','Chat dengan Nono','แชตกับโหน่น'),
'No limit': ('不限','Sin límite','Без лимита','Không giới hạn','Tanpa batas','ไม่จำกัด'),
'No limit (unlocked)': ('不限（已解锁）','Sin límite (desbloqueado)','Без лимита (разблокировано)','Không giới hạn (đã mở khoá)','Tanpa batas (terbuka)','ไม่จำกัด (ปลดล็อกแล้ว)'),
'✅ Unlocked · thanks for the support': ('✅ 已解锁 · 感谢支持','✅ Desbloqueado · gracias por tu apoyo','✅ Разблокировано · спасибо за поддержку','✅ Đã mở khoá · cảm ơn bạn đã ủng hộ','✅ Terbuka · terima kasih atas dukungannya','✅ ปลดล็อกแล้ว · ขอบคุณที่สนับสนุน'),
'Undo': ('撤销','Deshacer','Отменить','Hoàn tác','Batalkan','ยกเลิก'),
'🔓 Unlock features': ('🔓 功能解锁','🔓 Desbloquear funciones','🔓 Разблокировать функции','🔓 Mở khoá tính năng','🔓 Buka fitur','🔓 ปลดล็อกฟีเจอร์'),
' (App gets 3× quota)': ('（App 已享 3 倍额度）',' (La app tiene 3× de cuota)',' (в приложении квота ×3)',' (App được hạn mức gấp 3)',' (Aplikasi dapat kuota 3×)',' (แอปได้โควตา 3 เท่า)'),
"Today's quota": ('今日额度','Cuota de hoy','Квота на сегодня','Hạn mức hôm nay','Kuota hari ini','โควตาวันนี้'),
'Free version': ('免费版','Versión gratuita','Бесплатная версия','Bản miễn phí','Versi gratis','เวอร์ชันฟรี'),
'Review, flashcards, badges and progress are never limited — only "production" features count against the quota.': ('复习 / 字卡 / 徽章 / 进度永不限制 —— 只限制「生产」类功能。','Repaso, tarjetas, insignias y progreso nunca tienen límite: solo las funciones de «producción» gastan cuota.','Повторение, карточки, значки и прогресс никогда не ограничены — квоту расходуют только функции «продакшена».','Ôn tập, thẻ, huy hiệu và tiến độ không bao giờ giới hạn — chỉ tính năng «sản xuất» mới tốn hạn mức.','Ulangan, kartu, lencana, dan progres tidak pernah dibatasi — hanya fitur «produksi» yang memakai kuota.','ทบทวน บัตรคำ เหรียญตรา และความคืบหน้า ไม่มีวันจำกัด — เฉพาะฟีเจอร์ «ผลิตเสียง» เท่านั้นที่ใช้โควตา'),
'Say your own line 💬': ('接一句 💬','Di tu propia frase 💬','Скажи свою фразу 💬','Nói câu của bạn 💬','Ucapkan kalimatmu sendiri 💬','พูดประโยคของคุณเอง 💬'),
'You just said: <b>{hz}</b><br>Swap a word and say your own line → 3 seconds is enough (not scored — we just count that you spoke).': ('你刚说了：<b>{hz}</b><br>换一个词，说一句你自己的 → 说 3 秒就行（不判分，只记录你开口了）。','Acabas de decir: <b>{hz}</b><br>Cambia una palabra y di una frase tuya → 3 segundos bastan (sin puntuación: solo contamos que hablaste).','Вы только что сказали: <b>{hz}</b><br>Замените одно слово и скажите свою фразу → 3 секунд хватит (без оценки: мы просто отмечаем, что вы заговорили).','Bạn vừa nói: <b>{hz}</b><br>Đổi một từ rồi nói câu của bạn → 3 giây là đủ (không chấm điểm: chỉ ghi nhận bạn đã mở miệng).','Kamu baru saja mengatakan: <b>{hz}</b><br>Ganti satu kata dan ucapkan kalimatmu sendiri → 3 detik saja cukup (tanpa penilaian: kami hanya mencatat kamu berbicara).','คุณเพิ่งพูดว่า: <b>{hz}</b><br>เปลี่ยนคำแล้วพูดประโยคของคุณเอง → 3 วินาทีก็พอ (ไม่ให้คะแนน: แค่บันทึกว่าคุณได้พูด)'),
'I will say my own line': ('我来改一句','Digo mi propia frase','Я скажу свою фразу','Tôi sẽ nói câu của mình','Aku ucapkan kalimatku sendiri','ฉันจะพูดประโยคของตัวเอง'),
'Skip': ('跳过','Omitir','Пропустить','Bỏ qua','Lewati','ข้าม'),
'This browser cannot record audio. You are already practising — skipping is fine 👍': ('这个浏览器不支持录音。你已经在练了，跳过也行 👍','Este navegador no puede grabar audio. Ya estás practicando: puedes omitirlo 👍','Этот браузер не может записывать звук. Вы уже занимаетесь — можно пропустить 👍','Trình duyệt này không ghi âm được. Bạn vẫn đang luyện tập — bỏ qua cũng được 👍','Browser ini tidak bisa merekam audio. Kamu sudah berlatih — lewati saja 👍','เบราว์เซอร์นี้อัดเสียงไม่ได้ แต่คุณก็ฝึกไปแล้ว — ข้ามได้เลย 👍'),
'Did not hear anything — try again ✦': ('没听到声音，再试一次 ✦','No escuché nada: inténtalo de nuevo ✦','Ничего не услышали — попробуйте ещё раз ✦','Chưa nghe thấy gì — thử lại nhé ✦','Tidak terdengar suara — coba lagi ✦','ไม่ได้ยินเสียง — ลองอีกครั้ง ✦'),
'✅ You said a line of your own Chinese! (total lines: {n})': ('✅ 你说了一句自己的中文！（累计扩展句：{n}）','✅ ¡Dijiste una frase tuya en chino! (total: {n})','✅ Вы сказали свою фразу по-китайски! (всего: {n})','✅ Bạn đã nói một câu tiếng Trung của riêng mình! (tổng cộng: {n})','✅ Kamu mengucapkan satu kalimat Mandarin buatanmu sendiri! (total: {n})','✅ คุณพูดประโยคภาษาจีนของตัวเองแล้ว! (รวมทั้งหมด: {n})'),
'Recording error — skipping is fine ✦': ('录音出错，跳过也行 ✦','Error de grabación: puedes omitirlo ✦','Ошибка записи — можно пропустить ✦','Lỗi ghi âm — bỏ qua cũng được ✦','Ada galat perekaman — lewati saja ✦','การอัดเสียงมีปัญหา — ข้ามได้เลย ✦'),
'Tap here when done': ('说完了点这里','Toca aquí al terminar','Нажмите здесь, когда закончите','Nói xong chạm vào đây','Ketuk di sini setelah selesai','พูดเสร็จแตะที่นี่'),
'● Recording… say it, then tap "done"': ('● 录音中…说完点「说完了」','● Grabando… dilo y toca «terminado»','● Запись… скажите и нажмите «готово»','● Đang ghi âm… nói xong chạm «xong»','● Merekam… ucapkan, lalu ketuk «selesai»','● กำลังอัด… พูดแล้วแตะ «เสร็จ»'),
'Done': ('完成','Listo','Готово','Xong','Selesai','เสร็จ'),
'The microphone would not open — skipping is fine 👍': ('麦克风打不开，跳过也行 👍','El micrófono no se pudo abrir: puedes omitirlo 👍','Не удалось открыть микрофон — можно пропустить 👍','Không mở được micrô — bỏ qua cũng được 👍','Mikrofon tidak bisa dibuka — lewati saja 👍','เปิดไมโครโฟนไม่ได้ — ข้ามได้เลย 👍'),
'Pronunciation unavailable — ': ('发音暂不可用 — ','Pronunciación no disponible — ','Произношение недоступно — ','Phát âm tạm thời không khả dụng — ','Pelafalan tidak tersedia — ','ออกเสียงไม่ได้ชั่วคราว — '),
'Read after me': ('跟我读','Repite después de mí','Повторяй за мной','Đọc theo tôi','Baca mengikuti aku','อ่านตามฉัน'),
'Practice with me — <b>Read after me</b>': ('和我一起练 — <b>跟我读</b>','Practica conmigo — <b>repite después de mí</b>','Потренируйся со мной — <b>повторяй за мной</b>','Luyện cùng tôi — <b>đọc theo tôi</b>','Berlatihlah denganku — <b>baca mengikutiku</b>','ฝึกกับฉัน — <b>อ่านตามฉัน</b>'),
'They: ': ('他们：','Ellos: ','Они: ','Họ: ','Mereka: ','พวกเขา: '),
'They said "{hz}" — you answer: {en} (check ✓ after speaking)': ('他们说了「{hz}」 — 你答：{en}（答完看 ✓）','Ellos dijeron «{hz}» — tú respondes: {en} (marca ✓ al terminar)','Они сказали «{hz}» — вы отвечаете: {en} (после ответа нажмите ✓)','Họ nói «{hz}» — bạn đáp: {en} (nói xong xem ✓)','Mereka berkata «{hz}» — kamu menjawab: {en} (centang ✓ setelah bicara)','พวกเขาพูดว่า «{hz}» — คุณตอบ: {en} (พูดเสร็จดู ✓)'),
'Coming soon': ('待补充','Pronto disponible','Скоро появится','Sắp có','Segera hadir','เร็ว ๆ นี้'),
'HSK{n} deck is coming soon.': ('HSK{n} 字卡即将上线。','El mazo HSK{n} llegará pronto.','Колода HSK{n} скоро появится.','Bộ thẻ HSK{n} sắp ra mắt.','Dek HSK{n} segera hadir.','ชุดบัตรคำ HSK{n} เร็ว ๆ นี้'),
'We are curating the HSK{n} deck from the textbook — stay tuned.': ('我们正在根据教材策展 HSK{n} 字卡，敬请期待。','Estamos curando el mazo HSK{n} según el libro de texto: atento.','Мы собираем колоду HSK{n} по учебнику — следите за обновлениями.','Chúng tôi đang tuyển chọn bộ thẻ HSK{n} theo giáo trình — hãy chờ nhé.','Kami sedang menyusun dek HSK{n} dari buku teks — nantikan.','เรากำลังคัดชุดบัตรคำ HSK{n} จากตำราเรียน — รอติดตามได้เลย'),
'🎤 Read & score': ('🎤 跟读打分','🎤 Leer y puntuar','🎤 Читать и оценивать','🎤 Đọc và chấm điểm','🎤 Baca & nilai','🎤 อ่านและให้คะแนน'),
'No sound captured. Try again.': ('没录到声音，再试一次。','No se captó sonido. Inténtalo de nuevo.','Звук не записан. Попробуйте ещё раз.','Chưa ghi được âm thanh. Thử lại nhé.','Tidak ada suara terekam. Coba lagi.','ไม่มีเสียงถูกบันทึก ลองอีกครั้ง'),
'could not hear that': ('没听清','no se escuchó bien','не удалось расслышать','chưa nghe rõ','tidak terdengar jelas','ไม่ได้ยินชัด'),
'Recording error. Try again.': ('录音出错，再试一次。','Error de grabación. Inténtalo de nuevo.','Ошибка записи. Попробуйте ещё раз.','Lỗi ghi âm. Thử lại nhé.','Galat perekaman. Coba lagi.','การอัดเสียงผิดพลาด ลองอีกครั้ง'),
'🎤 Microphone blocked.': ('🎤 麦克风被挡住了。','🎤 Micrófono bloqueado.','🎤 Микрофон заблокирован.','🎤 Micrô bị chặn.','🎤 Mikrofon diblokir.','🎤 ไมโครโฟนถูกบล็อก'),
'Trying another voice source…': ('正在换一个发音源…','Probando otra fuente de voz…','Пробуем другой источник голоса…','Đang thử nguồn giọng đọc khác…','Mencoba sumber suara lain…','กำลังลองแหล่งเสียงอื่น…'),
'Could not open the microphone: ': ('无法打开麦克风：','No se pudo abrir el micrófono: ','Не удалось открыть микрофон: ','Không mở được micrô: ','Tidak bisa membuka mikrofon: ','เปิดไมโครโฟนไม่ได้: '),
'WeChat blocks microphone access. Tap <b>···</b> (top-right) → <b>Open in Browser</b>, then allow the microphone.': ('微信内打不开麦克风。点 <b>···</b>（右上角）→ <b>在浏览器打开</b>，再允许麦克风。','WeChat bloquea el micrófono. Toca <b>···</b> (arriba a la derecha) → <b>Abrir en el navegador</b> y permite el micrófono.','WeChat блокирует микрофон. Нажмите <b>···</b> (вверху справа) → <b>Открыть в браузере</b> и разрешите микрофон.','WeChat chặn micrô. Chạm <b>···</b> (góc trên phải) → <b>Mở bằng trình duyệt</b>, rồi cho phép micrô.','WeChat memblokir mikrofon. Ketuk <b>···</b> (kanan atas) → <b>Buka di Browser</b>, lalu izinkan mikrofon.','WeChat บล็อกไมโครโฟน แตะ <b>···</b> (ขวาบน) → <b>เปิดในเบราว์เซอร์</b> แล้วอนุญาตไมโครโฟน'),
'iPhone: <b>Settings → Safari → Microphone → Allow</b>. Or in Safari tap <b>aA</b> (address bar) → <b>Website Settings → Microphone → Allow</b>.': ('iPhone：<b>设置 → Safari → 麦克风 → 允许</b>。或在 Safari 点 <b>aA</b>（地址栏）→ <b>网站设置 → 麦克风 → 允许</b>。','iPhone: <b>Ajustes → Safari → Micrófono → Permitir</b>. O en Safari toca <b>aA</b> (barra de direcciones) → <b>Ajustes del sitio → Micrófono → Permitir</b>.','iPhone: <b>Настройки → Safari → Микрофон → Разрешить</b>. Или в Safari нажмите <b>aA</b> (адресная строка) → <b>Настройки сайта → Микрофон → Разрешить</b>.','iPhone: <b>Cài đặt → Safari → Micrô → Cho phép</b>. Hoặc trong Safari chạm <b>aA</b> (thanh địa chỉ) → <b>Cài đặt trang web → Micrô → Cho phép</b>.','iPhone: <b>Setelan → Safari → Mikrofon → Izinkan</b>. Atau di Safari ketuk <b>aA</b> (bilah alamat) → <b>Pengaturan Situs → Mikrofon → Izinkan</b>.','iPhone: <b>การตั้งค่า → Safari → ไมโครโฟน → อนุญาต</b> หรือใน Safari แตะ <b>aA</b> (แถบที่อยู่) → <b>การตั้งค่าเว็บไซต์ → ไมโครโฟน → อนุญาต</b>'),
'Tap the <b>🔒 lock icon</b> in the address bar → <b>Site settings → Microphone → Allow</b>, then reload.': ('点地址栏的 <b>🔒 锁图标</b> → <b>网站设置 → 麦克风 → 允许</b>，然后刷新。','Toca el <b>🔒 candado</b> en la barra de direcciones → <b>Ajustes del sitio → Micrófono → Permitir</b> y recarga.','Нажмите <b>🔒 значок замка</b> в адресной строке → <b>Настройки сайта → Микрофон → Разрешить</b>, затем перезагрузите.','Chạm <b>🔒 biểu tượng khoá</b> trên thanh địa chỉ → <b>Cài đặt trang web → Micrô → Cho phép</b>, rồi tải lại.','Ketuk <b>🔒 ikon gembok</b> di bilah alamat → <b>Pengaturan Situs → Mikrofon → Izinkan</b>, lalu muat ulang.','แตะ <b>🔒 ไอคอนแม่กุญแจ</b> บนแถบที่อยู่ → <b>การตั้งค่าเว็บไซต์ → ไมโครโฟน → อนุญาต</b> แล้วรีโหลด'),
'Tap ··· → Open in Browser, then allow the microphone.': ('点 ··· → 在浏览器打开，再允许麦克风。','Toca ··· → Abrir en el navegador y permite el micrófono.','Нажмите ··· → Открыть в браузере и разрешите микрофон.','Chạm ··· → Mở bằng trình duyệt, rồi cho phép micrô.','Ketuk ··· → Buka di Browser, lalu izinkan mikrofon.','แตะ ··· → เปิดในเบราว์เซอร์ แล้วอนุญาตไมโครโฟน'),
'Settings → Safari → Microphone → Allow': ('设置 → Safari → 麦克风 → 允许','Ajustes → Safari → Micrófono → Permitir','Настройки → Safari → Микрофон → Разрешить','Cài đặt → Safari → Micrô → Cho phép','Setelan → Safari → Mikrofon → Izinkan','การตั้งค่า → Safari → ไมโครโฟน → อนุญาต'),
'Tap the 🔒 lock → Site settings → Microphone → Allow, then reload.': ('点 🔒 锁 → 网站设置 → 麦克风 → 允许，然后刷新。','Toca el 🔒 candado → Ajustes del sitio → Micrófono → Permitir y recarga.','Нажмите 🔒 замок → Настройки сайта → Микрофон → Разрешить, затем перезагрузите.','Chạm 🔒 khoá → Cài đặt trang web → Micrô → Cho phép, rồi tải lại.','Ketuk 🔒 gembok → Pengaturan Situs → Mikrofon → Izinkan, lalu muat ulang.','แตะ 🔒 แม่กุญแจ → การตั้งค่าเว็บไซต์ → ไมโครโฟน → อนุญาต แล้วรีโหลด'),
'Could not load the card deck.<br>Reconnect and reopen the app to try again.': ('字卡加载失败。<br>恢复网络后重开应用再试。','No se pudo cargar el mazo de tarjetas.<br>Reconéctate y vuelve a abrir la app para reintentar.','Не удалось загрузить колоду карточек.<br>Восстановите соединение и снова откройте приложение.','Không tải được bộ thẻ.<br>Kết nối lại và mở lại app để thử lần nữa.','Tidak bisa memuat dek kartu.<br>Sambungkan ulang dan buka lagi aplikasinya untuk mencoba.','โหลดชุดบัตรคำไม่สำเร็จ<br>เชื่อมต่อใหม่แล้วเปิดแอปอีกครั้งเพื่อลองใหม่'),
'No saved characters yet.<br>Tap “☆ Save” on a card to keep it here.': ('还没有收藏的字。<br>在字卡上点「☆ 收藏」就会存到这里。','Aún no hay caracteres guardados.<br>Toca «☆ Guardar» en una tarjeta para conservarla aquí.','Пока нет сохранённых иероглифов.<br>Нажмите «☆ Сохранить» на карточке, чтобы сохранить её здесь.','Chưa có chữ nào được lưu.<br>Chạm «☆ Lưu» trên thẻ để giữ lại ở đây.','Belum ada karakter yang disimpan.<br>Ketuk «☆ Simpan» pada kartu untuk menyimpannya di sini.','ยังไม่มีตัวอักษรที่บันทึกไว้<br>แตะ «☆ บันทึก» บนบัตรคำเพื่อเก็บไว้ที่นี่'),
'Could not load sentence templates.': ('句型模板加载失败。','No se pudieron cargar las plantillas de frases.','Не удалось загрузить шаблоны фраз.','Không tải được mẫu câu.','Tidak bisa memuat templat kalimat.','โหลดแม่แบบประโยคไม่สำเร็จ'),
'Pick a mode and complete a prompt to start tracking.': ('选一个模式并完成提示句，就会开始记录。','Elige un modo y completa una consigna para empezar a registrar.','Выберите режим и выполните задание — начнётся учёт.','Chọn một chế độ và hoàn thành gợi ý để bắt đầu ghi nhận.','Pilih mode dan selesaikan prompt untuk mulai mencatat.','เลือกโหมดและทำโจทย์ให้เสร็จเพื่อเริ่มบันทึก'),
'Loading sentence templates…': ('句型模板加载中…','Cargando plantillas de frases…','Загружаем шаблоны фраз…','Đang tải mẫu câu…','Memuat templat kalimat…','กำลังโหลดแม่แบบประโยค…'),
'No templates for this mode.': ('这个模式暂时没有模板。','No hay plantillas para este modo.','Для этого режима нет шаблонов.','Chưa có mẫu cho chế độ này.','Belum ada templat untuk mode ini.','ยังไม่มีแม่แบบสำหรับโหมดนี้'),
'In English, what did you want to say? e.g. "ask the taxi driver to wait 5 minutes"': ('用英文写下你想说的话，例如「请司机等 5 分钟」','En inglés, ¿qué querías decir? p. ej. «pedirle al taxista que espere 5 minutos»','На английском: что вы хотели сказать? напр. «попросить таксиста подождать 5 минут»','Bằng tiếng Anh, bạn muốn nói gì? vd «nhờ tài xế chờ 5 phút»','Dalam bahasa Inggris, apa yang ingin kamu katakan? mis. «minta sopir taksi menunggu 5 menit»','เขียนเป็นภาษาอังกฤษว่าคุณอยากพูดอะไร เช่น «ขอให้แท็กซี่รอ 5 นาที»'),
'e.g. The Score button stays on Listening… and never gives a result.': ('例如：打分按钮一直停在 Listening…，永远不出结果。','p. ej. El botón de puntuación se queda en Listening… y nunca da un resultado.','напр. Кнопка оценки остаётся на Listening… и результат так и не появляется.','vd Nút Chấm điểm cứ đứng ở Listening… và không bao giờ ra kết quả.','mis. Tombol Nilai macet di Listening… dan tidak pernah memberi hasil.','เช่น ปุ่มให้คะแนนค้างที่ Listening… และไม่เคยให้ผลลัพธ์'),
'Practise with Nono': ('和诺诺练','Practicar con Nono','Потренироваться с Ноно','Luyện với Nono','Latihan dengan Nono','ฝึกกับโหน่น'),
'Practise this line with Nono': ('和诺诺练这一句','Practicar esta frase con Nono','Прорепетировать эту фразу с Ноно','Luyện câu này với Nono','Latihan kalimat ini dengan Nono','ฝึกประโยคนี้กับโหน่น'),
'✓ Done': ('✓ 说过了','✓ Hecho','✓ Готово','✓ Đã nói','✓ Selesai','✓ พูดแล้ว'),
'I said it 3×': ('我说了 3 遍','La dije 3 veces','Я сказал(а) 3 раза','Tôi đã nói 3 lần','Aku sudah mengucapkannya 3×','ฉันพูดแล้ว 3 ครั้ง'),
}

idx = io.open(os.path.normpath(os.path.join(HERE, '..', '..', 'index.html')), encoding='utf-8').read()
dicts = {}
for l in LANGS:
    p = os.path.join(BASE, l + '.json')
    raw = io.open(p, encoding='utf-8', newline='').read()
    dicts[l] = (raw, json.loads(raw))

crlf = '\r\n' in dicts['zh'][0]
added = {l: 0 for l in LANGS}
rows = []
for k, vals in M.items():
    if k not in idx:
        rows.append('WARN key not in index.html: ' + repr(k[:60]))
    for l, v in zip(LANGS, vals):
        if l == 'zh':
            pass  # zh 值必须对
        if k not in dicts[l][1]:
            dicts[l][1][k] = v
            added[l] += 1

for l in LANGS:
    raw, d = dicts[l]
    out = json.dumps(d, ensure_ascii=False, indent=1)
    if not out.endswith('\n'):
        out += '\n'
    if crlf:
        out = out.replace('\n', '\r\n')
    # 字符集断言
    if l == 'ru' and not any('\u0400' <= c <= '\u04FF' for c in out):
        sys.exit('ru 缺西里尔，中止')
    if l == 'th' and not any('\u0E00' <= c <= '\u0E7F' for c in out):
        sys.exit('th 缺泰文，中止')
    io.open(os.path.join(BASE, l + '.json'), 'w', encoding='utf-8', newline='').write(out)

# 校验：所有语言 key 数一致
counts = {l: len(dicts[l][1]) for l in LANGS}
print('added per lang:', added)
print('counts:', counts)
if len(set(counts.values())) != 1:
    sys.exit('各语言 key 数不一致，中止')
for r in rows: print(r)
print('OK')
