'use client';

import { useEffect, useRef } from 'react';
import { localLighting } from './ocean-lighting';

const vertexSource = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragmentSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 resolution;
uniform vec2 pointer;
uniform float time;
uniform float immersion;

uniform vec3 atmosphere;
vec3 lightDirection;
vec3 lightTint;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 weight = fract(p);
  weight = weight * weight * (3.0 - 2.0 * weight);
  return mix(mix(hash(cell), hash(cell + vec2(1., 0.)), weight.x),
             mix(hash(cell + vec2(0., 1.)), hash(cell + vec2(1.)), weight.x), weight.y);
}

vec3 sky(vec3 ray) {
  float elevation = max(0.0, ray.y);
  float daylight = atmosphere.x;
  float twilight = atmosphere.y;
  vec3 horizon = mix(vec3(0.075, 0.15, 0.26), vec3(0.60, 0.76, 0.83), daylight);
  vec3 zenith = mix(vec3(0.012, 0.034, 0.095), vec3(0.10, 0.38, 0.60), daylight);
  horizon = mix(horizon, vec3(0.55, 0.31, 0.30), twilight);
  vec3 color = mix(horizon, zenith, smoothstep(0.0, 0.56, elevation));
  float facing = max(0.0, dot(ray, lightDirection));
  color += pow(facing, 22.0) * exp(-elevation * 2.0) * lightTint * 0.32;
  color += pow(facing, 180.0) * lightTint * 0.42;
  float disc = smoothstep(0.9990, 0.99955, facing);
  color += disc * lightTint;
  return color;
}

// Each octave returns its height and the two derivatives used for the surface normal.
vec3 wave(vec2 p, vec2 dir, float frequency, float amplitude, float speed) {
  float phase = dot(p, dir) * frequency + time * speed;
  float crest = sin(phase);
  float slope = cos(phase) * (0.72 + 0.48 * crest);
  return amplitude * vec3(0.72 * crest + 0.24 * crest * crest,
                          frequency * slope * dir);
}

vec3 swells(vec2 p) {
  return wave(p, vec2(0.69, 0.72), 1.35, 0.26, -1.08)
       + wave(p, vec2(-0.42, 0.91), 2.45, 0.13, -1.6)
       + wave(p, vec2(0.94, 0.34), 3.55, 0.075, -1.9);
}

vec3 ocean(vec3 ray) {
  float distance = min(95.0, 1.58 / max(-ray.y, 0.018));
  vec2 origin = vec2(pointer.x * 0.40, time * 0.19);
  // Refine the plane hit against the long waves before shading the fine ripples.
  for (int i = 0; i < 2; i++) {
    float height = swells(origin + ray.xz * distance).x;
    distance = min(95.0, (1.58 - height) / max(-ray.y, 0.018));
  }
  vec2 p = origin + ray.xz * distance;
  vec3 surface = swells(p);
  surface += (1.0 - smoothstep(6.0, 55.0, distance)) * (
      wave(p, vec2(-0.81, 0.59), 6.8, 0.043, -3.0)
    + wave(p, vec2(0.54, 0.84), 11.7, 0.022, -3.7)
    + wave(p, vec2(0.97, -0.24), 18.0, 0.010, -4.6)
  );
  vec3 normal = normalize(vec3(-surface.y * 0.78, 1.0, -surface.z * 0.78));
  vec3 reflection = reflect(ray, normal);
  reflection.y = abs(reflection.y);
  float fresnel = 0.085 + 0.78 * pow(1.0 - max(0.0, dot(normal, -ray)), 4.0);
  vec3 water = mix(vec3(0.009, 0.065, 0.113), vec3(0.025, 0.235, 0.28), atmosphere.x);
  vec3 color = mix(water, sky(reflection), fresnel);
  float facing = max(0.0, dot(reflection, lightDirection));
  color += pow(facing, 44.0) * lightTint * 0.69;
  color += pow(facing, 220.0) * lightTint * 0.6;
  float horizonFog = smoothstep(18.0, 62.0, distance);
  return mix(color, sky(normalize(vec3(ray.x, 0.0, ray.z))) * 0.73, horizonFog);
}

float marineSnow(vec2 p, float density, float speed) {
  vec2 cell = p * density + vec2(time * speed * 0.32, -time * speed);
  float grain = hash(floor(cell));
  vec2 particle = vec2(0.23 + grain * 0.53, 0.18 + hash(floor(cell) + 7.3) * 0.62);
  float soft = 1.0 - smoothstep(0.018, 0.095, length(fract(cell) - particle));
  return smoothstep(0.81, 0.98, grain) * soft;
}

vec3 belowSurface(vec2 uv) {
  float aspect = resolution.x / resolution.y;
  vec2 p = uv + pointer * 0.021;
  float distance = 1.0 - p.y;
  float source = p.x - 0.62 + (p.x - 0.62) * distance * 0.68;
  float cloud = noise(vec2(source * 31.0 + time * .055, 1.9));
  float shafts = pow(max(0.0, 0.54 + 0.24 * sin(source * 29.0 + time * 0.33)
                        + 0.19 * sin(source * 57.0 - time * 0.28)), 1.8);
  float transmitted = exp(-distance * 2.25 - abs(source) * 2.1) * (shafts + cloud * .25);
  float brokenLight = sin(p.x * 41.0 + sin(p.x * 23.0 + time) * 1.4 + time * 0.8)
                    + sin(p.x * 26.0 - p.y * 43.0 - time * .71);
  float caustics = pow(clamp(1.0 - abs(brokenLight) * .91, 0.0, 1.0), 3.0);
  float ceiling = smoothstep(.81, 1.025, p.y + .029 * sin(p.x * 21.0 + time * .84));
  vec2 volume = vec2(p.x * aspect, p.y);
  float particles = marineSnow(volume, 25.0, .24) * .40 + marineSnow(volume + 0.39, 42.0, .63);
  float available = 0.32 + atmosphere.x * 0.68 + atmosphere.y * .15;
  vec3 color = mix(vec3(.008, .043, .071), vec3(.019, .145, .185), pow(clamp(p.y, 0.0, 1.0), 1.8));
  color += available * vec3(.085, .55, .61) * transmitted;
  color += available * vec3(.14, .56, .55) * ceiling * (.24 + caustics * .47);
  color += vec3(.26, .53, .56) * particles * (.13 + transmitted * .6);
  return color;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  float aspect = resolution.x / resolution.y;
  vec2 view = (uv - vec2(0.5, 0.53)) * vec2(aspect, 1.0);
  vec3 ray = normalize(vec3(view.x * 1.18 + pointer.x * 0.045,
                            view.y * 1.06 + pointer.y * 0.028, 1.0));
  float night = (1.0 - atmosphere.x) * (1.0 - atmosphere.y);
  lightDirection = normalize(vec3(min(0.71, aspect * 0.40), atmosphere.z, 1.0));
  lightTint = mix(vec3(0.43, 0.68, 1.0), vec3(1.0, 0.91, 0.70), atmosphere.x);
  lightTint = mix(lightTint, vec3(1.0, 0.57, 0.29), atmosphere.y);
  if (immersion >= 0.999) {
    gl_FragColor = vec4(belowSurface(uv), 1.0);
    return;
  }
  vec3 color = sky(ray);
  if (ray.y < 0.0) {
    color = mix(color * 0.73, ocean(ray), smoothstep(0.0, 0.018, -ray.y));
  } else {
    vec2 cloud = vec2(view.x * 3.2, view.y * 17.0) + vec2(time * 0.024, 0.0);
    float veil = smoothstep(0.42, 0.83, noise(cloud) * 0.68 + noise(cloud * 2.1) * 0.32);
    color = mix(color, color * 0.60, veil * smoothstep(0.015, 0.11, ray.y));
    vec2 starGrid = view * 137.0;
    float starSeed = hash(floor(starGrid));
    float star = (1.0 - smoothstep(0.07, 0.24, length(fract(starGrid) - 0.5)));
    float twinkle = 0.76 + 0.24 * sin(time * 1.25 + starSeed * 164.0);
    color += step(0.984, starSeed) * star * twinkle * night
           * smoothstep(0.04, 0.20, ray.y) * (1.0 - veil * 0.72) * vec3(0.59, 0.73, 0.96);
  }
  if (immersion > 0.0) color = mix(color, belowSurface(uv), immersion);
  float vignette = 1.0 - 0.27 * dot(uv - 0.5, uv - 0.5);
  color = color * vignette + (hash(gl_FragCoord.xy) - 0.5) * 0.009;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

export default function HeroOcean() {
  const surface = useRef(null);

  useEffect(() => {
    const canvas = surface.current;
    const hero = canvas.closest('.site-hero');
    function syncClock() {
      light = localLighting();
      hero.style.setProperty('--ocean-night', (1 - light[0]) * (1 - light[1]));
    }
    let light;
    syncClock();
    const clock = window.setInterval(syncClock, 15000);
    const stopClock = () => {
      window.clearInterval(clock);
      hero.style.removeProperty('--ocean-night');
    };
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) return stopClock;

    function staticFallback() {
      hero.dataset.oceanFallback = 'true';
      hero.dispatchEvent(new Event('jingxu:oceanfallback'));
      return () => {
        delete hero.dataset.oceanFallback;
        stopClock();
      };
    }

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return staticFallback();

    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    const dispose = () => {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    };
    if (!vertex || !fragment || !program || !buffer) {
      dispose();
      return staticFallback();
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      dispose();
      return staticFallback();
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, 'resolution');
    const pointer = gl.getUniformLocation(program, 'pointer');
    const time = gl.getUniformLocation(program, 'time');
    const immersion = gl.getUniformLocation(program, 'immersion');
    const atmosphere = gl.getUniformLocation(program, 'atmosphere');

    let visible = false;
    let frame = 0;
    let previous = -Infinity;
    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let depth = 0;
    let elapsed = 0;
    let lastFrame = null;
    let sampledFrames = 0;
    let sampleTime = 0;
    let stableWindows = 0;
    let quality = 1;

    function measureFrame(now) {
      const interval = lastFrame === null ? 0 : now - lastFrame;
      lastFrame = now;
      // Ignore gaps from restoring a tab or a suspended animation.
      if (interval <= 0 || interval > 250) return;
      sampleTime += interval;
      if (++sampledFrames < 36) return;
      const average = sampleTime / sampledFrames;
      sampleTime = sampledFrames = 0;
      stableWindows = average < 22 ? stableWindows + 1 : 0;
      const next = average > 38 ? Math.max(.55, quality - .14)
        : stableWindows >= 3 ? Math.min(1, quality + .10) : quality;
      if (next === quality) return;
      stableWindows = 0;
      quality = next;
      hero.dataset.oceanQuality = String(quality);
      resize();
      hero.dispatchEvent(new Event('jingxu:scenequality'));
    }

    function draw(now) {
      frame = 0;
      measureFrame(now);
      if (now - previous >= 1000 / 30) {
        elapsed += Math.min(now - previous, 50) / 1000;
        previous = now;
        x += (targetX - x) * 0.09;
        y += (targetY - y) * 0.09;
        gl.uniform2f(pointer, x, y);
        gl.uniform1f(time, elapsed);
        gl.uniform1f(immersion, depth);
        gl.uniform3f(atmosphere, ...light);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (!canvas.dataset.ready) {
          canvas.dataset.ready = 'true';
          hero.dataset.oceanReady = 'true';
        }
      }
      frame = requestAnimationFrame(draw);
    }

    function update() {
      syncClock();
      const active = visible && !document.hidden && !reducedMotion.matches && !gl.isContextLost();
      if (!active && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        lastFrame = null;
        sampledFrames = sampleTime = stableWindows = 0;
      }
      if (active && !frame) frame = requestAnimationFrame(draw);
      if (reducedMotion.matches || gl.isContextLost()) {
        delete canvas.dataset.ready;
        delete hero.dataset.oceanReady;
        hero.style.removeProperty('--ocean-depth');
      }
    }

    function resize() {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const scale = quality * Math.min(devicePixelRatio, 1.5, 1920 / width, Math.sqrt(1500000 / (width * height)));
      const renderWidth = Math.max(1, Math.round(width * scale));
      const renderHeight = Math.max(1, Math.round(height * scale));
      if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
        canvas.width = renderWidth;
        canvas.height = renderHeight;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolution, canvas.width, canvas.height);
    }

    function move(event) {
      if (event.pointerType === 'touch') return;
      const bounds = hero.getBoundingClientRect();
      targetX = (event.clientX - bounds.left) / bounds.width - 0.5;
      targetY = 0.5 - (event.clientY - bounds.top) / bounds.height;
    }
    function reset() { targetX = targetY = 0; }

    function scroll() {
      const bounds = hero.getBoundingClientRect();
      const screen = Math.max(1, canvas.clientHeight);
      const progress = Math.max(0, Math.min(1, (-bounds.top / screen - .10) / .52));
      depth = progress * progress * (3 - 2 * progress);
      if (!reducedMotion.matches && !gl.isContextLost()) hero.style.setProperty('--ocean-depth', depth);
    }

    resize();
    scroll();
    const size = new ResizeObserver(resize);
    size.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    intersection.observe(canvas);
    window.addEventListener('scroll', scroll, { passive: true });
    hero.addEventListener('pointermove', move);
    hero.addEventListener('pointerleave', reset);
    document.addEventListener('visibilitychange', update);
    reducedMotion.addEventListener('change', update);
    function onContextLost() {
      // Keep the current scroll range after a successful initialization.
      hero.dataset.oceanLost = 'true';
      update();
      hero.dispatchEvent(new Event('jingxu:oceanfallback'));
    }
    canvas.addEventListener('webglcontextlost', onContextLost);

    return () => {
      stopClock();
      delete hero.dataset.oceanReady;
      hero.style.removeProperty('--ocean-depth');
      cancelAnimationFrame(frame);
      size.disconnect();
      intersection.disconnect();
      window.removeEventListener('scroll', scroll);
      hero.removeEventListener('pointermove', move);
      hero.removeEventListener('pointerleave', reset);
      document.removeEventListener('visibilitychange', update);
      reducedMotion.removeEventListener('change', update);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      delete hero.dataset.oceanQuality;
      delete hero.dataset.oceanLost;
      delete canvas.dataset.ready;
      dispose();
    };
  }, []);

  return <canvas ref={surface} className="site-hero-ocean" aria-hidden="true"/>;
}
