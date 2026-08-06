# -*- coding: utf-8 -*-
"""
卡牌对决 · 电脑版（可执行程序入口）
内置局域网服务器 + 桌面窗口（pywebview / EdgeChromium）
打包：build.bat
"""
import json
import os
import random
import socket
import string
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = 8788
ROOMS = {}
LOCK = threading.Lock()
CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'


def res_path(name):
    base = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


def read_res(name):
    with open(res_path(name), 'rb') as f:
        return f.read()


INDEX_HTML = None
SW_JS = None
ICON192 = None
ICON512 = None
MANIFEST = json.dumps({
    "name": "卡牌对决",
    "short_name": "卡牌对决",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#141517",
    "theme_color": "#141517",
    "icons": [
        {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"}
    ]
}, ensure_ascii=False).encode('utf-8')


def local_ips():
    """枚举本机所有非回环 IPv4 地址，内网地址优先排序"""
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    try:
        import re
        import subprocess
        out = subprocess.check_output('ipconfig', shell=True, errors='ignore')
        for m in re.findall(rb'IPv4[^\d]*([\d.]+)', out):
            ips.add(m.decode('ascii', 'ignore'))
    except Exception:
        pass
    ips.discard('127.0.0.1')
    lan = sorted([i for i in ips if i.startswith(('192.168.', '10.', '172.'))])
    other = sorted(ips - set(lan))
    return lan + other


def lan_ip():
    """挑出手机可连的真实局域网 IP：优先有默认网关的网段，排除虚拟网卡"""
    try:
        import re
        import subprocess
        out = subprocess.check_output('ipconfig', shell=True, encoding='gbk', errors='ignore')
        lines = out.splitlines()
        blocks, cur = [], []
        for ln in lines:
            if ln.strip() == '':
                if cur:
                    blocks.append(cur)
                    cur = []
            else:
                cur.append(ln)
        if cur:
            blocks.append(cur)
        cands, gw = [], []
        for blk in blocks:
            ip = None
            has_gw = False
            for ln in blk:
                m = re.search(r'IPv4[^\d]*([\d.]+)', ln)
                if m and ip is None:
                    ip = m.group(1)
                if '默认网关' in ln and re.search(r'\d', ln):
                    has_gw = True
            if ip:
                cands.append(ip)
                if has_gw:
                    gw.append(ip)
        for ip in gw:
            if ip.startswith(('192.168.', '10.', '172.')):
                return ip
        if gw:
            return gw[0]
        bad = ('192.168.182.', '192.168.9.', '192.168.56.', '192.168.137.', '169.254.')
        for ip in cands:
            if ip.startswith(('192.168.', '10.', '172.')) and not ip.startswith(bad):
                return ip
        return cands[0] if cands else '127.0.0.1'
    except Exception:
        return '127.0.0.1'


def load_res():
    global INDEX_HTML, SW_JS, ICON192, ICON512
    INDEX_HTML = read_res('index.html')
    try:
        INDEX_HTML = INDEX_HTML.replace(b'const __IP_LIST__ = [];',
            ('const __IP_LIST__ = ' + json.dumps(local_ips())).encode('utf-8'))
        INDEX_HTML = INDEX_HTML.replace(b'const __PHONE_IP__ = "";',
            ('const __PHONE_IP__ = ' + json.dumps(lan_ip())).encode('utf-8'))
    except Exception:
        pass
    SW_JS = read_res('sw.js')
    ICON192 = read_res('icon-192.png')
    ICON512 = read_res('icon-512.png')


def gen_code():
    return ''.join(random.choices(CODE_CHARS, k=5))


LOG_PATH = r'D:\AgentProject\卡牌游戏电脑版\server.log'
LAST_PK = {}


def slog(msg):
    try:
        with open(LOG_PATH, 'a', encoding='utf-8') as f:
            f.write(time.strftime('[%H:%M:%S] ') + msg + chr(10))
    except Exception:
        pass


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode('utf-8'),
                   'application/json; charset=utf-8')

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        p = urlparse(self.path)
        q = parse_qs(p.query)
        if p.path == '/':
            self._send(200, INDEX_HTML, 'text/html; charset=utf-8')
        elif p.path == '/manifest.json':
            self._send(200, MANIFEST, 'application/manifest+json')
        elif p.path == '/sw.js':
            self._send(200, SW_JS, 'application/javascript')
        elif p.path == '/icon-192.png':
            self._send(200, ICON192, 'image/png')
        elif p.path == '/icon-512.png':
            self._send(200, ICON512, 'image/png')
        elif p.path == '/create':
            with LOCK:
                for _ in range(100):
                    room = gen_code()
                    if room not in ROOMS:
                        break
                ROOMS[room] = {'state': None, 'picks': [None, None], 't': time.time(), 'data': None}
            slog('CREATE room=' + room)
            self._json(200, {'ok': True, 'room': room})
        elif p.path == '/join':
            room = (q.get('room', [''])[0] or '').upper()
            with LOCK:
                r = ROOMS.get(room)
                if not r:
                    self._json(404, {'ok': False, 'err': '房间不存在'})
                    return
                if r['state'] is not None:
                    self._json(409, {'ok': False, 'err': '对局已开始'})
                    return
            slog('JOIN room=' + room)
            r['t'] = time.time()
            self._json(200, {'ok': True})
        elif p.path == '/rooms':
            with LOCK:
                now = time.time()
                rooms = []
                for code, r in ROOMS.items():
                    if now - r['t'] > 3600:
                        continue
                    rooms.append({'room': code,
                                  'picks': sum(1 for x in r['picks'] if x),
                                  'playing': r['state'] is not None})
                rooms.sort(key=lambda x: (x['playing'], -x['picks'], x['room']))
            self._json(200, {'ok': True, 'rooms': rooms})
        elif p.path == '/state':
            room = (q.get('room', [''])[0] or '').upper()
            with LOCK:
                r = ROOMS.get(room)
                if not r:
                    self._json(404, {'ok': False, 'err': '房间不存在'})
                    return
                try:
                    pk = json.dumps(r['picks'], ensure_ascii=False)[:120]
                    if LAST_PK.get(room) != pk:
                        LAST_PK[room] = pk
                        slog('STATE room=' + room + ' picks=' + pk)
                except Exception:
                    pass
                self._json(200, {'ok': True, 'state': r['state'], 'picks': r['picks']})
        elif p.path == '/hostdata':
            room = (q.get('room', [''])[0] or '').upper()
            with LOCK:
                r = ROOMS.get(room)
                if not r:
                    self._json(404, {'ok': False, 'err': '房间不存在'})
                    return
                slog('HOSTDATA_GET room=' + room + ' has=' + str(r['data'] is not None))
                self._json(200, {'ok': True, 'data': r['data']})
        elif p.path == '/ping':
            self._json(200, {'ok': True})
        else:
            self._json(404, {'ok': False})

    def do_POST(self):
        p = urlparse(self.path).path
        try:
            ln = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(ln) or b'{}')
        except Exception:
            self._json(400, {'ok': False, 'err': 'bad json'})
            return
        room = (data.get('room') or '').upper()
        with LOCK:
            r = ROOMS.get(room)
            if not r:
                self._json(404, {'ok': False, 'err': '房间不存在'})
                return
            if p == '/state':
                st = data.get('state')
                if r['state'] is not None and st and r['state'].get('seq', -1) >= st.get('seq', 0):
                    self._json(409, {'ok': False, 'err': '回合冲突，状态已过期'})
                    return
                r['state'] = st
                r['t'] = time.time()
                self._json(200, {'ok': True})
            elif p == '/pick':
                side = data.get('side')
                if side not in (0, 1):
                    self._json(400, {'ok': False, 'err': 'side 无效'})
                    return
                r['picks'][side] = {'role': data.get('role'), 'cards': data.get('cards')}
                nm = ''
                try:
                    nm = data.get('role', {}).get('name', '')
                except Exception:
                    pass
                slog('PICK room=' + room + ' side=' + str(side) + ' name=' + str(nm))
                r['t'] = time.time()
                self._json(200, {'ok': True})
            elif p == '/hostdata':
                r['data'] = data.get('data')
                slog('HOSTDATA_SET room=' + room)
                r['t'] = time.time()
                self._json(200, {'ok': True})
            elif p == '/leave':
                side = data.get('side')
                if side == 0 or side is None:
                    if room in ROOMS:
                        del ROOMS[room]
                    slog('LEAVE host room=' + room)
                else:
                    if room in ROOMS:
                        ROOMS[room]['picks'][1] = None
                    slog('LEAVE guest room=' + room)
                self._json(200, {'ok': True})
            else:
                self._json(404, {'ok': False})


def start_server():
    load_res()
    srv = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def cleanup():
    while True:
        time.sleep(300)
        now = time.time()
        with LOCK:
            for k in [k for k, r in ROOMS.items() if now - r['t'] > 7200]:
                del ROOMS[k]


if __name__ == '__main__':
    start_server()
    threading.Thread(target=cleanup, daemon=True).start()
    try:
        import webview
        webview.create_window(
            '卡牌对决',
            'http://127.0.0.1:%d/' % PORT,
            width=1200, height=840, min_size=(920, 640)
        )
        webview.start()
    except Exception:
        import webbrowser
        webbrowser.open('http://127.0.0.1:%d/' % PORT)
        while True:
            time.sleep(60)
