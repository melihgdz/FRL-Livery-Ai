export function exportFrlText(shapes) {
  if (!shapes.length) {
    return '';
  }

  return `${serializeNestedOutput(shapes)}\n`;
}

export function createSummary(shapes) {
  const typeCounts = shapes.reduce((accumulator, shape) => {
    accumulator[shape.type] = (accumulator[shape.type] ?? 0) + 1;
    return accumulator;
  }, {});

  return {
    total: shapes.length,
    circle: typeCounts.circle ?? 0,
    rectangle: typeCounts.rectangle ?? 0,
    triangle: typeCounts.triangle ?? 0,
    line: typeCounts.line ?? 0,
  };
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return '0.00';
  }

  return Number.parseFloat(value).toFixed(2);
}

function formatShapeLine(shape) {
  return (
    shape.id +
    formatHexSigned(shape.frlX) +
    formatHexSigned(shape.frlY) +
    formatHexUnsigned(shape.frlWidth) +
    formatHexUnsigned(shape.frlHeight) +
    formatHexUnsigned(shape.frlRotation) +
    shape.rgba +
    '0001'
  );
}

function serializeNestedOutput(shapes) {
  const grouped = [];
  let currentGroup = [];

  shapes.forEach((shape) => {
    if (shape.depth === 0 && currentGroup.length > 0) {
      grouped.push(currentGroup);
      currentGroup = [shape];
      return;
    }

    currentGroup.push(shape);
  });

  if (currentGroup.length > 0) {
    grouped.push(currentGroup);
  }

  return grouped.map((group) => serializeGroup(group)).join('\n');
}

function serializeGroup(group) {
  const lines = [buildGroupHeader(group), '<'];
  let currentDepth = 0;

  group.forEach((shape) => {
    while (currentDepth < shape.depth) {
      lines.push(`${'    '.repeat(currentDepth)}<`);
      currentDepth += 1;
    }

    while (currentDepth > shape.depth) {
      currentDepth -= 1;
      lines.push(`${'    '.repeat(currentDepth)}>`);
    }

    lines.push(`${'    '.repeat(shape.depth)}${formatShapeLine(shape)}`);
  });

  while (currentDepth > 0) {
    currentDepth -= 1;
    lines.push(`${'    '.repeat(currentDepth)}>`);
  }

  lines.push('>');
  return lines.join('\n');
}

function buildGroupHeader(shapes) {
  const bounds = computeBounds(shapes);
  return [
    'FFFF',
    formatHexSigned(bounds.centerX),
    formatHexSigned(bounds.centerY),
    formatHexUnsigned(bounds.width),
    formatHexUnsigned(bounds.height),
    '0000FFFFFFFF',
    bounds.maxDepth > 0 ? '0009' : '0001',
  ].join('');
}

function computeBounds(shapes) {
  const lefts = shapes.map((shape) => shape.frlX - shape.frlWidth / 2);
  const rights = shapes.map((shape) => shape.frlX + shape.frlWidth / 2);
  const tops = shapes.map((shape) => shape.frlY - shape.frlHeight / 2);
  const bottoms = shapes.map((shape) => shape.frlY + shape.frlHeight / 2);

  const left = Math.min(...lefts);
  const right = Math.max(...rights);
  const top = Math.min(...tops);
  const bottom = Math.max(...bottoms);
  const width = Math.max(1, Math.round(right - left));
  const height = Math.max(1, Math.round(bottom - top));

  return {
    centerX: Math.round(left + width / 2),
    centerY: Math.round(top + height / 2),
    width,
    height,
    maxDepth: Math.max(...shapes.map((shape) => shape.depth), 0),
  };
}

function formatHexSigned(value) {
  const rounded = Math.round(value);
  const normalized = rounded < 0 ? (1 << 16) + rounded : rounded;
  return `${(normalized & 0xffff).toString(16).padStart(4, '0').toUpperCase()}`;
}

function formatHexUnsigned(value) {
  const rounded = Math.max(0, Math.min(0xffff, Math.round(value)));
  return `${rounded.toString(16).padStart(4, '0').toUpperCase()}`;
}