# correct_pure_md5.py
# RFC 1321-compliant MD5 (pure Python)

import struct

def left_rotate(x, c):
    return ((x << c) | (x >> (32 - c))) & 0xffffffff

def hash(message):
    if isinstance(message, str):
        message = message.encode("utf-8")

    msg_len = len(message)
    message += b'\x80'
    message += b'\x00' * ((56 - (msg_len + 1) % 64) % 64)
    message += struct.pack('<Q', msg_len * 8)

    # Initial values per RFC
    a0, b0, c0, d0 = (0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476)

    # Constants for MD5
    T = [int(abs(__import__('math').sin(i + 1)) * 2**32) & 0xffffffff for i in range(64)]
    shifts = [7, 12, 17, 22] * 4 + \
             [5, 9, 14, 20] * 4 + \
             [4, 11, 16, 23] * 4 + \
             [6, 10, 15, 21] * 4

    def F(i, b, c, d):
        if i < 16: return (b & c) | (~b & d)
        elif i < 32: return (d & b) | (~d & c)
        elif i < 48: return b ^ c ^ d
        else: return c ^ (b | ~d)

    def G(i):
        if i < 16: return i
        elif i < 32: return (5*i + 1) % 16
        elif i < 48: return (3*i + 5) % 16
        else: return (7*i) % 16

    for chunk_offset in range(0, len(message), 64):
        a, b, c, d = a0, b0, c0, d0
        M = list(struct.unpack('<16I', message[chunk_offset:chunk_offset + 64]))

        for i in range(64):
            f = F(i, b, c, d)
            g = G(i)
            to_rotate = (a + f + T[i] + M[g]) & 0xffffffff
            new_b = (b + left_rotate(to_rotate, shifts[i])) & 0xffffffff
            a, b, c, d = d, new_b, b, c

        a0 = (a0 + a) & 0xffffffff
        b0 = (b0 + b) & 0xffffffff
        c0 = (c0 + c) & 0xffffffff
        d0 = (d0 + d) & 0xffffffff

    return ''.join(f'{x:02x}' for x in struct.pack('<4I', a0, b0, c0, d0))