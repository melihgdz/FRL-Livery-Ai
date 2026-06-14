export function optimizeShapes(shapes, options = {}) {
  const maxLayers = options.maxLayers ?? 1300;
  const minArea = options.minArea ?? 8;
  const compressionLevel = clamp01((options.compressionLevel ?? 35) / 100);
  const colorTolerance = 20 + compressionLevel * 55;
  const distanceTolerance = 8 + compressionLevel * 36;

  const filtered = shapes.filter((shape) => shape.area >= minArea);
  const mergedColors = mergeSimilarShapes(filtered, colorTolerance, distanceTolerance);

  if (mergedColors.length <= maxLayers) {
    return mergedColors;
  }

  return simplifyToLimit(mergedColors, maxLayers);
}

export function restoreOriginalShapes(originalShapes) {
  return originalShapes.map((shape) => ({ ...shape }));
}

function mergeSimilarShapes(shapes, colorTolerance, distanceTolerance) {
  const merged = [];

  for (const shape of shapes) {
    const candidate = merged.find((existing) => {
      if (existing.type !== shape.type) {
        return false;
      }

      const colorDelta = colorDistance(existing.color, shape.color);
      const centerDelta = Math.hypot(existing.centerX - shape.centerX, existing.centerY - shape.centerY);
      return colorDelta <= colorTolerance && centerDelta <= distanceTolerance;
    });

    if (!candidate) {
      merged.push({ ...shape });
      continue;
    }

    const totalArea = candidate.area + shape.area;
    const weightedRatio = shape.area / Math.max(1, totalArea);
    candidate.centerX = candidate.centerX * (1 - weightedRatio) + shape.centerX * weightedRatio;
    candidate.centerY = candidate.centerY * (1 - weightedRatio) + shape.centerY * weightedRatio;
    candidate.width = Math.max(candidate.width, shape.width);
    candidate.height = Math.max(candidate.height, shape.height);
    candidate.area = totalArea;
    candidate.rotation = averageAngle(candidate.rotation, shape.rotation, weightedRatio);
    candidate.color = blendColor(candidate.color, shape.color, candidate.area, shape.area);
    candidate.rgba = toHexA(candidate.color);
    candidate.x = Math.min(candidate.x, shape.x);
    candidate.y = Math.min(candidate.y, shape.y);
    candidate.width = Math.max(candidate.width, shape.x + shape.width - candidate.x);
    candidate.height = Math.max(candidate.height, shape.y + shape.height - candidate.y);
  }

  return merged;
}

function simplifyToLimit(shapes, maxLayers) {
  const sorted = [...shapes].sort((left, right) => right.area - left.area);
  return sorted.slice(0, maxLayers);
}

function colorDistance(first, second) {
  return Math.hypot(first.r - second.r, first.g - second.g, first.b - second.b, first.a - second.a / 2);
}

function blendColor(base, next, baseArea, nextArea) {
  const total = Math.max(1, baseArea + nextArea);
  return {
    r: Math.round((base.r * baseArea + next.r * nextArea) / total),
    g: Math.round((base.g * baseArea + next.g * nextArea) / total),
    b: Math.round((base.b * baseArea + next.b * nextArea) / total),
    a: Math.round((base.a * baseArea + next.a * nextArea) / total),
  };
}

function averageAngle(first, second, weight) {
  const firstRadians = (first * Math.PI) / 180;
  const secondRadians = (second * Math.PI) / 180;
  const x = Math.cos(firstRadians) * (1 - weight) + Math.cos(secondRadians) * weight;
  const y = Math.sin(firstRadians) * (1 - weight) + Math.sin(secondRadians) * weight;
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function toHexA({ r, g, b, a }) {
  return [r, g, b, a]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}