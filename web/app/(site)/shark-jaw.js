// Measurements are in the imported great-white-shark model's local coordinates.
export function createSharkJaw(three, shark, waterline) {
  const mouth = new three.Group();
  mouth.visible = false;
  shark.add(mouth);
  const upper = new three.Group();
  mouth.add(upper);
  const lower = new three.Group();
  lower.position.set(0, -.045, 1.28);
  mouth.add(lower);
  const material = (color, roughness) => new three.MeshStandardMaterial({
    color, roughness, side: three.DoubleSide, clippingPlanes: [waterline],
  });
  const enamel = new three.MeshPhysicalMaterial({
    color: '#f0e5cc', roughness: .29, clearcoat: .24, clearcoatRoughness: .29,
    side: three.DoubleSide, clippingPlanes: [waterline],
  });
  const gum = new three.MeshPhysicalMaterial({
    color: '#3a3037', roughness: .54, clearcoat: .20, clearcoatRoughness: .38,
    side: three.DoubleSide, clippingPlanes: [waterline],
  });
  const shade = material('#ffffff', .78);
  shade.vertexColors = true;
  // The GLB supplies the exact two coincident seam edges. Teeth are seated just inside them.
  const seam = shark.userData.mouthSeam;
  const upperArch = new three.CatmullRomCurve3(seam.map(([x, y, z]) =>
    new three.Vector3(x * .949, y + .012, z - .032)));
  const lowerArch = new three.CatmullRomCurve3(seam.map(([x, y, z]) =>
    new three.Vector3(x * .92, y - .008, z - .055).sub(lower.position)));
  const innerLip = lowerArch.clone();
  innerLip.points.forEach(point => { point.x *= .965; point.y += .012; point.z -= .020; });
  upper.add(new three.Mesh(new three.TubeGeometry(upperArch, 52, .014, 8, false), gum));
  lower.add(new three.Mesh(new three.TubeGeometry(innerLip, 52, .015, 8, false), gum));

  // A dark recessed surface connects the palate to the moving lower jaw.
  const cavity = new three.BufferGeometry();
  const cavityRows = 10;
  const cavityPositions = new three.BufferAttribute(new Float32Array(33 * (cavityRows + 1) * 3), 3);
  const cavityColors = [];
  const throat = new three.Color('#140c11');
  const rim = new three.Color('#52343e');
  const tint = new three.Color();
  cavity.setAttribute('position', cavityPositions);
  const indices = [];
  for (let row = 0; row <= cavityRows; row++) {
    for (let index = 0; index <= 32; index++) {
      const depth = Math.sin(Math.PI * row / cavityRows);
      const side = Math.abs(index / 16 - 1);
      const strength = Math.min(1, (1 - depth) * .68 + side ** 3 * .46);
      tint.copy(throat).lerp(rim, strength).multiplyScalar(1 + .17 * Math.sin(index * .83 + row * 3.5));
      cavityColors.push(tint.r, tint.g, tint.b);
      if (row && index) {
        const current = row * 33 + index;
        indices.push(current - 34, current - 1, current - 33, current - 33, current - 1, current);
      }
    }
  }
  cavity.setAttribute('color', new three.Float32BufferAttribute(cavityColors, 3));
  cavity.setIndex(indices);
  const interior = new three.Mesh(cavity, shade);
  interior.frustumCulled = false;
  mouth.add(interior);

  // Flattened tooth meshes taper to a point and lean inward along the arch.
  const tooth = new three.BufferGeometry();
  tooth.setAttribute('position', new three.Float32BufferAttribute([
    -.049, 0, 0, .049, 0, 0, .026, -.071, -.018, .002, -.152, -.036,
    -.026, -.071, -.018, 0, -.026, .027, 0, -.028, -.025,
  ], 3));
  tooth.setIndex([0,1,5,1,2,5,2,3,5,3,4,5,4,0,5,0,4,6,4,3,6,3,2,6,2,1,6,1,0,6]);
  tooth.computeVertexNormals();
  const toothTransform = new three.Object3D();
  const toothTint = new three.Color();
  for (const [parent, arch, bottom] of [[upper, upperArch, false], [lower, innerLip, true]]) {
    const row = new three.InstancedMesh(tooth, enamel, 15);
    for (let index = 0; index < 15; index++) {
      const t = .10 + .80 * (index + .5) / 15;
      const point = arch.getPointAt(t);
      const tangent = arch.getTangentAt(t);
      toothTransform.position.copy(point);
      toothTransform.position.y += bottom ? .005 : -.009;
      toothTransform.rotation.set(0, Math.atan2(-tangent.z, tangent.x), 0);
      if (bottom) toothTransform.rotateZ(Math.PI);
      toothTransform.scale.setScalar((.70 + .31 * Math.sin(t * Math.PI)) * (bottom ? .76 : .92) * (.94 + .11 * Math.sin(index * 3.4)));
      toothTransform.updateMatrix();
      row.setMatrixAt(index, toothTransform.matrix);
      toothTint.setRGB(.84 + .12 * Math.sin(t * Math.PI), .87 + .09 * Math.sin(t * Math.PI), .91);
      row.setColorAt(index, toothTint);
    }
    parent.add(row);
  }

  // The inner rows sit just behind the working teeth and remain visible in the open bite.
  for (const [parent, arch, bottom] of [[upper, upperArch, false], [lower, innerLip, true]]) {
    const row = new three.InstancedMesh(tooth, enamel, 13);
    for (let index = 0; index < 13; index++) {
      const t = .13 + .74 * (index + .5) / 13;
      const point = arch.getPointAt(t);
      const tangent = arch.getTangentAt(t);
      toothTransform.position.set(point.x * .83, point.y + (bottom ? .006 : -.004), point.z - .075);
      toothTransform.rotation.set(0, Math.atan2(-tangent.z, tangent.x), bottom ? Math.PI : 0);
      toothTransform.scale.setScalar(.54 + .14 * Math.sin(t * Math.PI));
      toothTransform.updateMatrix();
      row.setMatrixAt(index, toothTransform.matrix);
    }
    parent.add(row);
  }

  const lowerPoint = new three.Vector3();
  const palate = new three.Vector3();
  function setOpening(open) {
    mouth.visible = open > .025;
    if (!mouth.visible) return;
    // Match the mesh's linear morph between the closed and fully rotated seam.
    const sine = open * Math.sin(.91);
    const cosine = 1 - open + open * Math.cos(.91);
    lower.rotation.x = Math.atan2(sine, cosine);
    const scale = Math.hypot(sine, cosine);
    lower.scale.set(1, scale, scale);

    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      palate.copy(upperArch.getPoint(t));
      lowerPoint.copy(lowerArch.getPoint(t)).multiply(lower.scale).applyEuler(lower.rotation).add(lower.position);
      const center = Math.sin(t * Math.PI);
      for (let row = 0; row <= cavityRows; row++) {
        const height = row / cavityRows;
        const depth = Math.sin(height * Math.PI);
        const inset = .053 + center * (.09 + .24 * depth);
        cavityPositions.setXYZ(row * 33 + i,
          three.MathUtils.lerp(palate.x, lowerPoint.x, height) * (1 - .12 * depth),
          three.MathUtils.lerp(palate.y + .015, lowerPoint.y - .018, height),
          three.MathUtils.lerp(palate.z, lowerPoint.z, height) - inset);
      }
    }
    cavityPositions.needsUpdate = true;
    cavity.computeVertexNormals();
  }
  return setOpening;
}
