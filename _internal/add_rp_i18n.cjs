#!/usr/bin/env node
/* v0.27.0 一次性开发脚本：为 M3 场景教练（Roleplay）新增文案补齐 6 语言。
   用法：node _internal/add_rp_i18n.cjs
   规则：已存在的 key 一律**跳过不覆盖**（保护既有译文）；只写新 key。
   注意：任务名 / 角色名 / setup 这三类走的是「变量传 T()」（T(t.name)），
         i18n 闸门静态扫描抓不到 —— 必须靠本脚本手工补，漏了界面就露英文。
   不进 web 构建（build-web.mjs 只拷白名单目录）。 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'langs');

const ADD = {
  /* ---- 入口卡 / 面板 ---- */
  'Scenario coach': {
    zh:'场景教练', es:'Entrenador de escenarios', ru:'Тренер сцен',
    vi:'Huấn luyện viên tình huống', id:'Pelatih skenario', th:'โค้ชสถานการณ์'
  },
  'Act it out — you speak your part, Sinoky plays the local.': {
    zh:'演出来 —— 你说你的台词，Sinoky 扮演本地人。',
    es:'Actúalo: tú dices tu parte, Sinoky hace de local.',
    ru:'Разыграйте сцену — вы говорите свою реплику, Sinoky играет местного.',
    vi:'Nhập vai đi — bạn nói phần của mình, Sinoky đóng vai người bản địa.',
    id:'Mainkan perannya — kamu bicara bagianmu, Sinoky berperan sebagai orang lokal.',
    th:'เล่นบทเลย — คุณพูดบทของคุณ Sinoky รับบทเป็นคนท้องถิ่น'
  },
  /* ---- 回合 ---- */
  'Your turn': {
    zh:'轮到你说', es:'Tu turno', ru:'Ваш ход',
    vi:'Đến lượt bạn', id:'Giliranmu', th:'ตาของคุณ'
  },
  'Show me': {
    zh:'给我看看', es:'Muéstrame', ru:'Покажите',
    vi:'Cho tôi xem', id:'Tunjukkan', th:'ขอดูหน่อย'
  },
  'Not quite — say it another way.': {
    zh:'还差一点 —— 换个说法再试试。',
    es:'Casi: dilo de otra manera.',
    ru:'Почти — скажите иначе.',
    vi:'Chưa đúng — nói cách khác xem.',
    id:'Belum tepat — coba dengan cara lain.',
    th:'ยังไม่ใช่ — ลองพูดอีกแบบ'
  },
  'That works!': {
    zh:'意思到了！', es:'¡Te hiciste entender!', ru:'Вас поняли!',
    vi:'Hiểu rồi!', id:'Berhasil!', th:'สื่อสารได้แล้ว!'
  },
  /* ---- 结算 ---- */
  'You got your point across {a} of {b} times.': {
    zh:'{b} 轮里有 {a} 轮把意思说清楚了。',
    es:'Te hiciste entender en {a} de {b} turnos.',
    ru:'Вас поняли в {a} из {b} реплик.',
    vi:'Bạn nói rõ được ý trong {a}/{b} lượt.',
    id:'Kamu berhasil menyampaikan maksud di {a} dari {b} giliran.',
    th:'คุณสื่อสารได้สำเร็จ {a} จาก {b} รอบ'
  },
  'Scene cleared!': {
    zh:'场景通关！', es:'¡Escenario superado!', ru:'Сцена пройдена!',
    vi:'Đã phá đảo tình huống!', id:'Skenario tuntas!', th:'ผ่านฉากแล้ว!'
  },
  'Play it again': {
    zh:'再演一遍', es:'Repetir', ru:'Ещё раз',
    vi:'Chơi lại', id:'Main lagi', th:'เล่นอีกครั้ง'
  },
  'That scene is missing a line — try another one.': {
    zh:'这个场景缺一句台词 —— 换一个试试。',
    es:'A este escenario le falta una frase: prueba otro.',
    ru:'В этой сцене не хватает реплики — попробуйте другую.',
    vi:'Tình huống này thiếu một câu — thử cái khác nhé.',
    id:'Skenario ini kehilangan satu kalimat — coba yang lain.',
    th:'ฉากนี้ขาดประโยคหนึ่ง — ลองฉากอื่นดู'
  },
  /* ---- 6 个任务名 ---- */
  'Ordering food': {
    zh:'点餐', es:'Pedir comida', ru:'Заказ еды',
    vi:'Gọi món', id:'Pesan makanan', th:'สั่งอาหาร'
  },
  'Asking for directions': {
    zh:'问路', es:'Preguntar el camino', ru:'Как пройти',
    vi:'Hỏi đường', id:'Tanya arah', th:'ถามทาง'
  },
  'Bargaining': {
    zh:'砍价', es:'Regatear', ru:'Торговаться',
    vi:'Mặc cả', id:'Menawar harga', th:'ต่อราคา'
  },
  'Taking a taxi': {
    zh:'打车', es:'Tomar un taxi', ru:'Поездка на такси',
    vi:'Bắt taxi', id:'Naik taksi', th:'ขึ้นแท็กซี่'
  },
  'Hotel check-in': {
    zh:'酒店入住', es:'Registro en el hotel', ru:'Заселение в отель',
    vi:'Nhận phòng khách sạn', id:'Check-in hotel', th:'เช็คอินโรงแรม'
  },
  'Asking for help': {
    zh:'求助', es:'Pedir ayuda', ru:'Просьба о помощи',
    vi:'Nhờ giúp đỡ', id:'Minta bantuan', th:'ขอความช่วยเหลือ'
  },
  /* ---- 对方角色 ---- */
  'a waiter': {
    zh:'服务员', es:'un camarero', ru:'официант',
    vi:'một người phục vụ', id:'seorang pelayan', th:'พนักงานเสิร์ฟ'
  },
  'a passer-by': {
    zh:'路人', es:'un transeúnte', ru:'прохожий',
    vi:'một người đi đường', id:'seorang pejalan kaki', th:'คนเดินผ่าน'
  },
  'a market vendor': {
    zh:'摊主', es:'un vendedor del mercado', ru:'продавец на рынке',
    vi:'một người bán hàng rong', id:'seorang pedagang pasar', th:'แม่ค้าในตลาด'
  },
  'a taxi driver': {
    zh:'出租车司机', es:'un taxista', ru:'таксист',
    vi:'một tài xế taxi', id:'seorang sopir taksi', th:'คนขับแท็กซี่'
  },
  'a receptionist': {
    zh:'前台', es:'un recepcionista', ru:'администратор',
    vi:'một lễ tân', id:'seorang resepsionis', th:'พนักงานต้อนรับ'
  },
  'a neighbour': {
    zh:'邻居', es:'un vecino', ru:'сосед',
    vi:'một người hàng xóm', id:'seorang tetangga', th:'เพื่อนบ้าน'
  },
  /* ---- 6 段开场情境 ---- */
  'You walk into a small noodle shop. The waiter comes over.': {
    zh:'你走进一家小面馆，服务员过来招呼你。',
    es:'Entras en un pequeño restaurante de fideos. Se acerca el camarero.',
    ru:'Вы заходите в маленькую лапшичную. Подходит официант.',
    vi:'Bạn bước vào một quán mì nhỏ. Người phục vụ lại gần.',
    id:'Kamu masuk ke kedai mie kecil. Pelayan menghampiri.',
    th:'คุณเดินเข้าไปในร้านก๋วยเตี๋ยวเล็ก ๆ พนักงานเดินเข้ามา'
  },
  'You are lost near the metro station. You stop a passer-by to ask the way.': {
    zh:'你在地铁站附近迷路了，拦住一位路人问路。',
    es:'Estás perdido cerca del metro. Paras a un transeúnte para preguntar.',
    ru:'Вы заблудились у метро. Останавливаете прохожего, чтобы спросить дорогу.',
    vi:'Bạn lạc đường gần ga tàu điện. Bạn chặn một người đi đường để hỏi.',
    id:'Kamu tersesat di dekat stasiun MRT. Kamu menghentikan pejalan kaki untuk bertanya.',
    th:'คุณหลงทางแถวสถานีรถไฟใต้ดิน จึงถามทางคนเดินผ่าน'
  },
  'You are at a street market. The vendor names a price first — talk it down.': {
    zh:'你在街边市场，摊主先开了价 —— 把价格谈下来。',
    es:'Estás en un mercado callejero. El vendedor dice un precio: regatéalo.',
    ru:'Вы на уличном рынке. Продавец называет цену — сбейте её.',
    vi:'Bạn đang ở chợ đường phố. Người bán ra giá trước — hãy mặc cả.',
    id:'Kamu di pasar jalanan. Pedagang menyebut harga dulu — tawar lah.',
    th:'คุณอยู่ที่ตลาดนัด แม่ค้าเปิดราคาก่อน — ต่อราคาลง'
  },
  'You get in a taxi. The driver needs to know where to go — tell him in Chinese.': {
    zh:'你上了一辆出租车，司机要知道去哪儿 —— 用中文告诉他。',
    es:'Subes a un taxi. El conductor necesita saber adónde ir: díselo en chino.',
    ru:'Вы садитесь в такси. Водителю нужно знать, куда ехать — скажите по-китайски.',
    vi:'Bạn lên taxi. Tài xế cần biết đi đâu — hãy nói bằng tiếng Trung.',
    id:'Kamu naik taksi. Sopir perlu tahu tujuannya — katakan dalam bahasa Mandarin.',
    th:'คุณขึ้นแท็กซี่ คนขับต้องรู้ว่าจะไปไหน — บอกเป็นภาษาจีน'
  },
  'You arrive at a small hotel with no booking. The receptionist greets you.': {
    zh:'你到一家小旅馆，没有预订，前台跟你打招呼。',
    es:'Llegas a un hotel pequeño sin reserva. Te saluda el recepcionista.',
    ru:'Вы приезжаете в маленький отель без брони. Администратор вас приветствует.',
    vi:'Bạn đến một khách sạn nhỏ mà chưa đặt phòng. Lễ tân chào bạn.',
    id:'Kamu tiba di hotel kecil tanpa reservasi. Resepsionis menyapamu.',
    th:'คุณมาถึงโรงแรมเล็ก ๆ โดยไม่ได้จอง พนักงานต้อนรับทักทายคุณ'
  },
  'Something has gone wrong and you need a local to help you. Explain it in Chinese.': {
    zh:'出了点状况，你需要本地人帮忙 —— 用中文说明情况。',
    es:'Algo ha salido mal y necesitas ayuda de un local. Explícalo en chino.',
    ru:'Что-то случилось, и вам нужна помощь местного. Объясните по-китайски.',
    vi:'Có chuyện không ổn và bạn cần người bản địa giúp. Hãy giải thích bằng tiếng Trung.',
    id:'Ada masalah dan kamu butuh bantuan orang lokal. Jelaskan dalam bahasa Mandarin.',
    th:'เกิดเรื่องไม่คาดคิดและคุณต้องการให้คนท้องถิ่นช่วย — อธิบายเป็นภาษาจีน'
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
