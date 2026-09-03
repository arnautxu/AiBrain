#!/usr/bin/env python3
"""Report only whether the private Xvfb display has a nonblank remote frame."""
import ctypes as C
import ctypes.util
import json


def visible():
    x = C.CDLL(ctypes.util.find_library('X11'))
    x.XOpenDisplay.argtypes = [C.c_char_p]; x.XOpenDisplay.restype = C.c_void_p
    x.XDefaultRootWindow.argtypes = [C.c_void_p]; x.XDefaultRootWindow.restype = C.c_ulong
    x.XGetGeometry.argtypes = [C.c_void_p,C.c_ulong,C.POINTER(C.c_ulong),C.POINTER(C.c_int),C.POINTER(C.c_int),C.POINTER(C.c_uint),C.POINTER(C.c_uint),C.POINTER(C.c_uint),C.POINTER(C.c_uint)]
    x.XGetImage.argtypes = [C.c_void_p,C.c_ulong,C.c_int,C.c_int,C.c_uint,C.c_uint,C.c_ulong,C.c_int]; x.XGetImage.restype = C.c_void_p
    x.XGetPixel.argtypes = [C.c_void_p,C.c_int,C.c_int]; x.XGetPixel.restype = C.c_ulong
    x.XDestroyImage.argtypes = [C.c_void_p]; x.XCloseDisplay.argtypes = [C.c_void_p]
    display = x.XOpenDisplay(None)
    if not display: raise ValueError('DISPLAY_UNAVAILABLE')
    try:
        root = x.XDefaultRootWindow(display)
        parent=C.c_ulong(); px=C.c_int(); py=C.c_int(); width=C.c_uint(); height=C.c_uint(); border=C.c_uint(); depth=C.c_uint()
        if not x.XGetGeometry(display,root,C.byref(parent),C.byref(px),C.byref(py),C.byref(width),C.byref(height),C.byref(border),C.byref(depth)):
            raise ValueError('DISPLAY_GEOMETRY_UNAVAILABLE')
        if depth.value != 24 or not 100 <= width.value <= 4096 or not 100 <= height.value <= 4096:
            raise ValueError('UNSUPPORTED_DISPLAY')
        image=x.XGetImage(display,root,0,0,width,height,C.c_ulong(-1),2)
        if not image: raise ValueError('FRAME_UNAVAILABLE')
        try:
            # Interior samples ignore window borders and the mouse cursor.
            pixels=[x.XGetPixel(image,width.value*col//12,height.value*row//12)&0xffffff
                    for row in range(1,12) for col in range(1,12)]
            return sum(pixel != 0 for pixel in pixels) >= 24 and len(set(pixels)) >= 3
        finally: x.XDestroyImage(image)
    finally: x.XCloseDisplay(display)


if __name__ == '__main__':
    try: print(json.dumps({'visible': visible()}))
    except Exception: print(json.dumps({'visible': False, 'error': 'FRAME_UNAVAILABLE'})); raise SystemExit(1)
