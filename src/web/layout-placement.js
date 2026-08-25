// Pure collision helper for the free-drag layout. Kept DOM-free so placement
// behavior can be tested without adding a browser/DOM dependency.
export function findOpenPosition({ boardWidth, width, height, occupied = [], gap = 16 }) {
  const safeBoardWidth = Math.max(1, Number(boardWidth) || 1);
  const safeWidth = Math.min(safeBoardWidth, Math.max(1, Number(width) || 1));
  const safeHeight = Math.max(1, Number(height) || 1);
  const rects = occupied.map(rect => ({
    x: Math.max(0, Number(rect.x) || 0),
    y: Math.max(0, Number(rect.y) || 0),
    w: Math.max(1, Number(rect.w) || 1),
    h: Math.max(1, Number(rect.h) || 1),
  }));

  const xs = [...new Set([0, ...rects.map(rect => rect.x + rect.w + gap)])].sort((a, b) => a - b);
  const ys = [...new Set([0, ...rects.map(rect => rect.y + rect.h + gap)])].sort((a, b) => a - b);
  const overlaps = candidate => rects.some(rect =>
    candidate.x < rect.x + rect.w + gap
    && candidate.x + candidate.w + gap > rect.x
    && candidate.y < rect.y + rect.h + gap
    && candidate.y + candidate.h + gap > rect.y
  );

  for (const y of ys) {
    for (const x of xs) {
      const candidate = { x, y, w: safeWidth, h: safeHeight };
      if (x + safeWidth <= safeBoardWidth && !overlaps(candidate)) return { x, y };
    }
  }

  const bottom = rects.reduce((max, rect) => Math.max(max, rect.y + rect.h), 0);

  return { x: 0, y: bottom ? bottom + gap : 0 };
}
