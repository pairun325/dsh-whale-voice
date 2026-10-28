#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dsh-whale-voice projector —— 屏幕底部的字幕投影窗。

常驻进程，stdin 每行一个 JSON：
  {"op":"show","text":"...","ttl":9000}
  {"op":"hide"}
  {"op":"config","fontSize":30,"width":1100,"bottom":180,"alpha":0.9}
  {"op":"quit"}

窗口无边框、置顶、不抢焦点、鼠标穿透。
做法：窗口只在启动时 map 一次，之后用 SetWindowPos 挪进/挪出来显示，
避免 deiconify 抢焦点；每次显示都重新断言 HWND_TOPMOST。
"""

import ctypes
import json
import queue
import sys
import threading
import tkinter as tk
from ctypes import wintypes

if sys.platform != "win32":
    raise SystemExit("dsh-whale-voice 只支持 Windows")

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

user32 = ctypes.windll.user32

GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x00080000
WS_EX_TRANSPARENT = 0x00000020
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_NOACTIVATE = 0x08000000

HWND_TOPMOST = -1
SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040

W, H = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
OFFSCREEN = -20000


class Projector:
    def __init__(self):
        self.settings = {
            "fontSize": 30,
            "width": min(1180, int(W * 0.62)),
            "bottom": 120,
            "alpha": 0.9,
            "ttl": 9000,
        }
        self.queue = queue.Queue()
        self.root = tk.Tk()
        self.root.title("鲸鱼娘 · 字幕")
        self.root.overrideredirect(True)
        self.root.configure(bg="#081426")
        self.root.attributes("-alpha", self.settings["alpha"])

        self.frame = tk.Frame(self.root, bg="#081426", highlightthickness=1, highlightbackground="#2f6fbf")
        self.frame.pack(fill="both", expand=True)

        self.name_label = tk.Label(
            self.frame,
            text="鲸鱼娘",
            font=("Microsoft YaHei UI", 11, "bold"),
            fg="#7fd0ff",
            bg="#081426",
            anchor="w",
            padx=20,
        )
        self.name_label.pack(fill="x", pady=(8, 0))

        self.label = tk.Label(
            self.frame,
            text="",
            font=("Microsoft YaHei UI", self.settings["fontSize"]),
            fg="#eaf6ff",
            bg="#081426",
            justify="left",
            anchor="w",
            wraplength=self.settings["width"] - 40,
            padx=20,
            pady=10,
        )
        self.label.pack(fill="both", expand=True)

        self.hwnd = None
        self.visible = False
        self.hide_timer = None
        self.raise_timer = None

        # 先 map 一次（这一次允许抢焦点），拿到 hwnd 后立刻装成穿透、无焦点、置顶
        self.root.geometry(f"{self.settings['width']}x120+{OFFSCREEN}+0")
        self.root.update_idletasks()
        self.root.deiconify()
        self.root.update()
        self._attach()
        self._move(OFFSCREEN, OFFSCREEN)
        self.root.attributes("-alpha", 0.0)

        self.root.after(80, self._drain)

    # ---- 窗口属性 -------------------------------------------------------
    def _attach(self):
        try:
            # winfo_id 是 Tk 内部子窗口；真正带装饰/顶层的是它的祖先
            hwnd = user32.GetAncestor(self.root.winfo_id(), 2) or self.root.winfo_id()
            parent = user32.GetParent(hwnd)
            while parent:
                hwnd = parent
                parent = user32.GetParent(hwnd)
            self.hwnd = hwnd
            style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            style |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
            user32.SetWindowLongW(hwnd, GWL_EXSTYLE, style)
            self._topmost()
        except Exception:
            pass

    def _topmost(self):
        if self.hwnd is None:
            return
        try:
            user32.SetWindowPos.argtypes = (
                wintypes.HWND, wintypes.HWND, wintypes.INT, wintypes.INT,
                wintypes.INT, wintypes.INT, wintypes.UINT,
            )
            user32.SetWindowPos.restype = wintypes.BOOL
            user32.SetWindowPos(self.hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW)
        except Exception:
            pass

    def _place_at(self, x, y, width, height):
        if self.hwnd is None:
            self.root.geometry(f"{width}x{height}+{x}+{y}")
            return
        try:
            user32.MoveWindow(self.hwnd, int(x), int(y), int(width), int(height), True)
        except Exception:
            self.root.geometry(f"{width}x{height}+{x}+{y}")

    def _move(self, x, y):
        if self.hwnd is None:
            self.root.geometry(f"+{x}+{y}")
            return
        rect = wintypes.RECT()
        user32.GetWindowRect(self.hwnd, ctypes.byref(rect))
        self._place_at(x, y, rect.right - rect.left, rect.bottom - rect.top)

    # ---- 显示 / 隐藏 ----------------------------------------------------
    def show(self, text, ttl=None):
        text = (text or "").strip()
        if not text:
            return
        if len(text) > 800:
            text = text[:800] + "…"
        self.label.configure(text=text)
        self.label.configure(wraplength=self.settings["width"] - 40)
        self.root.update_idletasks()
        height = max(self.root.winfo_reqheight(), 96)
        width = self.settings["width"]
        x = max(0, (W - width) // 2)
        y = max(0, H - height - self.settings["bottom"])

        self._place_at(x, y, width, height)
        self._topmost()
        self.root.attributes("-alpha", float(self.settings["alpha"]))
        self.visible = True

        if self.hide_timer is not None:
            try:
                self.root.after_cancel(self.hide_timer)
            except Exception:
                pass
        self.hide_timer = self.root.after(int(ttl or self.settings["ttl"]), self.hide)
        self._keep_on_top()

    def hide(self):
        self.visible = False
        if self.hide_timer is not None:
            try:
                self.root.after_cancel(self.hide_timer)
            except Exception:
                pass
            self.hide_timer = None
        self.root.attributes("-alpha", 0.0)
        self._move(OFFSCREEN, OFFSCREEN)

    def _keep_on_top(self):
        if not self.visible:
            return
        self._topmost()
        self.raise_timer = self.root.after(1200, self._keep_on_top)

    def config(self, values):
        for key in ("fontSize", "width", "bottom", "alpha", "ttl"):
            if key in values and isinstance(values[key], (int, float)):
                self.settings[key] = values[key]
        self.label.configure(
            font=("Microsoft YaHei UI", int(self.settings["fontSize"])),
            wraplength=max(200, int(self.settings["width"]) - 40),
        )
        self.root.attributes("-alpha", float(self.settings["alpha"]))
        if self.visible:
            self.show(self.label.cget("text"))

    def _drain(self):
        try:
            while True:
                message = self.queue.get_nowait()
                op = message.get("op")
                if op == "show":
                    self.show(message.get("text", ""), message.get("ttl"))
                elif op == "hide":
                    self.hide()
                elif op == "config":
                    self.config(message.get("settings") or message)
                elif op == "quit":
                    self.root.destroy()
                    return
        except queue.Empty:
            pass
        self.root.after(60, self._drain)

    def reader(self):
        for line in sys.stdin.buffer:
            line = line.strip()
            if not line:
                continue
            try:
                self.queue.put(json.loads(line.decode("utf-8")))
            except Exception:
                continue


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    projector = Projector()
    threading.Thread(target=projector.reader, daemon=True).start()
    try:
        projector.root.mainloop()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
