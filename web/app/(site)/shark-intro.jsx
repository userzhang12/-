'use client';

import { useEffect, useRef } from 'react';
import { animate } from 'motion';
import { createSharkJaw } from './shark-jaw';

const swim = `
float swimBend(float z, float time) {
  float tail = smoothstep(0.15, 2.65, -z);
  return tail * (0.035 + tail * 0.315) * sin(time * 12.0 + z * 1.75);
}
vec3 swimmingPosition(vec3 point, float time) {
  point.x += swimBend(point.z, time);
  return point;
}
`;

function applySharkSkin(three, shark, swimTime, assembly, bite, submerge, waterline) {
  const skin = new three.MeshPhysicalMaterial({
    vertexColors: true,
    transparent: true,
    roughness: .35,
    clearcoat: .58,
    clearcoatRoughness: .29,
    clippingPlanes: [waterline],
  });
  skin.onBeforeCompile = shader => {
    shader.uniforms.swimTime = swimTime;
    shader.uniforms.assembly = assembly;
    shader.uniforms.bite = bite;
    shader.uniforms.submerge = submerge;
    shader.vertexShader = 'uniform float swimTime; varying float scanPosition; varying vec3 bitePosition; varying float waterDepth;\n' + swim
      + shader.vertexShader.replace('#include <beginnormal_vertex>', `
        #include <beginnormal_vertex>
        float slope = (swimBend(position.z + .025, swimTime) - swimBend(position.z - .025, swimTime)) / .05;
        objectNormal.z -= objectNormal.x * slope;
      `).replace('#include <begin_vertex>', `
        #include <begin_vertex>
        transformed = swimmingPosition(transformed, swimTime);
        bitePosition = position;
        waterDepth = max(0.0, -(modelMatrix * vec4(transformed, 1.0)).y - 0.12);
        scanPosition = clamp((2.7 - position.z) / 5.4, 0.0, 1.0);
      `);
    shader.fragmentShader = 'uniform float swimTime; uniform float assembly; uniform float bite; uniform float submerge; varying float scanPosition; varying vec3 bitePosition; varying float waterDepth;\n'
      + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        float mouthFront = smoothstep(1.35, 2.06, bitePosition.z);
        float mouthWidth = 1.0 - smoothstep(0.43, 0.55, abs(bitePosition.x));
        if (bite > 0.025 && bitePosition.z > 1.30 && mouthWidth > 0.01
            && bitePosition.y < (-0.17 + 0.25 * mouthFront) * mouthWidth + bite * 0.046) discard;
        if (assembly < 1.0) {
          float coverage = smoothstep(-0.055, 0.10, assembly * 1.17 - scanPosition);
          float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (grain >= coverage) discard;
        }
      `).replace('#include <opaque_fragment>', `
        float haze = submerge * smoothstep(0.0, 3.7, waterDepth);
        vec2 ray = bitePosition.xz + vec2(swimTime * .055, 0.0);
        float bands = sin(ray.x * 21.0 + sin(ray.y * 12.0 + swimTime * .32))
                    + sin(ray.y * 19.0 - ray.x * 7.0 + sin(ray.x * 5.0 + ray.y * 3.0) * 1.35 - swimTime * .24);
        float caustic = pow(clamp(1.0 - abs(bands) * .83, 0.0, 1.0), 4.0);
        outgoingLight = mix(outgoingLight, vec3(0.019, 0.16, 0.22), haze * .50);
        outgoingLight += vec3(.029, .104, .117) * caustic * submerge * exp(-waterDepth * .16);
        diffuseColor.a *= mix(1.0, 0.88 - haze * .20, submerge);
        #include <opaque_fragment>
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
  const stage = canvas.parentElement;
  const hero = canvas.closest('.site-hero');
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
  const bite = { value: 0 };
  const submerge = { value: 0 };
  const waterline = new three.Plane(new three.Vector3(0, 1, 0), .12);
  applySharkSkin(three, shark, swimTime, assembly, bite, submerge, waterline);
  const surfaceLight = makeSurfaceLight(three, shark, MeshSurfaceSampler, swimTime, assembly);
  const setOpening = createSharkJaw(three, shark, waterline);
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
  const points = [[3.1,-1.25,-15],[2.65,-.91,-10],[1.95,1.06,-3.3],[.61,1.06,2.15],[.16,.98,4.86],[.31,1.04,7.7]];
  const path = new three.CatmullRomCurve3(points.map(point => new three.Vector3(...point)));
  const returnPath = new three.CatmullRomCurve3([
    [5.7,2.65,4.8], [4.3,1.92,1.7], [3.05,.86,-3.6],
    [2.10,-.63,-8.5], [1.05,-1.55,-12.0],
  ].map(point => new three.Vector3(...point)));
  const direction = new three.Vector3(0, 0, 1);
  let start = performance.now();
  const returnStart = 3.18;
  const returnDuration = 1.64;
  const patrolStart = returnStart + returnDuration;
  const patrolOrigin = returnPath.getPoint(1);
  const returnHeading = new three.Quaternion().setFromUnitVectors(direction, returnPath.getTangent(1));
  const swimTarget = new three.Vector3();
  const swimDirection = new three.Vector3();
  const swimHeading = new three.Quaternion();
  const wake = new three.Vector3();
  const wakeStart = new three.Vector3();
  let frame = 0;
  let stopped = false;
  let passed = false;
  let impact = 0;
  let visible = false;
  let pausedAt = start;
  let lastPatrolFrame = -Infinity;

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    viewport.disconnect();
    document.removeEventListener('visibilitychange', updateVisibility);
    motion.removeEventListener('change', onMotion);
    canvas.removeEventListener('webglcontextlost', stop);
    delete canvas.dataset.playing;
    delete canvas.dataset.patrol;
    scene.traverse(object => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    renderer.dispose();
  }

  function onMotion(event) { if (event.matches) stop(); }

  function resize() {
    const { width, height } = stage.getBoundingClientRect();
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.fov = camera.aspect < 0.8 ? 69 : 42;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25, Math.sqrt(1150000 / (width * height))));
    renderer.setSize(width, height, false);
  }

  function updateVisibility() {
    if (stopped) return;
    if (!visible || document.hidden) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pausedAt ??= performance.now();
      return;
    }
    if (pausedAt !== null) {
      start += performance.now() - pausedAt;
      pausedAt = null;
    }
    if (!frame) frame = requestAnimationFrame(animate);
  }

  function patrolPosition(time, target) {
    const narrow = camera.aspect < .8;
    const horizontal = narrow ? 2.6 : 5.4;
    return target.set(
      horizontal * (0.73 * Math.sin(0.37 * time - .55) + 0.20 * Math.sin(0.89 * time + 1.3)),
      (narrow ? -7.35 : -3.35) + 0.62 * Math.sin(time * .64) + 0.28 * Math.sin(time * 1.11 + 1),
      -7.5 + 1.8 * Math.sin(time * .24) + 0.82 * Math.sin(time * .77),
    );
  }

  function animate(now) {
    const time = Math.max(0, now - start) / 1000;
    if (time >= patrolStart) {
      if (now - lastPatrolFrame >= 1000 / 24) {
        lastPatrolFrame = now;
        const age = time - patrolStart;
        const depth = Number(hero.style.getPropertyValue('--ocean-depth'));
        camera.lookAt(0, .5 - depth * (camera.aspect < .8 ? 5.1 : 3.1), 0);
        const entry = three.MathUtils.smoothstep(age, 0, 2.1);
        patrolPosition(age, swimTarget);
        patrolPosition(age + .065, swimDirection).sub(swimTarget);
        swimDirection.y *= .48;
        swimDirection.normalize();
        swimHeading.setFromUnitVectors(direction, swimDirection);
        shark.position.copy(patrolOrigin).lerp(swimTarget, entry);
        shark.quaternion.copy(returnHeading).slerp(swimHeading, entry);
        shark.rotateZ((Math.sin(age * .85) * .13 + swimDirection.x * .12) * entry);
        shark.visible = true;
        waterline.constant = 12;
        submerge.value = 1;
        assembly.value = 1.2;
        bite.value = 0;
        setOpening(0);
        if (surfaceLight) surfaceLight.visible = false;
        canvas.dataset.playing = 'true';
        swimTime.value = patrolStart + age * .66;
        splash.visible = false;
        canvas.dataset.patrol = 'true';
        renderer.render(scene, camera);
      }
      frame = requestAnimationFrame(animate);
      return;
    }
    const progress = Math.pow(Math.min(time / 3.3, 1), 1.52);
    if (!passed && progress >= .83) {
      passed = true;
      impact = time;
      wakeStart.copy(path.getPoint(.77));
      onPass();
    }
    shark.position.copy(path.getPoint(progress));
    const tangent = path.getTangent(progress);
    const faceCamera = three.MathUtils.smoothstep(progress, .47, .72);
    tangent.y *= .69;
    tangent.x *= 1 - faceCamera;
    tangent.y *= 1 - faceCamera;
    shark.quaternion.setFromUnitVectors(direction, tangent.normalize());
    shark.rotateY(-.46 * (1 - faceCamera));
    shark.rotateZ((-0.27 + Math.sin(time * 2.8) * .12) * (1 - faceCamera));
    bite.value = three.MathUtils.smoothstep(progress, .49, .73)
      * (1 - three.MathUtils.smoothstep(progress, .88, .96));
    setOpening(bite.value);
    shark.visible = progress < .95;
    const returning = time >= returnStart;
    if (returning) {
      const fraction = Math.min(1, (time - returnStart) / returnDuration);
      shark.position.copy(returnPath.getPoint(fraction));
      shark.quaternion.setFromUnitVectors(direction, returnPath.getTangent(fraction));
      shark.rotateZ(.44 * Math.sin(Math.PI * fraction));
      shark.visible = true;
      submerge.value = three.MathUtils.smoothstep(fraction, .53, .9);
      if (fraction >= .53) {
        waterline.constant = 12;
        canvas.dataset.patrol = 'true';
      }
      setOpening(0);
      bite.value = 0;
    }
    swimTime.value = time;
    assembly.value = Math.min(1.2, Math.max(0, (time - .17) / 1.52));
    if (surfaceLight) surfaceLight.visible = assembly.value < 1.12;
    if (passed) {
      const after = time - impact;
      const recoil = Math.exp(-after * 11) * Math.sin(after * 34);
      camera.position.x = .16 * recoil;
      camera.position.z = 8 + .27 * Math.exp(-after * 9);
      camera.position.y = .75 - .07 * recoil;
    }
    const sprayTime = time - 1.23;
    const wakeTime = passed ? time - impact : -1;
    const inWake = wakeTime >= 0 && wakeTime < .9;
    const diveTime = time - (returnStart + returnDuration * .62);
    const diving = diveTime >= 0 && diveTime < 1.05;
    splash.visible = (sprayTime > 0 && sprayTime < 1.35) || inWake || diving;
    if (splash.visible) {
      if (inWake) wake.copy(wakeStart).lerp(shark.position, .26);
      velocities.forEach(([x, y, z], index) => {
        if (diving) {
          positions.setXYZ(index, 2.55 + x * diveTime * 1.18,
            -.10 + y * diveTime * .78 - 3.1 * diveTime ** 2, -6.9 + z * diveTime * 1.24);
        } else if (inWake) {
          const offset = (index % 23) / 22;
          positions.setXYZ(index, wake.x + x * wakeTime * .44 + offset * .52,
            wake.y + y * wakeTime * .21 - 2.2 * wakeTime ** 2, wake.z - offset * 4.7 + z * wakeTime);
        } else {
          positions.setXYZ(index, 2.30 + x * sprayTime, -.10 + y * sprayTime - 3.4 * sprayTime ** 2, -7.0 + z * sprayTime);
        }
      });
      positions.needsUpdate = true;
      splashMaterial.uniforms.opacity.value = diving ? .69 * (1 - diveTime / 1.05) ** 1.65
        : inWake ? .59 * (1 - wakeTime / .9) ** 2 : (1 - sprayTime / 1.35) * .82;
    }
    canvas.dataset.playing = 'true';
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  const viewport = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    updateVisibility();
  });
  viewport.observe(stage);
  document.addEventListener('visibilitychange', updateVisibility);
  resize();
  motion.addEventListener('change', onMotion);
  canvas.addEventListener('webglcontextlost', stop);
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
          if (!motion.matches) stopRebound = rebound(canvas.current.closest('.site-hero'));
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
