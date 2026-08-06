# -*- coding: utf-8 -*-
"""生成 PWA 图标（卡牌+骰子图形）"""
from PIL import Image, ImageDraw

for size in (192, 512):
    img = Image.new('RGB', (size, size), (20, 21, 23))
    d = ImageDraw.Draw(img)
    s = size / 512.0
    # 卡牌边框
    d.rounded_rectangle([int(60*s), int(48*s), int(452*s), int(464*s)],
                        radius=int(40*s), outline=(217, 164, 65), width=max(3, int(14*s)))
    # 卡面
    d.rounded_rectangle([int(88*s), int(76*s), int(424*s), int(436*s)],
                        radius=int(24*s), fill=(28, 30, 33))
    # 骰子五点
    cx, cy, r = 256*s, 236*s, int(28*s)
    for dx, dy in [(-0.16, -0.16), (0.16, -0.16), (0, 0), (-0.16, 0.16), (0.16, 0.16)]:
        d.ellipse([cx+dx*512*s-r, cy+dy*512*s-r, cx+dx*512*s+r, cy+dy*512*s+r], fill=(217, 164, 65))
    # 底部条
    d.rectangle([int(100*s), int(352*s), int(412*s), int(400*s)], fill=(35, 37, 41))
    d.text  # noqa
    img.save('icon-%d.png' % size)
    print('icon-%d.png done' % size)
