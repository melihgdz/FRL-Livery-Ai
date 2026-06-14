const DEFAULT_MAX_DIMENSION = 1400;

export async function loadImageFromFile(file) {
  if (!file) {
    throw new Error('No file provided');
  }

  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    return loadSvgImage(file);
  }

  return loadRasterImage(file);
}

async function loadRasterImage(file) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Image could not be loaded'));
      element.src = objectUrl;
    });

    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadSvgImage(file) {
  const text = await file.text();
  const svgBlob = new Blob([text], { type: 'image/svg+xml' });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('SVG could not be rendered'));
      element.src = objectUrl;
    });

    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function createWorkingCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function fitImageSize(imageWidth, imageHeight, maxDimension = DEFAULT_MAX_DIMENSION) {
  const scale = Math.min(1, maxDimension / Math.max(imageWidth, imageHeight));
  return {
    width: Math.max(1, Math.round(imageWidth * scale)),
    height: Math.max(1, Math.round(imageHeight * scale)),
    scale,
  };
}

export function drawImageToCanvas(image, canvas, detailMode = 'balanced') {
  const maxDimension = detailMode === 'high' ? 1600 : detailMode === 'low' ? 900 : DEFAULT_MAX_DIMENSION;
  const fitted = fitImageSize(image.width, image.height, maxDimension);

  canvas.width = fitted.width;
  canvas.height = fitted.height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Canvas context unavailable');
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, fitted.width, fitted.height);

  return fitted;
}

export function getImageData(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Canvas context unavailable');
  }

  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export function applyPreprocessing(imageData, { noiseReduction = 3, detailMode = 'balanced' } = {}) {
  const grayscale = toGrayscale(imageData);
  const denoised = noiseReduction > 0 ? boxBlur(grayscale, noiseReduction >= 6 ? 2 : 1) : grayscale;
  const threshold = otsuThreshold(denoised.data);
  const binary = thresholdImage(denoised, threshold);

  return {
    ...binary,
    threshold,
    samplingStep: detailMode === 'low' ? 2 : 1,
  };
}

function toGrayscale(imageData) {
  const { width, height, data } = imageData;
  const output = new Uint8ClampedArray(width * height * 4);

  for (let index = 0; index < data.length; index += 4) {
    const luminance = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
    output[index] = luminance;
    output[index + 1] = luminance;
    output[index + 2] = luminance;
    output[index + 3] = data[index + 3];
  }

  return { width, height, data: output };
}

function boxBlur(imageData, radius) {
  const { width, height, data } = imageData;
  const output = new Uint8ClampedArray(data.length);
  const kernel = Math.max(1, radius);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let samples = 0;

      for (let dy = -kernel; dy <= kernel; dy += 1) {
        for (let dx = -kernel; dx <= kernel; dx += 1) {
          const sampleX = x + dx;
          const sampleY = y + dy;

          if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) {
            continue;
          }

          const sourceIndex = (sampleY * width + sampleX) * 4;
          total += data[sourceIndex];
          samples += 1;
        }
      }

      const targetIndex = (y * width + x) * 4;
      const value = Math.round(total / Math.max(1, samples));
      output[targetIndex] = value;
      output[targetIndex + 1] = value;
      output[targetIndex + 2] = value;
      output[targetIndex + 3] = data[targetIndex + 3];
    }
  }

  return { width, height, data: output };
}

function otsuThreshold(data) {
  const histogram = new Array(256).fill(0);
  let total = 0;

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) {
      continue;
    }

    histogram[data[index]] += 1;
    total += 1;
  }

  let sum = 0;
  for (let i = 0; i < 256; i += 1) {
    sum += i * histogram[i];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let i = 0; i < 256; i += 1) {
    weightBackground += histogram[i];
    if (weightBackground === 0) {
      continue;
    }

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) {
      break;
    }

    sumBackground += i * histogram[i];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = i;
    }
  }

  return threshold;
}

function thresholdImage(imageData, threshold) {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);

  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    const alpha = data[index + 3];
    mask[pixel] = alpha > 10 && data[index] >= threshold ? 1 : 0;
  }

  return { width, height, mask, data };
}

export function sampleForegroundColor(imageData, componentPixels) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;

  for (const pixelIndex of componentPixels) {
    const dataIndex = pixelIndex * 4;
    red += imageData.data[dataIndex];
    green += imageData.data[dataIndex + 1];
    blue += imageData.data[dataIndex + 2];
    alpha += imageData.data[dataIndex + 3];
  }

  const count = Math.max(1, componentPixels.length);
  return {
    r: Math.round(red / count),
    g: Math.round(green / count),
    b: Math.round(blue / count),
    a: Math.round(alpha / count),
  };
}

export function rgbaToHexA({ r, g, b, a }) {
  return [r, g, b, a]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0').toUpperCase())
    .join('');
}