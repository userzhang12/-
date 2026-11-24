// Measurements are in the imported great-white-shark model's local coordinates.
export function createSharkJaw(three, shark, waterline) {
  const mouth = new three.Group();
  mouth.visible = false;
  shark.add(mouth);
  const lower = new three.Group();
  lower.position.set(0, -.025, 1.22);
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
  const shade = material('#20141b', .85);
  shade.emissive.set('#2e1820');
  shade.emissiveIntensity = .22;
  const skin = material('#82908e', .42);
  const upperArch = new three.CatmullRomCurve3([
    [-.49, .008, 1.43], [-.43, -.027, 1.78], [-.25, .027, 2.17],
    [0, .074, 2.29], [.25, .027, 2.17], [.43, -.027, 1.78], [.49, .008, 1.43],
  ].map(point => new three.Vector3(...point)));
  const lowerArch = new three.CatmullRomCurve3(upperArch.points.map(point =>
    new three.Vector3(point.x * .95, point.y - .06, point.z - .085).sub(lower.position),
  ));
  mouth.add(new three.Mesh(new three.TubeGeometry(upperArch, 40, .030, 8, false), gum));
  lower.add(new three.Mesh(new three.TubeGeometry(lowerArch, 40, .038, 9, false), skin));
  const innerLip = lowerArch.clone();
  innerLip.points.forEach(point => { point.x *= .95; point.y += .024; point.z -= .025; });
  lower.add(new three.Mesh(new three.TubeGeometry(innerLip, 40, .020, 8, false), gum));

  const jawSkin = new three.SphereGeometry(1, 36, 14);
  jawSkin.scale(.415, .092, .56);
  jawSkin.translate(0, -.128, .47);
  lower.add(new three.Mesh(jawSkin, skin));

  // A dark recessed surface connects the palate to the moving lower jaw.
  const cavity = new three.BufferGeometry();
  const cavityPositions = new three.BufferAttribute(new Float32Array(33 * 2 * 3), 3);
  cavity.setAttribute('position', cavityPositions);
  const indices = [];
  for (let i = 0; i < 32; i++) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
  cavity.setIndex(indices);

  const snout = new three.BufferGeometry();
  const snoutPositions = new Float32Array(33 * 2 * 3);
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const lip = upperArch.getPoint(t);
    snoutPositions.set([lip.x, lip.y, lip.z, lip.x * .99,
      lip.y + .11 + Math.sin(t * Math.PI) * .14, lip.z + .06], i * 6);
  }
  snout.setAttribute('position', new three.BufferAttribute(snoutPositions, 3));
  snout.setIndex(indices);
  snout.computeVertexNormals();
  mouth.add(new three.Mesh(snout, material('#374e57', .41)));
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
  for (const [parent, arch, bottom] of [[mouth, upperArch, false], [lower, innerLip, true]]) {
    const row = new three.InstancedMesh(tooth, enamel, 15);
    for (let index = 0; index < 15; index++) {
      const t = (index + .5) / 15;
      const point = arch.getPointAt(t);
      const tangent = arch.getTangentAt(t);
      toothTransform.position.copy(point);
      toothTransform.position.y += bottom ? .022 : -.028;
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
  for (const [parent, arch, bottom] of [[mouth, upperArch, false], [lower, innerLip, true]]) {
    const row = new three.InstancedMesh(tooth, enamel, 13);
    for (let index = 0; index < 13; index++) {
      const t = (index + .5) / 13;
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
  function setOpening(open) {
    mouth.visible = open > .025;
    if (!mouth.visible) return;
    lower.rotation.x = open * .87;
    for (let i = 0; i <= 32; i++) {
      const t = i / 32;
      const palate = upperArch.getPoint(t);
      lowerPoint.copy(lowerArch.getPoint(t)).applyEuler(lower.rotation).add(lower.position);
      const inset = .13 + Math.sin(t * Math.PI) * .23;
      cavityPositions.setXYZ(i * 2, palate.x * .96, palate.y + .016, palate.z - inset);
      cavityPositions.setXYZ(i * 2 + 1, lowerPoint.x * .96, lowerPoint.y - .014, lowerPoint.z - inset);
    }
    cavityPositions.needsUpdate = true;
    cavity.computeVertexNormals();
  }
  return setOpening;
}
