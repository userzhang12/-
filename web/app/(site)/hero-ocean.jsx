'use client';

import { useEffect, useRef } from 'react';

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

const vec3 sun = vec3(0.47, 0.085, 0.88);

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
  vec3 color = mix(vec3(0.31, 0.29, 0.32), vec3(0.033, 0.13, 0.22),
                   smoothstep(0.0, 0.52, elevation));
  float facing = max(0.0, dot(ray, sun));
  color += pow(facing, 11.0) * exp(-elevation * 3.6) * vec3(0.42, 0.21, 0.10);
  color += pow(facing, 140.0) * vec3(0.64, 0.30, 0.12);
  color += smoothstep(0.9988, 0.9995, facing) * vec3(1.0, 0.78, 0.42);
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
  vec3 color = mix(vec3(0.014, 0.105, 0.137), sky(reflection), fresnel);
  float facing = max(0.0, dot(reflection, sun));
  color += pow(facing, 44.0) * vec3(0.66, 0.34, 0.15);
  color += pow(facing, 220.0) * vec3(0.62, 0.45, 0.26);
  float horizonFog = smoothstep(18.0, 62.0, distance);
  return mix(color, sky(normalize(vec3(ray.x, 0.0, ray.z))) * 0.73, horizonFog);
}

vec3 belowSurface(vec2 uv) {
  vec2 p = uv + pointer * 0.02;
  float depth = 1.0 - p.y;
  float spread = p.x - 0.58 - depth * 0.13;
  float shafts = 0.48 + 0.34 * sin(spread * 31.0 + time * 0.38)
                       + 0.18 * sin(spread * 65.0 - time * 0.24);
  float light = max(0.0, shafts) * exp(-depth * 1.85 - abs(spread) * 2.6);
  float ceiling = smoothstep(0.84, 1.0, p.y + 0.027 * sin(p.x * 22.0 + time));
  return vec3(0.008, 0.049, 0.081) + vec3(0.065, 0.34, 0.40) * light
                                  + vec3(0.025, 0.17, 0.20) * ceiling;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  float aspect = resolution.x / resolution.y;
  vec2 view = (uv - vec2(0.5, 0.53)) * vec2(aspect, 1.0);
  vec3 ray = normalize(vec3(view.x * 1.18 + pointer.x * 0.045,
                            view.y * 1.06 + pointer.y * 0.028, 1.0));
  vec3 color = sky(ray);
  if (ray.y < 0.0) {
    color = mix(color * 0.73, ocean(ray), smoothstep(0.0, 0.018, -ray.y));
  } else {
    vec2 cloud = vec2(view.x * 3.2, view.y * 17.0) + vec2(time * 0.024, 0.0);
    float veil = smoothstep(0.42, 0.83, noise(cloud) * 0.68 + noise(cloud * 2.1) * 0.32);
    color = mix(color, color * 0.60, veil * smoothstep(0.015, 0.11, ray.y));
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
    const hero = canvas.parentElement;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) return;

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return;

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
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      dispose();
      return;
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

    let visible = false;
    let frame = 0;
    let previous = -Infinity;
    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let depth = 0;
    let elapsed = 0;

    function draw(now) {
      frame = 0;
      if (now - previous >= 1000 / 30) {
        elapsed += Math.min(now - previous, 50) / 1000;
        previous = now;
        x += (targetX - x) * 0.09;
        y += (targetY - y) * 0.09;
        gl.uniform2f(pointer, x, y);
        gl.uniform1f(time, elapsed);
        gl.uniform1f(immersion, depth);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        canvas.dataset.ready = 'true';
      }
      frame = requestAnimationFrame(draw);
    }

    function update() {
      const active = visible && !document.hidden && !reducedMotion.matches && !gl.isContextLost();
      if (!active && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (active && !frame) frame = requestAnimationFrame(draw);
      if (reducedMotion.matches || gl.isContextLost()) delete canvas.dataset.ready;
    }

    function resize() {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const scale = Math.min(devicePixelRatio, 1.5, 1920 / width, Math.sqrt(1500000 / (width * height)));
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
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
      const progress = Math.max(0, Math.min(1, (-bounds.top / bounds.height - 0.12) / 0.54));
      depth = progress * progress * (3 - 2 * progress);
    }

    resize();
    scroll();
    const size = new ResizeObserver(resize);
    size.observe(canvas);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    intersection.observe(hero);
    window.addEventListener('scroll', scroll, { passive: true });
    hero.addEventListener('pointermove', move);
    hero.addEventListener('pointerleave', reset);
    document.addEventListener('visibilitychange', update);
    reducedMotion.addEventListener('change', update);
    canvas.addEventListener('webglcontextlost', update);

    return () => {
      cancelAnimationFrame(frame);
      size.disconnect();
      intersection.disconnect();
      window.removeEventListener('scroll', scroll);
      hero.removeEventListener('pointermove', move);
      hero.removeEventListener('pointerleave', reset);
      document.removeEventListener('visibilitychange', update);
      reducedMotion.removeEventListener('change', update);
      canvas.removeEventListener('webglcontextlost', update);
      delete canvas.dataset.ready;
      dispose();
    };
  }, []);

  return <canvas ref={surface} className="site-hero-ocean" aria-hidden="true"/>;
}
