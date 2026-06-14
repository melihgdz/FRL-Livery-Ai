export function exportFrlText(shapes) {
  return shapes
    .map((shape) => {
      const line = [
        shape.id,
        formatNumber(shape.frlX),
        formatNumber(shape.frlY),
        formatNumber(shape.frlWidth),
        formatNumber(shape.frlHeight),
        formatNumber(shape.frlRotation),
        shape.rgba,
      ];

      return line.join(' ');
    })
    .join('\n');
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