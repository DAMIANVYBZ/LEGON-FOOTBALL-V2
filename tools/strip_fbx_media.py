"""Remove embedded image payloads from Mixamo FBX animation copies.

The originals are never modified. Geometry, skeleton, and animation nodes remain.
"""
from pathlib import Path
import mmap
import struct
import sys

source = Path(sys.argv[1])
target = Path(sys.argv[2])
target.parent.mkdir(parents=True, exist_ok=True)

with source.open('rb') as handle, mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as data:
    version = struct.unpack_from('<I',data,23)[0]
    wide = version >= 7500
    header = struct.Struct('<QQQB' if wide else '<IIIB')
    null_len = 25 if wide else 13
    removed = 0

    def node(input_pos, output_pos, parent=''):
        global removed
        end, num_props, prop_len, name_len = header.unpack_from(data,input_pos)
        if end == 0:
            return b'\0'*null_len, input_pos+null_len
        name_pos = input_pos+header.size
        name_bytes = data[name_pos:name_pos+name_len]
        name = name_bytes.decode('utf-8','replace')
        prop_pos = name_pos+name_len
        props = data[prop_pos:prop_pos+prop_len]
        if parent == 'Video' and name == 'Content' and props[:1] == b'R':
            old_size = struct.unpack_from('<I',props,1)[0]
            props = b'R'+struct.pack('<I',0)
            removed += old_size
        parts=[]
        child_input=prop_pos+prop_len
        child_output=output_pos+header.size+name_len+len(props)
        while child_input < end:
            chunk,child_input=node(child_input,child_output,name)
            parts.append(chunk)
            child_output += len(chunk)
        if child_input != end:
            raise ValueError(f'Unaligned node {name}: {child_input} vs {end}')
        packed_header=header.pack(child_output,num_props,len(props),name_len)
        return packed_header+name_bytes+props+b''.join(parts),end

    output=bytearray(data[:27])
    pos=27
    while pos+null_len <= len(data):
        chunk,next_pos=node(pos,len(output))
        output.extend(chunk)
        pos=next_pos
        if chunk==b'\0'*null_len:
            break
    output.extend(data[pos:])
    target.write_bytes(output)
    print(f'{source.name}: {len(data):,} -> {len(output):,} bytes; removed {removed:,} image bytes')
