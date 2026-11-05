"""Create deterministic, original app icons without external packages."""
import struct
import zlib
from pathlib import Path


def polygon(x, y, points):
    inside = False
    j = len(points)-1
    for i, (xi, yi) in enumerate(points):
        xj, yj = points[j]
        if (yi > y) != (yj > y) and x < (xj-xi)*(y-yi)/(yj-yi)+xi:
            inside = not inside
        j = i
    return inside


def icon(size):
    shapes = [[(130,356),(382,356),(382,402),(337,402),(337,367),(175,367),(175,402),(130,402)],
              [(167,338),(192,278),(207,208),(207,148),(337,148),(337,338),(291,338),(291,190),(248,190),(239,268),(216,338)]]
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            px, py = (x+.5)*512/size, (y+.5)*512/size
            mark = any(polygon(px,py,shape) for shape in shapes) or (px-256)**2+(py-94)**2<100
            rows.extend((229,199,142) if mark else (33,75,64))
    def chunk(name, data):
        return struct.pack('!I',len(data))+name+data+struct.pack('!I',zlib.crc32(name+data)&0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR',struct.pack('!2I5B',size,size,8,2,0,0,0))
    return data+chunk(b'IDAT',zlib.compress(rows,9))+chunk(b'IEND',b'')


if __name__=='__main__':
    for size in (192,512):
        (Path(__file__).parent/'public'/f'icon-{size}.png').write_bytes(icon(size))
