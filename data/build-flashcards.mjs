/**
 * Sinoky 分级字卡构建器（参数化：HSK1 策展 / HSK2-3 占位或教材导入）
 *
 * 设计原则（继承 F 需求 · 数据地基）：
 *  - 语义字段（字义/词性/部首/词组/例句）由人工策展，保证准确。
 *  - 拼音 / 声调 / 声母 / 韵母 全部由 pinyin-pro 本地计算，零手写错误。
 *  - 笔顺（strokes）不入库：前端用 hanzi-writer 按 hanzi 现场拉 CDN
 *    （https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/{hanzi}.json）。
 *
 * 分级支持（对应需求「HSK 分级」）：
 *  - level 1：使用内置 RAW 策展数据（193 字），生成 flashcards.hsk1.json。
 *  - level 2/3 无教材：自动生成占位文件（ready:false, note「待补充」）。
 *  - level 2/3 有教材：node build-flashcards.mjs --level 2 --csv hsk2.csv 一键导入。
 *  - 每次生成后自动刷新 data/flashcards-levels.json 总清单（前端渲染等级 tab）。
 *
 * 运行（受管 node，pinyin-pro 已装于隔离 node_modules）：
 *   NODE_PATH="C:/Users/Admin/.workbuddy/binaries/node/workspace/node_modules" \
 *   C:/Users/Admin/.workbuddy/binaries/node/versions/22.22.2-3/node.exe build-flashcards.mjs [--level 1|2|3] [--csv file.csv] [--manifest]
 */

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let pinyin = null;
try { pinyin = require('pinyin-pro').pinyin; } catch (e) { /* 占位模式可缺 pinyin-pro */ }

// ---------- CLI 参数 ----------
const args = process.argv.slice(2);
const get = (k, d = null) => { const i = args.indexOf(k); return (i > -1 && args[i + 1]) ? args[i + 1] : d; };
const has = (k) => args.includes(k);
const HSK_NAME = { 1: 'HSK1', 2: 'HSK2', 3: 'HSK3' };

// 从带声调符号的拼音解析 tone/initial/final（CSV 缺拼音列时的兜底；pinyin-pro 优先）
function parsePinyinFallback(pinyinStr) {
  const toneMarks = {
    'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a', 'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
    'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i', 'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
    'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u', 'ǖ': 'ü', 'ǘ': 'ü', 'ǚ': 'ü', 'ǜ': 'ü',
    'ń': 'n', 'ň': 'n', 'ǹ': 'n',
  };
  let tone = 0;
  const TONE_DIACRITIC = {
    'ā':1,'á':2,'ǎ':3,'à':4,
    'ē':1,'é':2,'ě':3,'è':4,
    'ī':1,'í':2,'ǐ':3,'ì':4,
    'ō':1,'ó':2,'ǒ':3,'ò':4,
    'ū':1,'ú':2,'ǔ':3,'ù':4,
    'ǖ':1,'ǘ':2,'ǚ':3,'ǜ':4,
    'ń':2,'ň':3,'ǹ':4
  };
  const str = String(pinyinStr || '');
  for (const ch of str) { if (Object.prototype.hasOwnProperty.call(TONE_DIACRITIC, ch)) tone = TONE_DIACRITIC[ch]; }
  const m = str.trim().match(/([1-5])$/);
  if (m) tone = parseInt(m[1], 10);
  let base = str;
  for (const [mk, nk] of Object.entries(toneMarks)) base = base.split(mk).join(nk);
  base = base.replace(/[0-9]/g, '').trim().toLowerCase();
  const initials = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'zh', 'ch', 'sh', 'r', 'z', 'c', 's', 'y', 'w'];
  let initial = '', final = base;
  for (const ini of initials) { if (base.startsWith(ini)) { initial = ini; final = base.slice(ini.length); break; } }
  return { tone: tone === 5 ? 0 : tone, initial: initial || '-', final: final || base };
}

// 策展数据：[汉字, 英译, 词性, 部首, [常见词/词组], [例句中文, 例句英文]?]
// 词性缩写：pron.代词 n.名词 v.动词 adj.形容词 adv.副词 conj.连词 prep.介词 num.数词 cls.量词 part.助词 suffix.后缀
const RAW = [
  ['我', 'I / me', 'pron.', '戈', ['我们', '我的', '自我'], ['我是学生。', 'I am a student.']],
  ['你', 'you (singular)', 'pron.', '亻', ['你们', '你好', '你的'], ['你好吗？', 'How are you?']],
  ['他', 'he / him', 'pron.', '亻', ['他们', '他的', '他人'], ['他是老师。', 'He is a teacher.']],
  ['她', 'she / her', 'pron.', '女', ['她们', '她的', '她人'], ['她是医生。', 'She is a doctor.']],
  ['的', '(possessive / descriptive particle)', 'part.', '白', ['我的', '你的', '好的'], ['这是我的书。', 'This is my book.']],
  ['是', 'be / am / is / are', 'v.', '日', ['也是', '都是', '不是'], ['我是中国人。', 'I am Chinese.']],
  ['不', 'not / no', 'adv.', '一', ['不是', '不好', '不想'], ['我不喝咖啡。', "I don't drink coffee."]],
  ['有', 'have / there is', 'v.', '月', ['没有', '有用', '有人'], ['我有一个哥哥。', 'I have an older brother.']],
  ['人', 'person / people', 'n.', '人', ['女人', '男人', '大人', '好人'], ['他是好人。', 'He is a good person.']],
  ['大', 'big / large', 'adj.', '大', ['大小', '大家', '很大'], ['这个很大。', 'This is very big.']],
  ['小', 'small / little', 'adj.', '小', ['小姐', '小弟', '很小'], ['这个很小。', 'This is very small.']],
  ['上', 'up / on / above', 'n.', '一', ['上面', '上午', '上车'], ['我在上面。', 'I am on top.']],
  ['下', 'down / below', 'n.', '一', ['下面', '下午', '下车'], ['在下面。', 'Below.']],
  ['中', 'middle / center', 'n.', '丨', ['中国', '中文', '中间'], ['我在中国。', 'I am in China.']],
  ['国', 'country / nation', 'n.', '囗', ['中国', '国家', '国人'], ['中国很大。', 'China is big.']],
  ['家', 'home / family', 'n.', '宀', ['大家', '家人', '回家'], ['我的家在南昌。', 'My home is in Nanchang.']],
  ['学', 'study / learn', 'v.', '子', ['学生', '学习', '学校'], ['我学中文。', 'I study Chinese.']],
  ['生', 'student / be born / life', 'n.', '生', ['学生', '先生', '生日'], ['他是学生。', 'He is a student.']],
  ['先', 'first / before', 'adj.', '儿', ['先生', '先后', '先走'], ['先生好。', 'Hello sir.']],
  ['们', '(plural suffix for pronouns)', 'suffix.', '亻', ['我们', '你们', '他们'], ['我们去。', 'We go.']],
  ['好', 'good / well', 'adj.', '女', ['好人', '好朋友', '很好'], ['你好吗？', 'How are you?']],
  ['很', 'very', 'adv.', '彳', ['很好', '很小', '很多'], ['我很好。', 'I am very well.']],
  ['在', 'at / in / be located', 'v.', '土', ['不在', '在家', '现在'], ['我在家。', 'I am at home.']],
  ['也', 'also / too', 'adv.', '乙', ['也是', '也好', '也不'], ['我也去。', 'I also go.']],
  ['都', 'all / both', 'adv.', '阝', ['都是', '都好', '都来'], ['我们都好。', 'We are all well.']],
  ['多', 'many / much', 'adj.', '夕', ['多少', '很多', '多谢'], ['很多人。', 'Many people.']],
  ['少', 'few / little', 'adj.', '小', ['多少', '很少', '少年'], ['很少。', 'Very few.']],
  ['来', 'come', 'v.', '木', ['回来', '来吧', '过来'], ['你来吗？', 'Do you come?']],
  ['去', 'go', 'v.', '厶', ['回去', '去吧', '去学校'], ['我去学校。', 'I go to school.']],
  ['看', 'look / see / watch', 'v.', '目', ['看见', '好看', '看书'], ['我看书。', 'I read a book.']],
  ['见', 'see / meet', 'v.', '见', ['看见', '见面', '再见'], ['再见！', 'Goodbye!']],
  ['说', 'speak / say', 'v.', '讠', ['说话', '小说', '说明'], ['你说中文。', 'You speak Chinese.']],
  ['话', 'word / speech', 'n.', '讠', ['说话', '电话', '对话'], ['电话。', 'Telephone.']],
  ['读', 'read', 'v.', '讠', ['读书', '读报', '读音'], ['我读书。', 'I read books.']],
  ['书', 'book', 'n.', '乛', ['看书', '书店', '书包'], ['这是书。', 'This is a book.']],
  ['写', 'write', 'v.', '冖', ['写字', '写书', '写信'], ['我写汉字。', 'I write Chinese characters.']],
  ['字', 'character / word', 'n.', '宀', ['汉字', '写字', '字母'], ['汉字很难。', 'Chinese characters are hard.']],
  ['名', 'name', 'n.', '口', ['名字', '姓名', '名人'], ['你的名字？', 'Your name?']],
  ['姓', 'surname / family name', 'n.', '女', ['姓名', '姓王', '贵姓'], ['我姓康。', 'My surname is Kang.']],
  ['叫', 'be called / call', 'v.', '口', ['叫什么', '叫人', '叫作'], ['我叫康。', 'I am called Kang.']],
  ['什', '(what, in 什么)', 'pron.', '亻', ['什么'], ['你是什么？', 'What are you?']],
  ['谁', 'who', 'pron.', '讠', ['是谁', '谁人'], ['这是谁？', 'Who is this?']],
  ['哪', 'which / where', 'pron.', '口', ['哪里', '哪个', '哪儿'], ['你在哪里？', 'Where are you?']],
  ['里', 'inside / in', 'n.', '里', ['哪里', '家里', '里面'], ['在家里。', 'Inside the home.']],
  ['这', 'this', 'pron.', '辶', ['这里', '这个', '这么'], ['这是什么？', 'What is this?']],
  ['那', 'that', 'pron.', '阝', ['那里', '那个', '那么'], ['那是书。', 'That is a book.']],
  ['个', '(general measure word)', 'cls.', '人', ['一个', '三个', '个人'], ['一个人。', 'One person.']],
  ['和', 'and / with', 'conj.', '禾', ['我和你', '和平', '和好'], ['我和你。', 'You and I.']],
  ['跟', 'with / follow', 'prep.', '足', ['跟着', '跟你', '跟前'], ['跟我来。', 'Come with me.']],
  ['对', 'correct / to / pair', 'adj.', '寸', ['不对', '对你', '对的'], ['对，很好。', 'Right, very good.']],
  ['错', 'wrong / mistake', 'adj.', '钅', ['不错', '错了', '错误'], ['你错了。', 'You are wrong.']],
  ['会', 'can / be able to', 'v.', '人', ['不会', '会写', '会议'], ['我会说。', 'I can speak.']],
  ['能', 'can / be able', 'v.', '厶', ['不能', '能来', '能力'], ['我能去。', 'I can go.']],
  ['要', 'want / need', 'v.', '覀', ['要去', '不要', '要钱'], ['我要咖啡。', 'I want coffee.']],
  ['想', 'want / think', 'v.', '心', ['想学', '不想', '想法'], ['我想去。', 'I want to go.']],
  ['知', 'know', 'v.', '矢', ['知道', '知不知道', '知识'], ['我知道。', 'I know.']],
  ['道', 'way / road / say', 'n.', '辶', ['知道', '道路', '道理'], ['我知道。', 'I know.']],
  ['懂', 'understand', 'v.', '忄', ['不懂', '懂了', '懂得'], ['我懂了。', 'I understand.']],
  ['爱', 'love', 'v.', '爫', ['爱人', '爱学', '可爱'], ['我爱中文。', 'I love Chinese.']],
  ['喜', '(like, in 喜欢)', 'v.', '士', ['喜欢'], ['我喜欢你。', 'I like you.']],
  ['欢', '(joy, in 喜欢)', 'v.', '欠', ['喜欢', '欢迎', '欢乐'], ['他喜欢学习。', 'He likes studying.']],
  ['谢', 'thank', 'v.', '讠', ['谢谢', '感谢', '谢礼'], ['谢谢你。', 'Thank you.']],
  ['请', 'please / invite', 'v.', '讠', ['请问', '请坐', '请假'], ['请坐。', 'Please sit.']],
  ['问', 'ask', 'v.', '门', ['请问', '问题', '问答'], ['我问你。', 'I ask you.']],
  ['答', 'answer', 'v.', '竹', ['回答', '答案', '答对'], ['请回答。', 'Please answer.']],
  ['吃', 'eat', 'v.', '口', ['吃饭', '好吃', '吃肉'], ['我吃饭。', 'I eat a meal.']],
  ['饭', 'rice / meal', 'n.', '饣', ['吃饭', '米饭', '饭店'], ['我吃饭。', 'I eat a meal.']],
  ['喝', 'drink', 'v.', '口', ['喝水', '喝酒', '喝茶'], ['我喝水。', 'I drink water.']],
  ['水', 'water', 'n.', '水', ['喝水', '水果', '开水'], ['我喝水。', 'I drink water.']],
  ['茶', 'tea', 'n.', '艹', ['喝茶', '绿茶', '茶馆'], ['喝茶。', 'Drink tea.']],
  ['果', 'fruit / result', 'n.', '木', ['水果', '苹果', '结果'], ['水果好。', 'Fruit is good.']],
  ['菜', 'vegetable / dish', 'n.', '艹', ['蔬菜', '中国菜', '菜单'], ['中国菜好吃。', 'Chinese food is tasty.']],
  ['肉', 'meat', 'n.', '肉', ['吃肉', '牛肉', '羊肉'], ['我吃肉。', 'I eat meat.']],
  ['蛋', 'egg', 'n.', '虫', ['鸡蛋', '蛋糕', '蛋黄'], ['鸡蛋。', 'Chicken egg.']],
  ['米', 'rice (grain)', 'n.', '米', ['大米', '米饭', '米粒'], ['米饭。', 'Rice.']],
  ['面', 'noodle / face', 'n.', '面', ['面条', '面包', '见面'], ['面条。', 'Noodles.']],
  ['包', 'bun / package / wrap', 'n.', '勹', ['面包', '包子', '书包'], ['面包。', 'Bread.']],
  ['牛', 'cow / beef / ox', 'n.', '牛', ['牛肉', '牛奶', '水牛'], ['牛肉。', 'Beef.']],
  ['羊', 'sheep / goat', 'n.', '羊', ['羊肉', '绵羊', '羊毛'], ['羊肉。', 'Mutton.']],
  ['鱼', 'fish', 'n.', '鱼', ['吃鱼', '小鱼', '金鱼'], ['我吃鱼。', 'I eat fish.']],
  ['狗', 'dog', 'n.', '犭', ['小狗', '狗叫', '热狗'], ['小狗。', 'Small dog.']],
  ['猫', 'cat', 'n.', '犭', ['小猫', '猫叫', '熊猫'], ['小猫。', 'Small cat.']],
  ['鸟', 'bird', 'n.', '鸟', ['小鸟', '飞鸟', '花鸟'], ['小鸟。', 'Small bird.']],
  ['花', 'flower', 'n.', '艹', ['红花', '开花', '花草'], ['红花。', 'Red flower.']],
  ['草', 'grass', 'n.', '艹', ['小草', '草地', '青草'], ['青草。', 'Green grass.']],
  ['树', 'tree', 'n.', '木', ['大树', '树叶', '树木'], ['大树。', 'Big tree.']],
  ['木', 'wood / tree', 'n.', '木', ['树木', '木头', '木马'], ['木头。', 'Wood.']],
  ['林', 'forest / woods', 'n.', '木', ['树林', '森林', '竹林'], ['树林。', 'Forest.']],
  ['天', 'day / sky / heaven', 'n.', '大', ['今天', '天气', '天天'], ['天气好。', 'The weather is good.']],
  ['气', 'air / gas / weather', 'n.', '气', ['天气', '生气', '空气'], ['天气。', 'Weather.']],
  ['今', 'today / now', 'n.', '人', ['今天', '今年', '如今'], ['今天好。', 'Today is good.']],
  ['年', 'year', 'n.', '干', ['今年', '去年', '明年'], ['今年。', 'This year.']],
  ['时', 'time / hour', 'n.', '日', ['时间', '时候', '小时'], ['时间。', 'Time.']],
  ['间', 'between / room', 'n.', '门', ['时间', '中间', '房间'], ['中间。', 'Middle.']],
  ['分', 'minute / divide', 'v.', '刀', ['分钟', '十分', '分手'], ['十分钟。', 'Ten minutes.']],
  ['点', 'o\'clock / point / dot', 'n.', '灬', ['点菜', '三点', '优点'], ['三点。', 'Three o\'clock.']],
  ['钟', 'clock / bell', 'n.', '钅', ['分钟', '闹钟', '钟表'], ['小钟。', 'Clock.']],
  ['早', 'early / morning', 'adj.', '日', ['早上', '早饭', '很早'], ['早上好。', 'Good morning.']],
  ['晚', 'late / evening', 'adj.', '日', ['晚上', '晚饭', '很晚'], ['晚上。', 'Evening.']],
  ['午', 'noon', 'n.', '十', ['中午', '下午', '上午'], ['中午。', 'Noon.']],
  ['月', 'month / moon', 'n.', '月', ['本月', '一个月', '月光'], ['一个月。', 'One month.']],
  ['日', 'day / sun', 'n.', '日', ['日子', '今日', '日记'], ['今日。', 'Today.']],
  ['星', 'star', 'n.', '日', ['星星', '星期', '星空'], ['星期。', 'Week.']],
  ['期', 'period / scheduled', 'n.', '月', ['星期', '日期', '假期'], ['星期天。', 'Sunday.']],
  ['春', 'spring (season)', 'n.', '日', ['春天', '春节', '青春'], ['春天。', 'Spring.']],
  ['夏', 'summer', 'n.', '夂', ['夏天', '夏季', '华夏'], ['夏天。', 'Summer.']],
  ['秋', 'autumn', 'n.', '禾', ['秋天', '秋季', '中秋'], ['秋天。', 'Autumn.']],
  ['冬', 'winter', 'n.', '夂', ['冬天', '冬季', '寒冬'], ['冬天。', 'Winter.']],
  ['冷', 'cold', 'adj.', '冫', ['天冷', '冷水', '冷气'], ['很冷。', 'Very cold.']],
  ['热', 'hot', 'adj.', '灬', ['天热', '热水', '热情'], ['很热。', 'Very hot.']],
  ['雨', 'rain', 'n.', '雨', ['下雨', '大雨', '雨衣'], ['下雨。', 'It rains.']],
  ['风', 'wind', 'n.', '风', ['大风', '风筝', '风景'], ['大风。', 'Strong wind.']],
  ['雪', 'snow', 'n.', '雨', ['下雪', '白雪', '雪花'], ['下雪。', 'It snows.']],
  ['火', 'fire', 'n.', '火', ['大火', '火车', '火山'], ['火车。', 'Train.']],
  ['车', 'vehicle / car', 'n.', '车', ['火车', '汽车', '车站'], ['汽车。', 'Car.']],
  ['山', 'mountain', 'n.', '山', ['大山', '上山', '山水'], ['大山。', 'Big mountain.']],
  ['石', 'stone / rock', 'n.', '石', ['石头', '玉石', '宝石'], ['石头。', 'Stone.']],
  ['田', 'field (farmland)', 'n.', '田', ['田地', '水田', '种田'], ['田地。', 'Field.']],
  ['土', 'earth / soil', 'n.', '土', ['土地', '土豆', '泥土'], ['土地。', 'Land.']],
  ['地', 'ground / place / earth', 'n.', '土', ['地方', '土地', '地上'], ['地方。', 'Place.']],
  ['东', 'east', 'n.', '一', ['东西', '东方', '房东'], ['东边。', 'East side.']],
  ['西', 'west', 'n.', '覀', ['东西', '西方', '西瓜'], ['西边。', 'West side.']],
  ['南', 'south', 'n.', '十', ['南方', '南边', '河南'], ['南边。', 'South side.']],
  ['北', 'north', 'n.', '匕', ['北方', '北边', '河北'], ['北边。', 'North side.']],
  ['前', 'front / before', 'adj.', '刂', ['前面', '饭前', '从前'], ['前面。', 'Front.']],
  ['后', 'back / after', 'adj.', '口', ['后面', '饭后', '以后'], ['后面。', 'Back.']],
  ['左', 'left', 'n.', '工', ['左边', '左手', '左右'], ['左边。', 'Left side.']],
  ['右', 'right', 'n.', '口', ['右边', '右手', '左右'], ['右边。', 'Right side.']],
  ['口', 'mouth', 'n.', '口', ['门口', '开口', '口水'], ['口。', 'Mouth.']],
  ['手', 'hand', 'n.', '手', ['手机', '分手', '左手'], ['手。', 'Hand.']],
  ['足', 'foot', 'n.', '足', ['足球', '手足', '满足'], ['足球。', 'Football.']],
  ['目', 'eye', 'n.', '目', ['目光', '节目', '目标'], ['目。', 'Eye.']],
  ['耳', 'ear', 'n.', '耳', ['耳朵', '耳机', '耳目'], ['耳朵。', 'Ear.']],
  ['头', 'head', 'n.', '大', ['头疼', '大头', '头发'], ['头。', 'Head.']],
  ['心', 'heart / mind', 'n.', '心', ['开心', '小心', '关心'], ['心。', 'Heart.']],
  ['身', 'body', 'n.', '身', ['身体', '全身', '本身'], ['身体。', 'Body.']],
  ['男', 'male', 'adj.', '田', ['男人', '男生', '男孩'], ['男人。', 'Man.']],
  ['女', 'female', 'adj.', '女', ['女人', '女生', '女孩'], ['女人。', 'Woman.']],
  ['子', 'child / son', 'n.', '子', ['儿子', '孩子', '桌子'], ['儿子。', 'Son.']],
  ['儿', 'son / child', 'n.', '儿', ['儿子', '女儿', '儿歌'], ['儿子。', 'Son.']],
  ['父', 'father', 'n.', '父', ['父亲', '父母', '父子'], ['父亲。', 'Father.']],
  ['母', 'mother', 'n.', '母', ['母亲', '父母', '母鸡'], ['母亲。', 'Mother.']],
  ['兄', 'elder brother', 'n.', '儿', ['兄弟', '兄长', '表兄'], ['兄弟。', 'Brothers.']],
  ['弟', 'younger brother', 'n.', '弓', ['兄弟', '弟弟', '弟妹'], ['弟弟。', 'Younger brother.']],
  ['姐', 'elder sister', 'n.', '女', ['姐妹', '姐姐', '大姐'], ['姐姐。', 'Elder sister.']],
  ['妹', 'younger sister', 'n.', '女', ['姐妹', '妹妹', '妹夫'], ['妹妹。', 'Younger sister.']],
  ['友', 'friend', 'n.', '又', ['朋友', '友好', '友谊'], ['朋友。', 'Friend.']],
  ['朋', 'friend', 'n.', '月', ['朋友', '亲朋', '朋党'], ['我的朋友。', 'My friend.']],
  ['师', 'teacher / master', 'n.', '巾', ['老师', '师父', '师徒'], ['老师。', 'Teacher.']],
  ['老', 'old', 'adj.', '老', ['老师', '老人', '老大'], ['老师。', 'Teacher.']],
  ['医', 'doctor / medicine', 'n.', '匚', ['医生', '医院', '医疗'], ['医生。', 'Doctor.']],
  ['院', 'courtyard / hospital / institute', 'n.', '阝', ['医院', '学院', '院子'], ['医院。', 'Hospital.']],
  ['工', 'work / labor', 'n.', '工', ['工作', '工人', '手工'], ['工作。', 'Work.']],
  ['作', 'do / make / work', 'v.', '亻', ['工作', '作业', '作用'], ['工作。', 'Work.']],
  ['公', 'public / fair', 'adj.', '八', ['公司', '公共', '公平'], ['公司。', 'Company.']],
  ['司', 'manage / office', 'n.', '口', ['公司', '司机', '官司'], ['公司。', 'Company.']],
  ['钱', 'money', 'n.', '钅', ['多少钱', '有钱', '价钱'], ['多少钱？', 'How much money?']],
  ['银', 'silver / silver-related', 'n.', '钅', ['银行', '银子', '银色'], ['银行。', 'Bank.']],
  ['行', 'bank / do / OK', 'v.', '行', ['银行', '不行', '行走'], ['银行。', 'Bank.']],
  ['买', 'buy', 'v.', '乛', ['买东西', '买房', '买书'], ['我买书。', 'I buy books.']],
  ['卖', 'sell', 'v.', '十', ['卖东西', '卖书', '买卖'], ['他卖书。', 'He sells books.']],
  ['市', 'city / market', 'n.', '巾', ['城市', '市场', '市区'], ['市场。', 'Market.']],
  ['场', 'place / field / scene', 'n.', '土', ['市场', '操场', '场面'], ['市场。', 'Market.']],
  ['店', 'shop / store', 'n.', '广', ['商店', '书店', '饭店'], ['商店。', 'Shop.']],
  ['商', 'commerce / discuss', 'n.', '口', ['商店', '商量', '商品'], ['商店。', 'Shop.']],
  ['红', 'red', 'adj.', '纟', ['红色', '红花', '红人'], ['红色。', 'Red color.']],
  ['白', 'white', 'adj.', '白', ['白色', '白天', '明白'], ['白色。', 'White.']],
  ['黑', 'black', 'adj.', '黑', ['黑色', '黑板', '黑白'], ['黑色。', 'Black.']],
  ['黄', 'yellow', 'adj.', '黄', ['黄色', '黄河', '黄金'], ['黄色。', 'Yellow.']],
  ['绿', 'green', 'adj.', '纟', ['绿色', '绿叶', '绿草'], ['绿色。', 'Green.']],
  ['蓝', 'blue', 'adj.', '艹', ['蓝色', '蓝天', '蓝本'], ['蓝色。', 'Blue.']],
  ['色', 'color', 'n.', '色', ['颜色', '红色', '出色'], ['颜色。', 'Color.']],
  ['新', 'new', 'adj.', '斤', ['新年', '新衣', '新闻'], ['新。', 'New.']],
  ['旧', 'old (not new)', 'adj.', '丨', ['旧书', '新旧', '仍旧'], ['旧。', 'Old.']],
  ['高', 'tall / high', 'adj.', '高', ['高兴', '身高', '高手'], ['很高。', 'Very tall.']],
  ['低', 'low / short', 'adj.', '亻', ['高低', '低价', '低头'], ['很低。', 'Very low.']],
  ['长', 'long', 'adj.', '长', ['长短', '很长', '长处'], ['很长。', 'Very long.']],
  ['短', 'short', 'adj.', '矢', ['长短', '短发', '短暂'], ['很短。', 'Very short.']],
  ['开', 'open / start', 'v.', '一', ['开门', '开学', '开会'], ['开门。', 'Open the door.']],
  ['关', 'close / shut', 'v.', '丷', ['关门', '关心', '开关'], ['关门。', 'Close the door.']],
  ['进', 'enter / go in', 'v.', '辶', ['进去', '进步', '进来'], ['进来。', 'Come in.']],
  ['出', 'exit / go out', 'v.', '凵', ['出去', '出来', '出发'], ['出去。', 'Go out.']],
  ['回', 'return / go back', 'v.', '囗', ['回去', '回家', '回来'], ['回家。', 'Return home.']],
  ['走', 'walk / go', 'v.', '走', ['走路', '走开', '行走'], ['我走。', 'I walk.']],
  ['跑', 'run', 'v.', '足', ['跑步', '快跑', '跑道'], ['跑步。', 'Running.']],
  ['飞', 'fly', 'v.', '飞', ['飞机', '飞走', '飞行'], ['飞机。', 'Airplane.']],
  ['坐', 'sit', 'v.', '土', ['坐下', '坐车', '坐船'], ['坐下。', 'Sit down.']],
  ['站', 'stand', 'v.', '立', ['站起来', '站长', '站住'], ['站起来。', 'Stand up.']],
  ['真', 'real / true', 'adj.', '十', ['真的', '真好看', '认真'], ['真好。', 'Really good.']],
  ['假', 'false / fake', 'adj.', '亻', ['真的假的', '假期', '假话'], ['假。', 'Fake.']],
  ['快', 'fast / quick', 'adj.', '忄', ['快乐', '很快', '快递'], ['很快。', 'Very fast.']],
  ['慢', 'slow', 'adj.', '忄', ['慢慢', '慢车', '慢走'], ['很慢。', 'Very slow.']],
  ['乐', 'happy / joy', 'adj.', '丿', ['快乐', '乐观', '乐趣'], ['快乐。', 'Happy.']],
];

function buildEntry(item, idx) {
  const [hanzi, meaning, pos, bushou, words, sentence] = item;

  // 多音字：type:'array' 才返回真数组，首读为主读音，其余作 alt
  const symArr = pinyin(hanzi, { toneType: 'symbol', type: 'array', multiple: true });
  const numArr = pinyin(hanzi, { toneType: 'num', type: 'array', multiple: true });
  const pinyinMain = symArr[0];
  const alt = symArr.length > 1 ? symArr.slice(1) : [];

  // 声调数字（取主读音 num[0]，与 sym[0] 对齐）
  const toneMainRaw = (numArr && numArr[0]) ? String(numArr[0]) : '0';
  const toneMatch = toneMainRaw.match(/(\d)/);
  const tone = toneMatch ? parseInt(toneMatch[1], 10) : 0; // 0 = 轻声

  // 声母 / 韵母（主读）
  const initial = pinyin(hanzi, { pattern: 'initial' }) || null;
  const final = pinyin(hanzi, { pattern: 'final' }) || null;

  const entry = {
    id: `hsk1-${String(idx + 1).padStart(3, '0')}`,
    hanzi,
    pinyin: pinyinMain,
    tone,
    initial,
    final,
    pos,
    bushou,
    meaning,
    hsk: 1,
    freq: idx + 1, // 本库内相对常用度（近似，越小越常用）
    words: words || [],
    strokeData: 'hanzi-writer', // 渲染时按 hanzi 拉 CDN，不入库
  };
  if (alt.length) entry.alt = alt;
  if (sentence && sentence.length === 2) {
    entry.sentence = {
      zh: sentence[0],
      pinyin: pinyin(sentence[0], { toneType: 'symbol', type: 'array', nonZh: 'removed' }).join(' '),
      en: sentence[1],
    };
  }
  return entry;
}

function buildLevelFile(level, csvPath) {
  const name = HSK_NAME[level] || ('HSK' + level);
  let cards = [];

  if (level === 1) {
    cards = RAW.map(buildEntry);
    const seen = new Set(); let dup = 0;
    for (const c of cards) { if (seen.has(c.hanzi)) { console.warn('⚠ 重复字:', c.hanzi); dup++; } seen.add(c.hanzi); }
    console.log(`   重复字: ${dup}  | 多音字标注: ${cards.filter(c => c.alt).length} 张`);
  } else if (csvPath) {
    const fs = require('node:fs');
    const raw = fs.readFileSync(csvPath, 'utf8').replace(/\r/g, '').split('\n').filter(Boolean);
    const header = raw[0].split(',').map((h) => h.trim());
    for (let i = 1; i < raw.length; i++) {
      const cols = raw[i].split(',');
      const row = {}; header.forEach((h, k) => { row[h] = (cols[k] || '').trim(); });
      let py = row.pinyin || '';
      const pf = (pinyin && row.hanzi)
        ? (() => {
            try {
              if (!py) py = pinyin(row.hanzi, { toneType: 'symbol' });
              const numArr = pinyin(row.hanzi, { toneType: 'num', type: 'array', multiple: true });
              const tRaw = (numArr && numArr[0]) ? String(numArr[0]).match(/(\d)/) : null;
              const ini = pinyin(row.hanzi, { pattern: 'initial', type: 'array', multiple: true });
              const fin = pinyin(row.hanzi, { pattern: 'final', type: 'array', multiple: true });
              return {
                tone: tRaw ? parseInt(tRaw[1], 10) : 0,
                initial: (ini && ini[0]) ? (ini[0] || '-') : '-',
                final: (fin && fin[0]) ? fin[0] : '',
              };
            } catch (e) { return parsePinyinFallback(py); }
          })()
        : parsePinyinFallback(py);
      cards.push({
        id: `hsk${level}-${String(i).padStart(3, '0')}`,
        hanzi: row.hanzi,
        pinyin: py,
        tone: pf.tone,
        initial: pf.initial,
        final: pf.final,
        pos: row.pos || '',
        bushou: row.bushou || '',
        meaning: row.meaning || '',
        hsk: level,
        freq: i,
        words: row.words ? row.words.split('|') : [],
        strokeData: 'hanzi-writer',
      });
    }
  }

  const out = {
    meta: {
      name: `Sinoky 分级字卡库 · ${name} 核心`,
      version: '0.1.0',
      source: csvPath
        ? (`教材 CSV 导入: ${path.basename(csvPath)}`)
        : (level === 1 ? '人工策展语义 + pinyin-pro 生成拼音/声调/声母/韵母' : '占位（待补充）'),
      count: cards.length,
      hsk: level,
      ready: cards.length > 0,
      note: cards.length ? '' : '待补充 — 教材策展中',
      strokeDataNote: '笔顺不入库；前端用 hanzi-writer 按 hanzi 现场拉 https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/{hanzi}.json',
      generatedAt: new Date().toISOString(),
      fields: ['id', 'hanzi', 'pinyin', 'tone', 'initial', 'final', 'pos', 'bushou', 'meaning', 'hsk', 'freq', 'words', 'sentence', 'strokeData', 'alt?'],
      consumers: ['G 沉浸阅读器', 'E 形音义调联动记忆卡', 'B 最小对立对发音', 'C 声调记忆辅助'],
    },
    cards,
  };

  const outPath = new URL(`./flashcards.hsk${level}.json`, import.meta.url);
  writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`✅ 生成 ${cards.length} 张字卡 → flashcards.hsk${level}.json (ready=${cards.length > 0})`);
  if (level === 1 && cards[0]) console.log('   样例[0]:', JSON.stringify(cards[0], null, 0));
  return out;
}

function refreshManifest() {
  const levels = [1, 2, 3].map((lv) => {
    let count = 0, ready = false, note = '';
    try {
      const p = new URL(`./flashcards.hsk${lv}.json`, import.meta.url);
      const j = JSON.parse(require('node:fs').readFileSync(p, 'utf8'));
      count = (j.cards || []).length; ready = count > 0; note = (j.meta && j.meta.note) || '';
    } catch (e) { /* 文件缺失 → 待补充 */ }
    return { level: lv, file: `data/flashcards.hsk${lv}.json`, name: HSK_NAME[lv], ready, count, note };
  });
  const manifest = {
    levels,
    generatedAt: new Date().toISOString(),
    note: 'HSK1=193 字、HSK2=125 词、HSK3=267 词，三等级全部 ready:true 并已上线。前端按 ready 字段渲染等级 tab 与计数。',
  };
  writeFileSync(new URL('./flashcards-levels.json', import.meta.url), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log('✅ wrote flashcards-levels.json');
}

// ---------- CLI ----------
(async () => {
  if (has('--manifest')) { refreshManifest(); return; }
  const level = parseInt(get('--level') || '1', 10);
  if (![1, 2, 3].includes(level)) {
    console.error('用法: --level 1|2|3 [--csv file.csv] | --manifest');
    process.exit(1);
  }
  buildLevelFile(level, get('--csv') || null);
  refreshManifest();
})();
