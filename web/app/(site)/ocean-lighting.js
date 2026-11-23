// Hours are local to the visitor. The endpoints match so midnight stays continuous.
const lighting = [
  [0, 0, 0, 0.32], [5, 0, 0, 0.18], [6, 0.12, 1, 0.055],
  [8, 0.88, 0.18, 0.21], [12, 1, 0, 0.36], [16, 0.92, 0.12, 0.27],
  [18, 0.32, 1, 0.085], [19, 0.06, 0.65, 0.09], [21, 0, 0, 0.18],
  [24, 0, 0, 0.32],
];

export function localLighting() {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const right = lighting.findIndex(([boundary]) => hour < boundary);
  const [start, ...from] = lighting[right - 1];
  const [end, ...to] = lighting[right];
  const fraction = (hour - start) / (end - start);
  const ease = fraction * fraction * (3 - 2 * fraction);
  return from.map((value, index) => value + (to[index] - value) * ease);
}
