"""Add the jaw morph and swim rig to the CC0 great-white-shark GLB (see NOTICE)."""
import json
import math
from pathlib import Path
import struct


def smooth(lo, hi, value):
    t = max(0, min(1, (value - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)


def opened_vertex(x, y, z):
    # The nose stays fixed; only the lower cheek and mandible follow the hinge.
    lower_cheek = 1 - smooth(-.23, .11, y)
    weight = lower_cheek * smooth(1.03, 1.76, z) * (1 - smooth(2.18, 2.53, z))
    angle = .77 * weight
    hinge_y, hinge_z = -.025, 1.22
    arm_y, arm_z = y - hinge_y, z - hinge_z
    return (x, math.cos(angle) * arm_y - math.sin(angle) * arm_z + hinge_y,
            math.sin(angle) * arm_y + math.cos(angle) * arm_z + hinge_z)


def vertex_normals(points, triangles):
    sums = [[0.0, 0.0, 0.0] for _ in points]
    for a, b, c in triangles:
        x, y, z = (points[b][i] - points[a][i] for i in range(3))
        u, v, w = (points[c][i] - points[a][i] for i in range(3))
        cross = (y * w - z * v, z * u - x * w, x * v - y * u)
        for index in (a, b, c):
            for axis in range(3):
                sums[index][axis] += cross[axis]
    return [tuple(axis / (math.hypot(*entry) or 1) for axis in entry) for entry in sums]


def add_swim_rig(model, mesh_node, primitive, points, append_view):
    spine = [('SwimRoot', .55), ('SwimBody', -.38), ('SwimBack', -1.14),
             ('SwimPeduncle', -1.93), ('SwimTail', -2.42)]
    nodes = model['nodes']
    root = len(nodes)
    joints = list(range(root, root + len(spine)))
    for i, (name, position) in enumerate(spine):
        previous = spine[i - 1][1] if i else 0
        node = {'name': name, 'translation': [0, 0, position - previous]}
        if i + 1 < len(spine):
            node['children'] = [joints[i + 1]]
        nodes.append(node)
    model['scenes'][model.get('scene', 0)]['nodes'].append(root)

    joint_data, weight_data = bytearray(), bytearray()
    for _, _, z in points:
        right = next((i for i in range(1, len(spine)) if z >= spine[i][1]), len(spine) - 1)
        left = right - 1
        toward_tail = round(255 * (1 - smooth(spine[right][1], spine[left][1], z)))
        joint_data.extend((left, right, 0, 0))
        weight_data.extend((255 - toward_tail, toward_tail, 0, 0))

    def accessor(data, component, count, shape, normalized=False):
        view = append_view(data)
        result = len(model['accessors'])
        entry = {'bufferView': view, 'componentType': component, 'count': count, 'type': shape}
        if normalized:
            entry['normalized'] = True
        model['accessors'].append(entry)
        return result

    attributes = primitive['attributes']
    attributes['JOINTS_0'] = accessor(joint_data, 5121, len(points), 'VEC4')
    attributes['WEIGHTS_0'] = accessor(weight_data, 5121, len(points), 'VEC4', normalized=True)
    matrices = b''.join(struct.pack('<16f', 1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-z,1)
                        for _, z in spine)
    inverse_bind = accessor(matrices, 5126, len(spine), 'MAT4')
    mesh_node['skin'] = 0
    model['skins'] = [{'name': 'SharkSpine', 'skeleton': root, 'joints': joints,
                       'inverseBindMatrices': inverse_bind}]


def bake(path):
    data = path.read_bytes()
    magic, version, _ = struct.unpack_from('<4sII', data)
    assert magic == b'glTF' and version == 2
    json_length = struct.unpack_from('<I', data, 12)[0]
    model = json.loads(data[20:20 + json_length])
    payload = bytearray(data[28 + json_length:])
    mesh = model['meshes'][0]
    primitive = mesh['primitives'][0]
    targets = primitive.setdefault('targets', [{}])
    target = targets[0]
    mesh_node = next(node for node in model['nodes'] if node.get('mesh') == 0)
    if 'NORMAL' in target and 'POSITION' in target and 'skin' in mesh_node:
        return

    def read_accessor(index, layout):
        accessor = model['accessors'][index]
        view = model['bufferViews'][accessor['bufferView']]
        offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        length = struct.calcsize(layout) * accessor['count']
        return list(struct.iter_unpack(layout, payload[offset:offset + length]))

    points = read_accessor(primitive['attributes']['POSITION'], '<fff')
    opened = [opened_vertex(*point) for point in points]
    index_type = model['accessors'][primitive['indices']]['componentType']
    indices = [index for (index,) in read_accessor(primitive['indices'], {5123: '<H', 5125: '<I'}[index_type])]
    triangles = list(zip(indices[::3], indices[1::3], indices[2::3]))
    original_normals = vertex_normals(points, triangles)
    opened_normals = vertex_normals(opened, triangles)

    def append_view(data):
        payload.extend(b'\0' * (-len(payload) % 4))
        view = len(model['bufferViews'])
        model['bufferViews'].append({'buffer': 0, 'byteOffset': len(payload), 'byteLength': len(data)})
        payload.extend(data)
        return view

    def add_delta(values):
        deltas = []
        for index, (base, changed) in enumerate(values):
            delta = tuple(b - a for a, b in zip(base, changed))
            if max(map(abs, delta)) > 1e-6:
                deltas.append((index, delta))
        indices_view = append_view(b''.join(struct.pack('<H', index) for index, _ in deltas))
        values_view = append_view(b''.join(struct.pack('<fff', *delta) for _, delta in deltas))
        bounds = list(zip((0, 0, 0), *(delta for _, delta in deltas)))
        accessor = len(model['accessors'])
        model['accessors'].append({
            'componentType': 5126, 'count': len(points), 'type': 'VEC3',
            'min': [min(axis) for axis in bounds], 'max': [max(axis) for axis in bounds],
            'sparse': {
                'count': len(deltas),
                'indices': {'bufferView': indices_view, 'componentType': 5123},
                'values': {'bufferView': values_view},
            },
        })
        return accessor

    if 'POSITION' not in target:
        target['POSITION'] = add_delta(zip(points, opened))
    if 'NORMAL' not in target:
        target['NORMAL'] = add_delta(zip(original_normals, opened_normals))
    mesh['weights'] = [0]
    mesh.setdefault('extras', {})['targetNames'] = ['JawOpen']
    if 'skin' not in mesh_node:
        add_swim_rig(model, mesh_node, primitive, points, append_view)
    model['buffers'][0]['byteLength'] = len(payload)
    metadata = json.dumps(model, separators=(',', ':')).encode()
    metadata += b' ' * (-len(metadata) % 4)
    path.write_bytes(struct.pack('<4sII', magic, version, 28 + len(metadata) + len(payload))
        + struct.pack('<I4s', len(metadata), b'JSON') + metadata
        + struct.pack('<I4s', len(payload), b'BIN\0') + payload)


if __name__ == '__main__':
    bake(Path(__file__).resolve().parents[1] / 'web/public/great-white-shark.glb')
