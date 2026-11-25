"""Extract one face from a TrueType Collection (.ttc) into a standalone .ttf.

Only used locally to feed Flutter's test FontLoader, which cannot parse .ttc.
"""
import struct
import sys


def read_face(data, offset):
    version, num_tables = struct.unpack_from(">IH", data, offset)
    tables = []
    for i in range(num_tables):
        tag, checksum, off, length = struct.unpack_from(
            ">4sIII", data, offset + 12 + i * 16
        )
        tables.append((tag, checksum, data[off:off + length]))
    return version, tables


def build_ttf(version, tables):
    num = len(tables)
    # searchRange, entrySelector, rangeShift per spec
    pow2 = 1
    entry_selector = 0
    while pow2 * 2 <= num:
        pow2 *= 2
        entry_selector += 1
    search_range = pow2 * 16
    range_shift = num * 16 - search_range
    header = struct.pack(
        ">IHHHH", version, num, search_range, entry_selector, range_shift
    )
    offset = 12 + num * 16
    records = b""
    body = b""
    for tag, checksum, payload in tables:
        records += struct.pack(">4sIII", tag, checksum, offset, len(payload))
        padded = payload + b"\0" * ((4 - len(payload) % 4) % 4)
        body += padded
        offset += len(padded)
    return header + records + body


def face_name(data, offset):
    version, num_tables = struct.unpack_from(">IH", data, offset)
    for i in range(num_tables):
        tag, _checksum, off, length = struct.unpack_from(
            ">4sIII", data, offset + 12 + i * 16
        )
        if tag != b"name":
            continue
        fmt, count, string_offset = struct.unpack_from(">HHH", data, off)
        names = []
        for j in range(count):
            pid, eid, lid, nid, ln, noff = struct.unpack_from(
                ">HHHHHH", data, off + 6 + j * 12
            )
            if nid not in (1, 4):
                continue
            raw = data[off + string_offset + noff:off + string_offset + noff + ln]
            try:
                names.append((nid, raw.decode("utf-16-be")))
            except UnicodeDecodeError:
                pass
        return names
    return []


def main():
    src, out_prefix = sys.argv[1], sys.argv[2]
    data = open(src, "rb").read()
    tag, major, minor = struct.unpack_from(">4sHH", data, 0)
    assert tag == b"ttcf", "not a ttc"
    num_fonts = struct.unpack_from(">I", data, 8)[0]
    offsets = struct.unpack_from(">" + "I" * num_fonts, data, 12)
    for idx, off in enumerate(offsets):
        names = face_name(data, off)
        label = " ".join(sorted({n for _, n in names}))
        print(idx, label)
        version, tables = read_face(data, off)
        ttf = build_ttf(version, tables)
        path = f"{out_prefix}-{idx}.ttf"
        with open(path, "wb") as f:
            f.write(ttf)
        print("  ->", path, len(ttf), "bytes")


if __name__ == "__main__":
    main()
