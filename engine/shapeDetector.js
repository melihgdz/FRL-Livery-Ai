import { sampleForegroundColor, rgbaToHexA } from './imageProcessor.js';

export function detectShapes(imageData, options = {}) {
  const { width, height, mask } = imageData;
  const visited = new Uint8Array(mask.length);
  const shapes = [];
  const minPixels = Math.max(8, options.minShapeSize ?? 8);
  const step = Math.max(1, options.samplingStep ?? 1);

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const startIndex = y * width + x;
      if (visited[startIndex] || mask[startIndex] === 0) {
        continue;
      }

      const component = floodFill(mask, visited, width, height, x, y, step);
      if (component.pixelIndices.length < minPixels) {
        continue;
      }

      const geometry = analyzeComponent(component.pixelIndices, width, height);
      const color = sampleForegroundColor(imageData, component.pixelIndices);
      const type = classifyShape(geometry);

      shapes.push({
        id: SHAPE_IDS[type],
        type,
        rgba: rgbaToHexA(color),
        color,
        ...geometry,
      });
    }
  }

  return shapes;
}

const SHAPE_IDS = {
  circle: '000001',
  rectangle: '000002',
  triangle: '000003',
  line: '000004',
};

function floodFill(mask, visited, width, height, startX, startY, step) {
  const stack = [[startX, startY]];
  const pixelIndices = [];
  const boundaryPoints = [];

  while (stack.length > 0) {
    const [x, y] = stack.pop();

    if (x < 0 || x >= width || y < 0 || y >= height) {
      continue;
    }

    const index = y * width + x;
    if (visited[index] || mask[index] === 0) {
      continue;
    }

    visited[index] = 1;
    pixelIndices.push(index);

    const isBoundary = hasBackgroundNeighbor(mask, width, height, x, y);
    if (isBoundary) {
      boundaryPoints.push({ x, y });
    }

    stack.push([x + step, y]);
    stack.push([x - step, y]);
    stack.push([x, y + step]);
    stack.push([x, y - step]);
  }

  return { pixelIndices, boundaryPoints };
}

function hasBackgroundNeighbor(mask, width, height, x, y) {
  const neighbors = [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ];

  return neighbors.some(([neighborX, neighborY]) => {
    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      return true;
    }

    return mask[neighborY * width + neighborX] === 0;
  });
}

function analyzeComponent(pixelIndices, width, height) {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let totalX = 0;
  let totalY = 0;
  const contour = [];

  for (const pixelIndex of pixelIndices) {
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    totalX += x;
    totalY += y;
    contour.push({ x, y });
  }

  const bboxWidth = Math.max(1, maxX - minX + 1);
  const bboxHeight = Math.max(1, maxY - minY + 1);
  const centerX = totalX / pixelIndices.length;
  const centerY = totalY / pixelIndices.length;
  const fillRatio = pixelIndices.length / (bboxWidth * bboxHeight);
  const contourPoints = simplifyPolygon(convexHull(contour));
  const rotation = estimateRotation(contour);

  return {
    x: minX,
    y: minY,
    width: bboxWidth,
    height: bboxHeight,
    centerX,
    centerY,
    area: pixelIndices.length,
    fillRatio,
    contour: contourPoints,
    perimeter: estimatePerimeter(contour),
    rotation,
  };
}

function classifyShape(geometry) {
  const aspectRatio = geometry.width / geometry.height;
  const compactness = geometry.area / Math.max(1, geometry.width * geometry.height);
  const circularity = (4 * Math.PI * geometry.area) / Math.max(1, geometry.perimeter ** 2);
  const vertexCount = geometry.contour.length;
  const narrowLine = geometry.width < 7 || geometry.height < 7 || compactness < 0.16;

  if (narrowLine || (Math.max(aspectRatio, 1 / aspectRatio) > 6 && compactness < 0.35)) {
    return 'line';
  }

  if (vertexCount <= 3) {
    return 'triangle';
  }

  if (circularity > 0.68 && vertexCount > 5) {
    return 'circle';
  }

  if (vertexCount >= 4 && geometry.fillRatio > 0.52) {
    return 'rectangle';
  }

  if (vertexCount === 4) {
    return 'rectangle';
  }

  return circularity > 0.5 ? 'circle' : 'rectangle';
}

function estimatePerimeter(points) {
  if (points.length < 2) {
    return 1;
  }

  let perimeter = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    perimeter += Math.hypot(next.x - current.x, next.y - current.y);
  }

  return perimeter;
}

function estimateRotation(points) {
  if (points.length < 2) {
    return 0;
  }

  let meanX = 0;
  let meanY = 0;
  for (const point of points) {
    meanX += point.x;
    meanY += point.y;
  }

  meanX /= points.length;
  meanY /= points.length;

  let covarianceXX = 0;
  let covarianceYY = 0;
  let covarianceXY = 0;

  for (const point of points) {
    const deltaX = point.x - meanX;
    const deltaY = point.y - meanY;
    covarianceXX += deltaX * deltaX;
    covarianceYY += deltaY * deltaY;
    covarianceXY += deltaX * deltaY;
  }

  return (0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY) * 180) / Math.PI;
}

function convexHull(points) {
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  if (sorted.length <= 3) {
    return sorted;
  }

  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function cross(origin, left, right) {
  return (left.x - origin.x) * (right.y - origin.y) - (left.y - origin.y) * (right.x - origin.x);
}

function simplifyPolygon(points) {
  if (points.length <= 4) {
    return points;
  }

  const target = points.length > 12 ? 6 : 5;
  const step = Math.max(1, Math.floor(points.length / target));
  const simplified = [];

  for (let index = 0; index < points.length; index += step) {
    simplified.push(points[index]);
  }

  return simplified.length >= 3 ? simplified : points.slice(0, 3);
}