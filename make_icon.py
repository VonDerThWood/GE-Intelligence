import struct

def make_ico(path):
    size = 256
    pixels = []
    cx, cy = size//2, size//2
    for y in range(size):
        for x in range(size):
            dx, dy = x-cx, y-cy
            dist = (dx*dx+dy*dy)**0.5
            if dist <= 118:
                if dist <= 80:
                    pixels.append((0x8a,0x6d,0x2a,255))
                elif dist <= 115:
                    pixels.append((0xc9,0xa8,0x4c,255))
                else:
                    pixels.append((0x7a,0x5d,0x1a,255))
            else:
                pixels.append((0,0,0,0))
    bmp = bytearray()
    bmp += struct.pack('<IIIHHIIIIII',40,size,size*2,1,32,0,0,0,0,0,0)
    for y in reversed(range(size)):
        for x in range(size):
            r,g,b,a = pixels[y*size+x]
            bmp += bytes([b,g,r,a])
    for y in range(size):
        row=0
        for x in range(size):
            r,g,b,a = pixels[(size-1-y)*size+x]
            if a==0: row|=(1<<(7-(x%8)))
            if x%8==7 or x==size-1:
                bmp+=bytes([row]); row=0
        rb=(size+7)//8
        bmp+=bytes((4-rb%4)%4)
    bmp=bytes(bmp)
    ico=struct.pack('<HHH',0,1,1)
    ico+=struct.pack('<BBBBHHII',0,0,0,0,1,32,len(bmp),6+16)
    ico+=bmp
    with open(path,'wb') as f: f.write(ico)
    print('Icon written:', len(ico), 'bytes')

make_ico('assets/icon.ico')
