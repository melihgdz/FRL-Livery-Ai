export function mapShapesToFrl(shapes, imageSize) {
  const halfWidth = Math.max(1, imageSize.width / 2);
  const halfHeight = Math.max(1, imageSize.height / 2);

  return shapes.map((shape) => {
    const centerX = shape.x + shape.width / 2;
    const centerY = shape.y + shape.height / 2;

    return {
      ...shape,
      frlX: clamp(((centerX - halfWidth) / halfWidth) * 100, -100, 100),
      frlY: clamp(((halfHeight - centerY) / halfHeight) * 100, -100, 100),
      frlWidth: clamp((shape.width / imageSize.width) * 200, 0.2, 200),
      frlHeight: clamp((shape.height / imageSize.height) * 200, 0.2, 200),
      frlRotation: normalizeRotation(shape.rotation),
    };
  });
}

function normalizeRotation(rotation) {
  if (!Number.isFinite(rotation)) {
    return 0;
  }

  let value = rotation % 360;
  if (value > 180) {
    value -= 360;
  }
  if (value < -180) {
    value += 360;
  }

  return value;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}