"""Generate deterministic, redistributable tiny format fixtures (no external assets)."""
from pathlib import Path
import json, struct, base64, math, zlib
out=Path(__file__).resolve().parent.parent/'public'/'samples'
out.mkdir(parents=True,exist_ok=True)
positions=[(-1,1,0),(1,1,0),(0,3,0)]
binary=b''.join(struct.pack('<3f',*p) for p in positions)
gltf={'asset':{'version':'2.0','generator':'TwoManyProjectors fixtures'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'name':'Triangle receiver','mesh':0}],'meshes':[{'primitives':[{'attributes':{'POSITION':0}}]}],'buffers':[{'uri':'triangle.bin','byteLength':len(binary)}],'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(binary)}],'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3','min':[-1,1,0],'max':[1,3,0]}]}
(out/'triangle.gltf').write_text(json.dumps(gltf))
(out/'triangle.bin').write_bytes(binary)
gltf['buffers'][0].pop('uri')
jb=json.dumps(gltf).encode();jb+=b' '*((-len(jb))%4)
glb=struct.pack('<III',0x46546c67,2,12+8+len(jb)+8+len(binary))+struct.pack('<II',len(jb),0x4e4f534a)+jb+struct.pack('<II',len(binary),0x004e4942)+binary
(out/'triangle.glb').write_bytes(glb)
# Two triangles with distinct material slots; positions are metres in glTF.
colored=dict(gltf)
colored['meshes']=[{'primitives':[
    {'attributes':{'POSITION':0},'material':0},
    {'attributes':{'POSITION':1},'material':1}]}]
colored['materials']=[{'name':name,'pbrMetallicRoughness':{'baseColorFactor':color,'metallicFactor':0}} for name,color in [('Red',[.8,.02,.01,1]),('Green',[.01,.8,.02,1])]]
colored['bufferViews']=[{'buffer':0,'byteOffset':i*len(binary),'byteLength':len(binary)} for i in range(2)]
colored['accessors']=[dict(gltf['accessors'][0],bufferView=i) for i in range(2)]
colored['accessors'][1].update(min=[2,1,0],max=[4,3,0])
colored_binary=binary+b''.join(struct.pack('<3f',x+3,y,z) for x,y,z in positions)
colored['buffers']=[{'byteLength':len(colored_binary)}]
jb=json.dumps(colored).encode();jb+=b' '*((-len(jb))%4)
(out/'two-tone.glb').write_bytes(struct.pack('<III',0x46546c67,2,12+8+len(jb)+8+len(colored_binary))+struct.pack('<II',len(jb),0x4e4f534a)+jb+struct.pack('<II',len(colored_binary),0x004e4942)+colored_binary)
(out/'triangle.obj').write_text('mtllib triangle.mtl\no Triangle\nv -1 1 0\nv 1 1 0\nv 0 3 0\nvt 0 0\nvt 1 0\nvt .5 1\nusemtl screen\nf 1/1 2/2 3/3\n')
(out/'triangle.mtl').write_text('newmtl screen\nKd 1 1 1\nmap_Kd white.png\n')
def png_chunk(kind,data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
(out/'white.png').write_bytes(b'\x89PNG\r\n\x1a\n'+png_chunk(b'IHDR',struct.pack('>IIBBBBB',16,16,8,2,0,0,0))+png_chunk(b'IDAT',zlib.compress((b'\x00'+b'\xff\xff\xff'*16)*16))+png_chunk(b'IEND',b''))
(out/'triangle.stl').write_text('solid triangle\nfacet normal 0 0 1\nouter loop\nvertex -1 1 0\nvertex 1 1 0\nvertex 0 3 0\nendloop\nendfacet\nendsolid triangle\n')
(out/'mesh.ply').write_text('ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n-1 1 0\n1 1 0\n0 3 0\n3 0 1 2\n')
points=[(x/10-1, y/10+1, 0) for y in range(21) for x in range(21)]
xyz=''.join(f'{x} {y} {z} 180 200 220\n' for x,y,z in points)
(out/'cloud.xyz').write_text(xyz)
head=f'ply\nformat ascii 1.0\nelement vertex {len(points)}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n'
(out/'cloud.ply').write_text(head+xyz)
(out/'cloud.pcd').write_text(f'# .PCD v0.7\nVERSION 0.7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\nWIDTH {len(points)}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS {len(points)}\nDATA ascii\n'+''.join(f'{x} {y} {z}\n' for x,y,z in points))
splat=b''.join(struct.pack('<6f8B',x,y,z,.055,.055,.005,180,200,220,255,255,128,128,128) for x,y,z in points)
(out/'scan.splat').write_bytes(splat)
props=['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3']
head=f'ply\nformat ascii 1.0\nelement vertex {len(points)}\n'+''.join(f'property float {p}\n' for p in props)+'end_header\n'
(out/'gaussian.ply').write_text(head+''.join(f'{x} {y} {z} 1 1 1 5 {math.log(.055)} {math.log(.055)} {math.log(.005)} 1 0 0 0\n' for x,y,z in points))
(out/'malformed.ply').write_text('ply\nformat ascii 1.0\nelement vertex 3\n')
print('Generated',len(list(out.iterdir())),'sample files')
