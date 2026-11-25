"""Generate the original Jingxu great white body, fins and facial detail as a rigged GLB."""
import json
import math
from pathlib import Path
import struct

from importlib import import_module

rig = import_module("bake-shark-model")

# Head faces +Z. Section data runs from the tail root to the rostrum.
SECTIONS = [
    (-2.44, .035, .07, .025), (-2.24, .105, .14, .015),
    (-1.88, .20, .23, .00), (-1.40, .335, .38, .025),
    (-.78, .49, .54, .04), (-.10, .59, .65, .06),
    (.62, .64, .65, .035), (1.15, .63, .56, .015),
    (1.54, .61, .49, .015), (1.85, .53, .39, .065),
    (2.12, .425, .28, .115), (2.37, .265, .15, .145),
    (2.49, .115, .073, .145), (2.53, .006, .006, .138),
]


def mix(a, b, t):
    return a + (b - a) * t


def sample(rows, value):
    i = next((i for i in range(len(rows) - 1) if value <= rows[i + 1][0]), len(rows) - 2)
    left, right = rows[i], rows[i + 1]
    prev, after = rows[max(0, i - 1)], rows[min(len(rows) - 1, i + 2)]
    length = right[0] - left[0]
    t = (value - left[0]) / length
    result = []
    for axis in range(1, len(left)):
        a, b = left[axis], right[axis]
        m0 = (b - prev[axis]) / (right[0] - prev[0])
        m1 = (after[axis] - a) / (after[0] - left[0])
        result.append(mix(a, b, t * t * (3 - 2 * t)) + length * t * (1 - t) * ((1 - t) * m0 - t * m1))
    return result


def surface(z, theta):
    w, h, y = sample(SECTIONS, z)
    s, c = math.sin(theta), math.cos(theta)
    return w * c, y + h * s * (1.0 if s > 0 else .81), z


def skin_color(x, y, z, belly):
    boundary = -.20 + .045 * math.sin(z * 4.1) + .023 * math.sin(z * 12.7 + x * 8)
    pale = 1 - rig.smooth(boundary - .095, boundary + .085, belly)
    dorsal = rig.smooth(.14, .96, belly)
    variation = .92 + .065 * math.sin(x * 21 + z * 15 + math.sin(y * 19)) + .04 * math.sin(z * 16.9 - x * 11)
    slate = (.155 - dorsal * .075, .225 - dorsal * .105, .248 - dorsal * .115)
    return tuple(max(0, min(255, round(mix(a * variation, b, pale) * 255)))
                 for a, b in zip(slate, (.72, .74, .69)))


class Surface:
    def __init__(self):
        self.points, self.colors, self.triangles = [], [], []

    def loft(self, rows, columns, point):
        first = len(self.points)
        for row in range(rows):
            for col in range(columns):
                xyz, tint = point(row / (rows - 1), math.tau * col / columns)
                self.points.append(xyz)
                self.colors.append(tint)
        for row in range(rows - 1):
            for col in range(columns):
                a = first + row * columns + col
                b = first + row * columns + (col + 1) % columns
                self.triangles.extend(((a, b, a + columns), (b, b + columns, a + columns)))


def body_point(z, angle):
    x, y, _ = surface(z, angle)
    belly = math.sin(angle)
    side = abs(math.cos(angle))
    theta = math.asin(belly)
    opening = 0
    ridge = 0
    if .58 < z < 1.47 and -.72 < theta < .62:
        for index in range(5):
            length = rig.smooth(-.70 + .018 * index, -.56 + .018 * index, theta) * (
                1 - rig.smooth(.30 - .027 * index, .58 - .027 * index, theta))
            center = 1.30 - .136 * index + .11 * (theta + .08) ** 2
            offset = z - center
            opening += length * math.exp(-(offset / .015) ** 2)
            ridge += length * math.exp(-((offset + .025) / .023) ** 2)
    x *= 1 + .036 * ridge - .052 * opening
    tint = skin_color(x, y, z, belly)
    tint = tuple(round(channel * (1 - .76 * min(1, opening) * side)) for channel in tint)

    return (x, y, z), tint


def fin(mesh, curve, span, side=1, pale=False):
    def point(t, angle):
        x, y, z, chord, thickness = sample(curve, t)
        thickness = max(.002, thickness)
        chord = max(.003, chord)
        x += span[0] * thickness * math.cos(angle)
        y += span[1] * thickness * math.cos(angle)
        z += chord * math.sin(angle)
        xyz = (x * side, y, z)
        soft = rig.smooth(-.7, .5, math.cos(angle)) if pale else 0
        tone = tuple(round(mix(a, b, soft) * (1 - .20 * t))
                     for a, b in zip((41, 60, 66), (151, 156, 147)))
        return xyz, tone

    start = len(mesh.triangles)
    mesh.loft(34, 32, point)
    # Choose outward winding from the mid-span triangles and the local section center.
    mid = start + 15 * 64
    a, b, c = (mesh.points[index] for index in mesh.triangles[mid])
    center = sample(curve, 15 / 33)[:3]
    center[0] *= side
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
    if sum(n * (x - o) for n, x, o in zip(normal, a, center)) < 0:
        mesh.triangles[start:] = [(a, c, b) for a, b, c in mesh.triangles[start:]]


def facial_detail(mesh):
    for side in (-1, 1):
        # A convex, nearly black eye with a subtle blue-grey limbus.
        z0, theta0 = 1.92, .265
        def eye(t, angle):
            r = max(.001, t)
            z = z0 + .096 * r * math.cos(angle)
            theta = theta0 + .213 * r * math.sin(angle)
            x, y, _ = surface(z, theta)
            edge = rig.smooth(.72, 1, r)
            hue = tuple(round(mix(a, b, edge)) for a, b in zip((4, 8, 10), (37, 51, 55)))
            return (side * (x + .003 + .021 * (1 - r * r)), y, z), hue
        start = len(mesh.triangles)
        mesh.loft(11, 28, eye)
        if side < 0:
            mesh.triangles[start:] = [(a, c, b) for a, b, c in mesh.triangles[start:]]

        # Small nostril groove on the underside of each side of the rostrum.
        def nostril(t, angle):
            r = max(.001, t)
            z = 2.31 + .057 * r * math.cos(angle)
            theta = -.33 + .11 * r * math.sin(angle)
            x, y, _ = surface(z, theta)
            edge = rig.smooth(.42, 1, r)
            skin = skin_color(x, y, z, math.sin(theta))
            color = tuple(round(mix(dark, light, edge)) for dark, light in zip((21, 31, 34), skin))
            return (side * (x + .004), y, z), color
        start = len(mesh.triangles)
        mesh.loft(7, 22, nostril)
        if side < 0:
            mesh.triangles[start:] = [(a, c, b) for a, b, c in mesh.triangles[start:]]


def mouth_z(angle):
    belly = max(0, -math.sin(angle))
    return 1.29 + 1.04 * belly ** .86


def articulate(point, amount):
    x, y, z = point
    hinge_y, hinge_z = -.045, 1.28
    arm_y, arm_z = y - hinge_y, z - hinge_z
    angle = .91 * amount
    return (x, hinge_y + math.cos(angle) * arm_y - math.sin(angle) * arm_z,
            hinge_z + math.sin(angle) * arm_y + math.cos(angle) * arm_z)


def add_body(mesh):
    # Duplicate the lip ring so its upper and lower edges can separate without overlap.
    back_rows, columns = 194, 104
    mesh.loft(back_rows, columns, lambda t, angle: body_point(mix(SECTIONS[0][0], mouth_z(angle), t), angle))
    mesh.opened = []
    for index, point in enumerate(mesh.points):
        z = point[2]
        angle = math.tau * (index % columns) / columns
        underside = rig.smooth(.0, .42, -math.sin(angle))
        amount = underside * rig.smooth(1.01, 1.36, z)
        mesh.opened.append(articulate(point, amount))
    mesh.loft(56, columns, lambda t, angle: body_point(mix(mouth_z(angle), SECTIONS[-1][0], t), angle))
    mesh.seam = [((back_rows - 1) * columns + col, back_rows * columns + col)
                 for col in range(columns)]
    mesh.mouth_seam = [body_point(mouth_z(angle), angle)[0]
                       for angle in (math.pi + math.pi * i / 32 for i in range(33))]


def build_mesh():
    mesh = Surface()
    add_body(mesh)
    fin(mesh, [(0, 0, .42, .10, .66, .17), (.32, 0, .84, .00, .52, .12),
               (.67, 0, 1.27, -.19, .30, .063), (1, 0, 1.61, -.39, .004, .002)], (1, 0))
    fin(mesh, [(0, 0, .20, -1.63, .26, .069), (.52, 0, .38, -1.75, .19, .038),
               (1, 0, .53, -1.89, .003, .002)], (1, 0))
    fin(mesh, [(0, 0, -.11, -1.70, .21, .056), (.55, 0, -.28, -1.80, .14, .028),
               (1, 0, -.39, -1.95, .003, .002)], (1, 0), pale=True)
    for side in (-1, 1):
        fin(mesh, [(0, .46, -.23, .51, .53, .14), (.33, .89, -.34, .18, .44, .09),
                   (.67, 1.33, -.52, -.28, .31, .047), (1, 1.72, -.72, -.84, .009, .003)],
            (-.24, -.97), side, pale=True)
        fin(mesh, [(0, .28, -.22, -1.07, .34, .09), (.55, .53, -.33, -1.29, .21, .046),
                   (1, .78, -.49, -1.51, .004, .002)], (-.16, -.98), side, pale=True)
    fin(mesh, [(0, 0, -.03, -2.24, .23, .109), (.30, 0, .40, -2.44, .24, .079),
               (.67, 0, .84, -2.74, .17, .042), (1, 0, 1.27, -3.02, .004, .002)], (1, 0))
    fin(mesh, [(0, 0, .01, -2.26, .22, .106), (.36, 0, -.30, -2.42, .22, .075),
               (.71, 0, -.65, -2.65, .15, .039), (1, 0, -.94, -2.91, .004, .002)], (1, 0), pale=True)
    facial_detail(mesh)
    return mesh


def serialize(mesh, path):
    payload = bytearray()
    model = {"asset": {"version": "2.0", "generator": "Jingxu Shark Builder"},
             "scene": 0, "scenes": [{"nodes": [0], "extras": {"mouthSeam": mesh.mouth_seam}}], "nodes": [{"name": "GreatWhite", "mesh": 0}],
             "meshes": [{"primitives": []}], "buffers": [{}], "bufferViews": [], "accessors": [],
             "materials": [{"name": "Great white skin", "doubleSided": True,
                            "pbrMetallicRoughness": {"metallicFactor": 0, "roughnessFactor": .46}}]}

    def add(values, fmt, component, shape, bounds=False, normalized=False):
        payload.extend(b"\0" * (-len(payload) % 4))
        data = b"".join(struct.pack(fmt, *row) for row in values)
        view = len(model["bufferViews"])
        model["bufferViews"].append({"buffer": 0, "byteOffset": len(payload), "byteLength": len(data)})
        payload.extend(data)
        entry = {"bufferView": view, "componentType": component, "count": len(values), "type": shape}
        if normalized:
            entry["normalized"] = True
        if bounds:
            entry["min"] = [min(axis) for axis in zip(*values)]
            entry["max"] = [max(axis) for axis in zip(*values)]
        model["accessors"].append(entry)
        return len(model["accessors"]) - 1

    attrs = {
        "POSITION": add(mesh.points, "<fff", 5126, "VEC3", bounds=True),
        "NORMAL": add(rig.smooth_seam(rig.vertex_normals(mesh.points, mesh.triangles), mesh.points, mesh.seam),
                      "<fff", 5126, "VEC3"),
        "COLOR_0": add(mesh.colors, "<BBB", 5121, "VEC3", normalized=True),
    }
    indices = [(index,) for tri in mesh.triangles for index in tri]
    model["meshes"][0]["primitives"].append(
        {"attributes": attrs, "indices": add(indices, "<H", 5123, "SCALAR"), "material": 0})
    model["buffers"][0]["byteLength"] = len(payload)
    meta = json.dumps(model, separators=(",", ":")).encode()
    meta += b" " * (-len(meta) % 4)
    payload.extend(b"\0" * (-len(payload) % 4))
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, 28 + len(meta) + len(payload))
                     + struct.pack("<I4s", len(meta), b"JSON") + meta
                     + struct.pack("<I4s", len(payload), b"BIN\0") + payload)
    rig.bake(path, mesh.opened + mesh.points[len(mesh.opened):], mesh.seam)


if __name__ == "__main__":
    serialize(build_mesh(), Path(__file__).resolve().parents[1] / "web/public/great-white-shark.glb")
