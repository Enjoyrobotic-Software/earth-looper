export const STATUS_HEX = {
  conflict: '#e05555',
  tension: '#d4854a',
  stable: '#4caf7d',
  authoritarian: '#9c6dd4',
  neutral: '#4a90d4',
};

export function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function toHex(rgb) {
  return '#' + rgb.map(v => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0')).join('');
}

export const LAYERS = {
  conflict: d => {
    const m = {
      conflict: [.88, .33, .33],
      tension: [.83, .52, .29],
      stable: [.3, .69, .48],
      authoritarian: [.61, .43, .83],
      neutral: [.29, .56, .83],
    };
    return m[d.s] || m.neutral;
  },
  democracy: d => lerp3([.85, .15, .15], [.2, .78, .4], d.dem / 100),
  gdp: d => lerp3([.08, .15, .35], [.95, .75, .15], Math.min(d.gdp / 100000, 1)),
  nuclear: d => (d.nuc ? [.9, .2, .2] : (d.s === 'conflict' ? [.85, .52, .29] : [.12, .22, .38])),
};
