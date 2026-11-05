"""Draw the original calendar + restaurant cloche mark as SVG and antialiased PNG."""
import struct
import zlib
from pathlib import Path


def rounded(x,y,left,top,right,bottom,radius):
    qx=max(left+radius-x,0,x-(right-radius))
    qy=max(top+radius-y,0,y-(bottom-radius))
    return qx*qx+qy*qy<=radius*radius


def segment(x,y,x1,y1,x2,y2,width):
    projection=max(0,min(1,((x-x1)*(x2-x1)+(y-y1)*(y2-y1))/((x2-x1)**2+(y2-y1)**2)))
    return (x-x1-projection*(x2-x1))**2+(y-y1-projection*(y2-y1))**2<=(width/2)**2


def pixel(x,y,masked):
    if not masked and not rounded(x,y,0,0,512,512,112):
        return None
    color=(33,75,64)
    outer=rounded(x,y,120,144,392,392,36)
    inner=rounded(x,y,134,158,378,378,22)
    if outer and not inner or segment(x,y,134,208,378,208,8):
        color=(248,245,233)
    radius=(x-256)**2+(y-316)**2
    cloche=y<=316 and 52**2<=radius<=64**2
    if (cloche or (x-256)**2+(y-240)**2<=7**2 or
        segment(x,y,176,336,336,336,12) or
        segment(x,y,194,118,194,168,18) or segment(x,y,318,118,318,168,18)):
        color=(229,199,142)
    return color


def icon(size,masked=False):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            samples=[pixel((x+dx)*512/size,(y+dy)*512/size,masked) for dx in (.25,.75) for dy in (.25,.75)]
            visible=[color for color in samples if color is not None]
            color=tuple(round(sum(c[channel] for c in visible)/len(visible)) for channel in range(3)) if visible else (0,0,0)
            rows.extend((*color,round(255*len(visible)/4)))
    def chunk(name, data):
        return struct.pack('!I',len(data))+name+data+struct.pack('!I',zlib.crc32(name+data)&0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR',struct.pack('!2I5B',size,size,8,6,0,0,0))
    return data+chunk(b'IDAT',zlib.compress(rows,9))+chunk(b'IEND',b'')


if __name__=='__main__':
    public=Path(__file__).parent/'public'
    svg='''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#214b40"/><rect x="127" y="151" width="258" height="234" rx="29" fill="none" stroke="#f8f5e9" stroke-width="14"/><path d="M134 208h244" stroke="#f8f5e9" stroke-width="8"/><path d="M194 118v50m124-50v50" stroke="#e5c78e" stroke-width="18" stroke-linecap="round"/><path d="M198 316a58 58 0 0 1 116 0M176 336h160" fill="none" stroke="#e5c78e" stroke-width="12" stroke-linecap="round"/><circle cx="256" cy="240" r="7" fill="#e5c78e"/></svg>'''
    for name in ('icon.svg','icon-v2.svg'):
        (public/name).write_text(svg+'\n',encoding='utf-8')
    for size in (192,512):
        data=icon(size)
        for name in (f'icon-{size}.png',f'icon-{size}-v2.png'):
            (public/name).write_bytes(data)
    (public/'icon-maskable-v2.png').write_bytes(icon(512,masked=True))
    (public/'apple-touch-icon-v2.png').write_bytes(icon(180,masked=True))
