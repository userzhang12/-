'use client';

import { useEffect, useRef } from 'react';
import { animate } from 'motion';

const swim = `
vec3 swimmingPosition(vec3 point, float time) {
  float tail = smoothstep(0.15, 2.65, -point.z);
  point.x += tail * tail * sin(time * 12.0 + point.z * 1.75) * 0.31;
  return point;
}
`;

function applySharkSkin(three, shark, swimTime, assembly, waterline) {
  const skin = new three.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: .35,
    clearcoat: .58,
    clearcoatRoughness: .29,
    clippingPlanes: [waterline],
  });
  skin.onBeforeCompile = shader => {
    shader.uniforms.swimTime = swimTime;
    shader.uniforms.assembly = assembly;
    shader.vertexShader = 'uniform float swimTime; varying float scanPosition;\n' + swim
      + shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        transformed = swimmingPosition(transformed, swimTime);
        scanPosition = clamp((2.7 - position.z) / 5.4, 0.0, 1.0);
      `);
    shader.fragmentShader = 'uniform float assembly; varying float scanPosition;\n'
      + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        if (assembly < 1.0) {
          float coverage = smoothstep(-0.055, 0.10, assembly * 1.17 - scanPosition);
          float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (grain >= coverage) discard;
        }
      `);
  };
  shark.traverse(object => {
    if (!object.isMesh) return;
    object.material.dispose();
    object.material = skin;
  });
}

function makeSurfaceLight(three, shark, MeshSurfaceSampler, swimTime, assembly) {
  let mesh;
  shark.traverse(object => {
    if (object.isMesh && !mesh) mesh = object;
  });
  if (!mesh) return null;

  const count = matchMedia('(max-width: 600px)').matches ? 800 : 1450;
  const vertices = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const position = new three.Vector3();
  const normal = new three.Vector3();
  shark.updateMatrixWorld(true);
  const normalMatrix = new three.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const sampler = new MeshSurfaceSampler(mesh).build();

  for (let index = 0; index < count; index++) {
    sampler.sample(position, normal);
    position.applyMatrix4(mesh.matrixWorld).toArray(vertices, index * 3);
    normal.applyNormalMatrix(normalMatrix).toArray(normals, index * 3);
    seeds[index] = Math.random();
  }

  const geometry = new three.BufferGeometry();
  geometry.setAttribute('position', new three.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new three.BufferAttribute(normals, 3));
  geometry.setAttribute('seed', new three.BufferAttribute(seeds, 1));
  const material = new three.ShaderMaterial({
    transparent: true,
    blending: three.AdditiveBlending,
    depthWrite: false,
    uniforms: { swimTime, assembly },
    vertexShader: swim + `
      uniform float swimTime;
      uniform float assembly;
      attribute float seed;
      varying float opacity;
      varying vec3 tint;
      void main() {
        float scan = clamp((2.7 - position.z) / 5.4, 0.0, 1.0);
        float arrival = 0.14 + scan * 0.66 + seed * 0.10;
        float gathered = smoothstep(arrival - 0.32, arrival + 0.07, assembly);
        float orbit = seed * 6.283 + swimTime * (1.8 + seed);
        vec3 drift = normal * (0.28 + seed * 0.8) + vec3(cos(orbit), sin(orbit), cos(orbit * 0.71)) * 0.36;
        vec3 point = swimmingPosition(position, swimTime) + drift * (1.0 - gathered);
        vec4 world = modelMatrix * vec4(point, 1.0);
        vec4 eye = viewMatrix * world;
        gl_Position = projectionMatrix * eye;
        gl_PointSize = clamp((30.0 + seed * 39.0) / max(-eye.z, 0.1), 1.25, 7.0);
        float flicker = 0.76 + sin(orbit * 3.7) * 0.24;
        float pulse = smoothstep(0.04, 0.20, assembly) * (1.0 - smoothstep(0.63, 1.12, assembly));
        opacity = pulse * flicker * (0.21 + 0.79 * gathered) * smoothstep(-0.72, 0.12, world.y);
        tint = mix(vec3(0.18, 0.64, 1.0), vec3(1.0, 0.76, 0.42), step(0.78, seed));
      }`,
    fragmentShader: `
      varying float opacity;
      varying vec3 tint;
      void main() {
        float distance = length(gl_PointCoord - 0.5);
        float glow = (1.0 - smoothstep(0.03, 0.50, distance)) * opacity;
        gl_FragColor = vec4(tint, glow);
      }`,
  });
  const light = new three.Points(geometry, material);
  light.frustumCulled = false;
  shark.add(light);
  return light;
}

function rebound(hero) {
  const strength = hero.clientWidth < 600 ? .62 : 1;
  const targets = [
    ['.site-hero-preview', 19, 9, -1.2, -.018, 0],
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

function playIntro(three, shark, MeshSurfaceSampler, canvas, onPass) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const hero = canvas.parentElement;
  if (motion.matches || hero.getBoundingClientRect().bottom < innerHeight * .65) return;
  let renderer;
  try {
    renderer = new three.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    return;
  }
  renderer.localClippingEnabled = true;
  renderer.toneMapping = three.ACESFilmicToneMapping;
  const scene = new three.Scene();
  const camera = new three.PerspectiveCamera(42, 1, 0.15, 60);
  camera.position.set(0, 0.75, 8);
  camera.lookAt(0, 0.5, 0);
  scene.add(new three.HemisphereLight(0xc8e8f3, 0x52657b, 1.55));
  const key = new three.DirectionalLight(0xffe7cc, 2.65);
  key.position.set(4, 5, 3);
  const rim = new three.DirectionalLight(0x8acdea, 2.8);
  rim.position.set(-3, 2, -4);
  scene.add(key, rim);
  const swimTime = { value: 0 };
  const assembly = { value: 0 };
  const waterline = new three.Plane(new three.Vector3(0, 1, 0), .12);
  applySharkSkin(three, shark, swimTime, assembly, waterline);
  const surfaceLight = makeSurfaceLight(three, shark, MeshSurfaceSampler, swimTime, assembly);
  scene.add(shark);

  const count = 144;
  const droplets = new Float32Array(count * 3);
  const velocities = Array.from({ length: count }, (_, index) => {
    const angle = index * 2.39996;
    const spread = 0.45 + (index % 17) * 0.24;
    return [Math.cos(angle) * spread, 1.6 + (index % 13) * .33, Math.sin(angle) * spread];
  });
  const splashGeometry = new three.BufferGeometry();
  const positions = new three.BufferAttribute(droplets, 3);
  splashGeometry.setAttribute('position', positions);
  const splashMaterial = new three.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { opacity: { value: 0 } },
    vertexShader: 'void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(96./-p.z,1.5,9.);}',
    fragmentShader: 'uniform float opacity;void main(){float d=length(gl_PointCoord-0.5);gl_FragColor=vec4(0.73,0.92,1.,opacity*(1.-smoothstep(0.13,0.5,d)));}',
  });
  const splash = new three.Points(splashGeometry, splashMaterial);
  splash.frustumCulled = false;
  scene.add(splash);
  const points = [[3.1,-1.25,-15],[2.65,-.91,-10],[1.8,1.08,-3.6],[.75,1.44,3.1],[-.48,1.48,6.55],[-2.4,1.63,10.2]];
  const path = new three.CatmullRomCurve3(points.map(point => new three.Vector3(...point)));
  const direction = new three.Vector3(0, 0, 1);
  const start = performance.now();
  const duration = 3.7;
  const wake = new three.Vector3();
  const wakeStart = new three.Vector3();
  let frame = 0;
  let stopped = false;
  let passed = false;
  let impact = 0;

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
    if (time >= duration || document.hidden || hero.getBoundingClientRect().bottom < innerHeight * 0.4) {
      stop();
      return;
    }
    const progress = Math.pow(Math.min(time / 3.3, 1), 1.52);
    if (!passed && progress >= .73) {
      passed = true;
      impact = time;
      wakeStart.copy(path.getPoint(.67));
      onPass();
    }
    shark.position.copy(path.getPoint(progress));
    const tangent = path.getTangent(progress);
    tangent.y *= .69;
    shark.quaternion.setFromUnitVectors(direction, tangent.normalize());
    shark.rotateY(-.66 + progress * .65);
    shark.rotateZ(-.29 + progress * .46 + Math.sin(time * 2.8) * .12);
    swimTime.value = time;
    assembly.value = Math.min(1.2, Math.max(0, (time - .17) / 1.52));
    if (surfaceLight) surfaceLight.visible = assembly.value < 1.12;
    if (passed) {
      const after = time - impact;
      const recoil = Math.exp(-after * 11) * Math.sin(after * 34);
      camera.position.x = .11 * recoil;
      camera.position.y = .75 - .07 * recoil;
    }
    const sprayTime = time - 1.23;
    const wakeTime = passed ? time - impact : -1;
    const inWake = wakeTime >= 0 && wakeTime < .9;
    splash.visible = (sprayTime > 0 && sprayTime < 1.35) || inWake;
    if (splash.visible) {
      if (inWake) wake.copy(wakeStart).lerp(shark.position, .26);
      velocities.forEach(([x, y, z], index) => {
        if (inWake) {
          const offset = (index % 23) / 22;
          positions.setXYZ(index, wake.x + x * wakeTime * .44 + offset * .52,
            wake.y + y * wakeTime * .21 - 2.2 * wakeTime ** 2, wake.z - offset * 4.7 + z * wakeTime);
        } else {
          positions.setXYZ(index, 2.30 + x * sprayTime, -.10 + y * sprayTime - 3.4 * sprayTime ** 2, -7.0 + z * sprayTime);
        }
      });
      positions.needsUpdate = true;
      splashMaterial.uniforms.opacity.value = inWake ? .59 * (1 - wakeTime / .9) ** 2 : (1 - sprayTime / 1.35) * .82;
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
    async function load() {
      const [three, { GLTFLoader }, { MeshSurfaceSampler }] = await Promise.all([
        import('three'),
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/math/MeshSurfaceSampler.js'),
      ]);
      if (cancelled) return;
      const { scene } = await new GLTFLoader().loadAsync('/great-white-shark.glb');
      if (!cancelled) {
        stop = playIntro(three, scene, MeshSurfaceSampler, canvas.current, () => {
          if (!motion.matches) stopRebound = rebound(canvas.current.parentElement);
        });
      }
      if (!stop) {
        scene.traverse(object => {
          object.geometry?.dispose();
          object.material?.dispose();
        });
      }
    }
    load().catch(() => {});
    return () => {
      cancelled = true;
      motion.removeEventListener('change', onMotion);
      stopRebound?.();
      stop?.();
    };
  }, []);

  return <canvas ref={canvas} className="site-shark-intro" aria-hidden="true"/>;
}
