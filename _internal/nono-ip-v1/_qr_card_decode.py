# -*- coding: utf-8 -*-
"""分享卡二维码 · 独立解码验收

**判据用 zxing-cpp**（安卓 ZXing 的同源实现，真实手机扫码器的主力算法）。

为什么不用 OpenCV 的三个检测器当判据（实测教训）：
  · cv2.QRCodeDetector / QRCodeDetectorAruco 太弱 —— 正品卡片只解出 23/36、12/36，
    数字低到无法分辨「正品」与「轻微劣化」，作为验收线没有分辨力；
  · cv2.wechat_qrcode 又太强 —— 把 quiet zone 彻底去掉（QUIET=0）它仍 36/36 全对，
    等于**分辨不出静区缺失**，同样不能当判据。
  三者只作参考记录。zxingcpp 的取值随结构性缺陷单调下降，才是有分辨力的判据。

判断标准：zxingcpp 解出的文本 == 期望链接。

同时测三档分辨率：原图 1080 / 720 / 540（卡片转发时会被重编码或缩放 ⇒ 模拟降质）。

跑法：python _qr_card_decode.py [目录名]     默认 _qr_after
"""
import json
import os
import sys
import cv2
import numpy as np
import zxingcpp

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(HERE, sys.argv[1] if len(sys.argv) > 1 else '_qr_after')
print('目录：%s' % os.path.basename(D))


def imread_u(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


links = json.load(open(os.path.join(D, 'links.json'), encoding='utf-8'))
det_old = cv2.QRCodeDetector()
det_aru = cv2.QRCodeDetectorAruco()
try:
    det_wx = cv2.wechat_qrcode_WeChatQRCode()
except Exception:
    det_wx = None


def dec_std(det, im):
    try:
        r = det.detectAndDecode(im)
        return r[0] if isinstance(r, tuple) else r
    except Exception:
        return ''


def dec_wx(im):
    if det_wx is None:
        return ''
    try:
        texts, _ = det_wx.detectAndDecode(im)
        return texts[0] if texts else ''
    except Exception:
        return ''


def dec_zx(im):
    try:
        r = zxingcpp.read_barcode(im)
        return r.text if r else ''
    except Exception:
        return ''


n_zx = n_old = n_aru = n_wx = n_tot = 0
fails = []
print()
print('%-14s %-6s %-8s %-6s %-6s %-6s  %s' % ('主题', '缩放', 'zxing', '旧版', 'Aruco', '微信', '判定'))
print('-' * 84)
for t in sorted(links.keys()):
    link = links[t]
    img = imread_u(os.path.join(D, 'card_%s.png' % t))
    if img is None:
        print('%-14s 读图失败' % t)
        continue
    for label, target in (('原图', None), ('720', 720), ('540', 540)):
        if target is None:
            im = img
        else:
            k = float(target) / max(img.shape[:2])      # 按长边等比 ⇒ 竖版才不会被压扁
            im = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
        z = dec_zx(im)
        a, b, c = dec_std(det_old, im), dec_std(det_aru, im), dec_wx(im)
        n_tot += 1
        n_zx += (z == link)
        n_old += (a == link)
        n_aru += (b == link)
        n_wx += (c == link)
        good = (z == link)
        if not good:
            fails.append((t, label, link, a == link, b == link, c == link))
        print('%-14s %-6s %-8s %-6s %-6s %-6s  %s' % (
            t, label,
            'OK' if z == link else '-',
            'OK' if a == link else '-',
            'OK' if b == link else '-',
            'OK' if c == link else '-',
            'PASS' if good else 'FAIL'))
print('-' * 84)
print('总 %d 组：**zxing %d（判据）** / 旧版 %d / Aruco %d / 微信 %d（均参考）'
      % (n_tot, n_zx, n_old, n_aru, n_wx))
if fails:
    print('\n失败明细（%d 组）：' % len(fails))
    for t, label, link, a, b, c in fails:
        print('  %s @%s   旧版=%s Aruco=%s 微信=%s' % (
            t, label, 'OK' if a else '-', 'OK' if b else '-', 'OK' if c else '-'))
