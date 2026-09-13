#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sinoky v0.23.8 FIX · 组 5：听辨题库扩组的「最后一公里」断点（审计 P1-1）

════════════════════════════════════════════════════════════════════════
审计原话
════════════════════════════════════════════════════════════════════════
「**听辨题库仅 1 组** · `LISTEN_Q` 只有 `ma` 一组 · 目标是 **≥5 组**」

════════════════════════════════════════════════════════════════════════
本轮实测（不能只照抄审计）
════════════════════════════════════════════════════════════════════════
① **4 条声调音频是好的**（先排除）：
   我把 TONES 的 base64 解码后丢给浏览器 Web Audio 真解码 —— 0.432/0.480/0.720/0.456 s，
   峰值 0.29/0.28/0.22/0.32，RMS 0.064/0.068/0.048/0.064。
   （**教训**：光看 MP3 字节型我一度以为 3 条是静音 —— 主数据区大量 0x55/0xAA。
     那是编码器 priming 的正常位型。**字节型启发式不是有效判据，真解码才是**，
     同 v0.23.6「微信检测器过强」那次。）

② **机制确实是通用的**：注入 5 组合成数据后 listenPool() 1→6，200 次抽题 6 组全可达，
   超前组（day 9999）与无音频组都被正确过滤（`不超前` / `零空壳`）。
   ⇒ 注释里「追加数据即可」在**数据层面**成立。

③ **但「前端零改动」在音频层面是假的**（本组修的就是这个）：
   `playToneAudio()` 第 2 行硬拒一切非 `data:audio` 开头的 src：

       if(!t || !t.audio || t.audio.indexOf('data:audio') !== 0){ … return; }

   于是新音频**只能用 base64 内联**。算一笔账：5 组 × 4 条 = 20 条，
   单条约 9 KB ⇒ base64 后约 **240 KB**，而 index.html 现在才 664 KB ⇒ 直接 +36%。
   唯一可持续的存法是 `assets/tones/*.mp3` **文件路径**（v0.22.0 起就已经放了
   tone1..4.mp3，与那 4 段 base64 **逐字节相同**，只是没人引用）。
   可一旦用文件路径，播放键只会静默显示「↻ Tap to retry」——
   用户以为录坏了，其实是我们不认。

④ **顺带一处真 UX 断点**：`playToneAudio` 只找 `$('tone-play')`（Tone Gym 的按钮），
   而听辨卡用的是 `id="ear-play"`。⇒ 听辨卡点「Play the sound」，**无论成功失败都没有
   任何状态反馈**（没有 loading、没有 playing、没有 retry）。

════════════════════════════════════════════════════════════════════════
本组修 3 处（都不改变现有 4 条 ma 音频的行为）
════════════════════════════════════════════════════════════════════════
  L1  playToneAudio 放行文件路径（data URI / 相对路径 / 绝对 URL / 带音频后缀的都收）
  L2  playToneAudio 支持指定目标按钮（第 2 个可选参数），默认仍 'tone-play' 向后兼容
  L3  listenPlay() 传 'ear-play' ⇒ 听辨卡从此有 loading / playing / retry 三态

**不做的**：不把现有 4 条 ma 音频从 base64 改成文件（那是另一种改动：会引入离线依赖，
需同步 SW ASSETS；本轮不碰，风险与收益不成比例）。改完后**新组**可以用文件。
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..', '..'))
IDX = os.path.join(APP, 'index.html')


def read(p):
    with io.open(p, encoding='utf-8', newline='') as f:
        s = f.read()
    return s.replace('\r\n', '\n').replace('\r', '\n')


def write(p, s):
    s = s.replace('\r\n', '\n').replace('\r', '\n')
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(s)


def sub_once(s, old, new, label):
    """目标态已存在则跳过（幂等）。"""
    if new in s:
        print('  [skip] %s' % label)
        return s
    n = s.count(old)
    assert n >= 1, '%s：锚点未命中' % label
    assert n == 1, '%s：锚点命中 %d 次（不唯一）' % (label, n)
    print('  [ok]   %s' % label)
    return s.replace(old, new, 1)


# ══════════════ L1 + L2：playToneAudio 放行文件路径 + 可指定按钮 ══════════════
def fix_play(idx):
    print('L1/L2  playToneAudio：放行文件路径 + 可指定按钮')
    old = """function playToneAudio(t){
  if(!t || !t.audio || t.audio.indexOf('data:audio') !== 0){
    var btn = $('tone-play'); if(btn){ btn.textContent = '↻ Tap to retry'; } return;
  }
  var a = AUDIO || (AUDIO = new Audio());
  try { a.pause(); } catch(e){}
  a.volume = 1;
  var btn = $('tone-play');
  a.onplaying = function(){ if(btn){ btn.innerHTML = PLAY_ICON + ' Play the sound'; } };
  a.onended = function(){ if(btn){ btn.innerHTML = PLAY_ICON + ' Play the sound'; } };
  a.onerror = function(){ if(btn){ btn.textContent = '↻ Tap to retry'; } };
  a.src = t.audio;
  if(btn){ btn.textContent = '… loading'; }
  a.play().catch(function(){ if(btn){ btn.textContent = '↻ Tap to retry'; } });
}"""
    new = """function toneAudioOk(src){
  /* v0.23.8（审计 P1-1）：原来只认 `data:audio` 开头的 src，等于把「扩充听辨题库」
     锁死在 base64 内联上 —— 5 组 × 4 条 ≈ 240 KB，而 index.html 才 664 KB。
     改为「data URI / 相对路径 / 绝对 URL / 带音频后缀」都收，
     这样新组可以用 assets/tones/*.mp3 文件（v0.22.0 就在那了，只是没人引用）。 */
  if(!src || typeof src !== 'string') return false;
  if(src.indexOf('data:audio') === 0) return true;
  if(/^[./]/.test(src) || /^https?:/i.test(src)) return true;
  return /\\.(mp3|m4a|ogg|oga|wav|webm|aac)(\\?|#|$)/i.test(src);
}
function playToneAudio(t, btnId){
  /* btnId 默认 'tone-play'（向后兼容 Tone Gym 的 4 个调用点）。
     听辨卡传 'ear-play' —— 否则播放出问题时按钮毫无反馈。 */
  var btn = $(btnId || 'tone-play');
  if(!toneAudioOk(t && t.audio)){
    if(btn){ btn.textContent = '↻ Tap to retry'; } return;
  }
  var a = AUDIO || (AUDIO = new Audio());
  try { a.pause(); } catch(e){}
  a.volume = 1;
  a.onplaying = function(){ if(btn){ btn.innerHTML = PLAY_ICON + ' Play the sound'; } };
  a.onended = function(){ if(btn){ btn.innerHTML = PLAY_ICON + ' Play the sound'; } };
  a.onerror = function(){ if(btn){ btn.textContent = '↻ Tap to retry'; } };
  a.src = t.audio;
  if(btn){ btn.textContent = '… loading'; }
  a.play().catch(function(){ if(btn){ btn.textContent = '↻ Tap to retry'; } });
}"""
    return sub_once(idx, old, new, 'playToneAudio 重写')


# ══════════════ L3：listenPlay 传入 ear-play ══════════════
def fix_listen_play(idx):
    print('L3     listenPlay 指向 ear-play')
    old = """  playToneAudio(it.q);      /* 复用 Tone Gym 的播放器（同一套真人音频，零重复实现） */"""
    new = """  /* v0.23.8：复用 Tone Gym 的播放器，但**必须指定本卡的按钮**。
     原来不传按钮 ⇒ playToneAudio 去找 $('tone-play')（Tone Gym 的），
     而听辨卡的键是 ear-play ⇒ 点了无论成功失败都零反馈。 */
  playToneAudio(it.q, 'ear-play');"""
    return sub_once(idx, old, new, 'listenPlay → ear-play')


if __name__ == '__main__':
    print('APP =', APP)
    idx = read(IDX)
    idx = fix_play(idx)
    idx = fix_listen_play(idx)
    write(IDX, idx)
    print('\n完成。index.html %d B' % len(idx.encode('utf-8')))
