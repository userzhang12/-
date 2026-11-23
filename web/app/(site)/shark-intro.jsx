'use client';

import { useEffect, useRef } from 'react';
import { animate } from 'motion';

function makeShark(three) {
  const { Group, Mesh, BufferGeometry, Float32BufferAttribute, MeshStandardMaterial,
    MeshBasicMaterial, SphereGeometry, Shape, ExtrudeGeometry, DoubleSide, Color } = three;
  const shark = new Group();
  const skin = new MeshStandardMaterial({ vertexColors: true, roughness: 0.44, metalness: 0.07, side: DoubleSide });
  const finSkin = new MeshStandardMaterial({ color: '#476978', roughness: 0.49, side: DoubleSide });
  const rings = [
    [-2.25, .09, .12, .05], [-1.82, .17, .19, .06], [-1.27, .35, .3, .035],
    [-.65, .53, .46, .015], [0, .64, .55, 0], [.62, .65, .52, .01],
    [1.15, .58, .42, .04], [1.57, .45, .30, .08], [1.89, .29, .19, .12],
    [2.09, .13, .10, .14], [2.15, .005, .005, .14],
  ];
  const positions = [], colors = [], indices = [];
  const top = new Color('#436575'), underside = new Color('#ddded2');
  const sides = 40;
  rings.forEach(([z, width, height, offset], ring) => {
    for (let point = 0; point < sides; point++) {
      const angle = point / sides * Math.PI * 2;
      const vertical = Math.sin(angle);
      positions.push(Math.cos(angle) * width, vertical * height + offset, z);
      const blend = three.MathUtils.smoothstep(vertical, -.65, .04);
      colors.push(...underside.clone().lerp(top, blend).toArray());
      if (ring) {
        const a = ring * sides + point, b = ring * sides + (point + 1) % sides;
        indices.push(a - sides, b, a, a - sides, b - sides, b);
      }
    }
  });
  const body = new BufferGeometry();
  body.setAttribute('position', new Float32BufferAttribute(positions, 3));
  body.setAttribute('color', new Float32BufferAttribute(colors, 3));
  body.setIndex(indices);
  body.computeVertexNormals();
  shark.add(new Mesh(body, skin));

  function fin(parent, outline, side = 1) {
    const shape = new Shape();
    shape.moveTo(...outline[0]);
    for (const point of outline.slice(1)) shape.lineTo(...point);
    shape.closePath();
    const geometry = new ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelSize: 0.024, bevelThickness: 0.024, bevelSegments: 2 });
    const mesh = new Mesh(geometry, finSkin);
    if (side === 0) mesh.rotation.y = -Math.PI / 2;
    else {
      mesh.rotation.x = Math.PI / 2;
      mesh.scale.x = side;
      mesh.position.y = -.21;
    }
    parent.add(mesh);
  }
  fin(shark, [[-.64,.42],[-.49,.82],[-.43,1.32],[-.01,.97],[.31,.51]], 0);
  for (const side of [-1, 1]) {
    fin(shark, [[.4,.55],[.86,.03],[1.54,-.78],[1.14,-.62],[.48,-.36]], side);
  }
  const tail = new Group();
  tail.position.z = -2.18;
  fin(tail, [[.16,.0],[-.46,.84],[-.89,1.10],[-.62,.36],[-.35,-.04],[-.75,-.65],[-.79,-.85],[-.40,-.64],[.16,-.09]], 0);
  shark.add(tail);

  const eye = new MeshBasicMaterial({ color: '#07151c' });
  const shine = new MeshBasicMaterial({ color: '#d3e2dd' });
  const gillSkin = new MeshStandardMaterial({ color: '#263f4b', roughness: 0.68 });
  const eyeGeometry = new SphereGeometry(.058, 12, 8);
  const shineGeometry = new SphereGeometry(.014, 8, 6);
  for (const side of [-1, 1]) {
    const pupil = new Mesh(eyeGeometry, eye);
    pupil.position.set(.482 * side, .132, 1.37);
    shark.add(pupil);
    const glint = new Mesh(shineGeometry, shine);
    glint.position.set(.528 * side, .156, 1.387);
    shark.add(glint);
    for (let slit = 0; slit < 4; slit++) {
      const z = .94 - slit * .13;
      const curve = new three.CatmullRomCurve3([
        new three.Vector3(.565 * side, .185, z - .025),
        new three.Vector3(.625 * side, .067, z),
        new three.Vector3(.624 * side, -.064, z + .006),
        new three.Vector3(.577 * side, -.173, z + .045),
      ]);
      shark.add(new Mesh(new three.TubeGeometry(curve, 10, .01, 5, false), gillSkin));
    }
  }

  const mouth = new three.CatmullRomCurve3([
    [-.48,-.15,1.38],[-.40,-.185,1.57],[-.22,-.118,1.84],
    [0,-.07,1.94],[.22,-.118,1.84],[.40,-.185,1.57],[.48,-.15,1.38],
  ].map(point => new three.Vector3(...point)));
  shark.add(new Mesh(new three.TubeGeometry(mouth, 32, .016, 6, false), eye));
  return { shark, tail };
}

function rebound(hero) {
  const strength = hero.clientWidth < 600 ? .62 : 1;
  const targets = [
    ['.site-hero-preview', 13, 7, -.85, -.015, 0],
    ['.site-hero-copy', -6, 3, .24, 0, .055],
    ['.site-hero-actions', -3, 3, 0, 0, .105],
  ];

  const cancel = targets.map(([selector, x, y, rotation, scale, delay]) => {
    const element = hero.querySelector(selector);
    if (!element) return () => {};
    let stopped = false;
    let release;
    function draw(amount) {
      const value = amount * strength;
      element.style.transform = `translate3d(${x * value}px, ${y * value}px, 0) rotate(${rotation * value}deg) scale(${1 + scale * value})`;
    }
    const push = animate(0, 1, {
      delay,
      duration: .105,
      ease: 'easeOut',
      onUpdate: draw,
      onComplete: () => {
        if (stopped) return;
        release = animate(1, 0, {
          type: 'spring',
          stiffness: 255,
          damping: 21,
          mass: .85,
          onUpdate: draw,
          onComplete: () => element.style.removeProperty('transform'),
        });
      },
    });
    return () => {
      stopped = true;
      push.stop();
      release?.stop();
      element.style.removeProperty('transform');
    };
  });

  return () => cancel.forEach(stop => stop());
}

function playIntro(three, canvas, onPass) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const hero = canvas.parentElement;
  if (motion.matches || hero.getBoundingClientRect().bottom < innerHeight * .65) return;
  let renderer;
  try {
    renderer = new three.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    return;
  }
  const scene = new three.Scene();
  const camera = new three.PerspectiveCamera(42, 1, 0.15, 60);
  camera.position.set(0, 0.75, 8);
  camera.lookAt(0, 0.5, 0);
  scene.add(new three.HemisphereLight(0xd6f5ff, 0x536c91, 2.1));
  const key = new three.DirectionalLight(0xffdfba, 3.0);
  key.position.set(4, 5, 3);
  scene.add(key);
  const { shark, tail } = makeShark(three);
  scene.add(shark);

  const count = 58;
  const droplets = new Float32Array(count * 3);
  const velocities = Array.from({ length: count }, (_, index) => {
    const angle = index * 2.39996;
    const spread = 0.52 + (index % 11) * 0.26;
    return [Math.cos(angle) * spread, 1.7 + (index % 9) * .29, Math.sin(angle) * spread];
  });
  const splashGeometry = new three.BufferGeometry();
  const positions = new three.BufferAttribute(droplets, 3);
  splashGeometry.setAttribute('position', positions);
  const splashMaterial = new three.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { opacity: { value: 0 } },
    vertexShader: 'void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(75./-p.z,1.5,8.);}',
    fragmentShader: 'uniform float opacity;void main(){float d=length(gl_PointCoord-0.5);gl_FragColor=vec4(0.73,0.92,1.,opacity*(1.-smoothstep(0.13,0.5,d)));}',
  });
  const splash = new three.Points(splashGeometry, splashMaterial);
  splash.frustumCulled = false;
  scene.add(splash);
  const points = [[3.1,-2.7,-14],[2.7,-.72,-8],[2.05,1.30,-1.8],[1.3,1.84,3.6],[.25,2.9,8.0]];
  const path = new three.CatmullRomCurve3(points.map(point => new three.Vector3(...point)));
  const direction = new three.Vector3(0, 0, 1);
  const start = performance.now();
  let frame = 0;
  let stopped = false;
  let passed = false;

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    motion.removeEventListener('change', onMotion);
    canvas.removeEventListener('webglcontextlost', stop);
    delete canvas.dataset.playing;
    scene.traverse(object => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    renderer.dispose();
  }

  function onMotion(event) { if (event.matches) stop(); }

  function resize() {
    const { width, height } = hero.getBoundingClientRect();
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.fov = camera.aspect < 0.8 ? 69 : 42;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25, Math.sqrt(1150000 / (width * height))));
    renderer.setSize(width, height, false);
  }

  function animate(now) {
    const time = Math.max(0, now - start) / 1000;
    if (time >= 3.25 || document.hidden || hero.getBoundingClientRect().bottom < innerHeight * 0.4) {
      stop();
      return;
    }
    const progress = Math.pow(time / 3.25, 1.52);
    if (!passed && progress >= .66) {
      passed = true;
      onPass();
    }
    shark.position.copy(path.getPoint(progress));
    const tangent = path.getTangent(progress);
    tangent.y *= .64;
    shark.quaternion.setFromUnitVectors(direction, tangent.normalize());
    shark.rotateY(-.78 + progress * .53);
    shark.rotateZ(Math.sin(time * 2.1) * .19 - .17);
    tail.rotation.y = Math.sin(time * 12) * .34;
    shark.visible = progress > .22;
    const sprayTime = Math.max(0, time - 1.10);
    splash.visible = sprayTime > 0 && sprayTime < 1.35;
    if (splash.visible) {
      velocities.forEach(([x, y, z], index) => {
        positions.setXYZ(index, 2.75 + x * sprayTime, -.45 + y * sprayTime - 2.6 * sprayTime ** 2, -7.6 + z * sprayTime);
      });
      positions.needsUpdate = true;
      splashMaterial.uniforms.opacity.value = (1 - sprayTime / 1.35) * .82;
    }
    canvas.dataset.playing = 'true';
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(hero);
  resize();
  motion.addEventListener('change', onMotion);
  canvas.addEventListener('webglcontextlost', stop);
  frame = requestAnimationFrame(animate);
  return stop;
}

export default function SharkIntro() {
  const canvas = useRef(null);

  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) return;
    let cancelled = false;
    let stop;
    let stopRebound;
    const onMotion = event => { if (event.matches) stopRebound?.(); };
    motion.addEventListener('change', onMotion);
    import('three').then(three => {
      if (!cancelled) {
        stop = playIntro(three, canvas.current, () => {
          if (!motion.matches) stopRebound = rebound(canvas.current.parentElement);
        });
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
      motion.removeEventListener('change', onMotion);
      stopRebound?.();
      stop?.();
    };
  }, []);

  return <canvas ref={canvas} className="site-shark-intro" aria-hidden="true"/>;
}
