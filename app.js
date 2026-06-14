import { applyPreprocessing, drawImageToCanvas, getImageData, loadImageFromFile, createWorkingCanvas } from './engine/imageProcessor.js';
import { detectShapes } from './engine/shapeDetector.js';
import { mapShapesToFrl } from './engine/coordinateMapper.js';
import { optimizeShapes, restoreOriginalShapes } from './engine/optimizer.js';
import { createSummary, exportFrlText } from './engine/frlExporter.js';

const state = {
  file: null,
  originalShapes: [],
  optimizedShapes: [],
  image: null,
  imageSize: { width: 0, height: 0 },
  outputText: '',
  summary: null,
};

const refs = {
  fileInput: document.getElementById('fileInput'),
  dropZone: document.getElementById('dropZone'),
  previewCanvas: document.getElementById('previewCanvas'),
  outputText: document.getElementById('outputText'),
  convertBtn: document.getElementById('convertBtn'),
  copyBtn: document.getElementById('copyBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  resetBtn: document.getElementById('resetBtn'),
  undoOptimizationBtn: document.getElementById('undoOptimizationBtn'),
  performanceMode: document.getElementById('performanceMode'),
  compressionLevel: document.getElementById('compressionLevel'),
  minShapeSize: document.getElementById('minShapeSize'),
  noiseReduction: document.getElementById('noiseReduction'),
  layerCount: document.getElementById('layerCount'),
  statusLabel: document.getElementById('statusLabel'),
  modeLabel: document.getElementById('modeLabel'),
  summaryLabel: document.getElementById('summaryLabel'),
};

const workingCanvas = createWorkingCanvas(1, 1);

registerEvents();
registerPwa();
drawIdlePreview();

function registerEvents() {
  refs.fileInput.addEventListener('change', handleFileSelection);
  refs.convertBtn.addEventListener('click', () => convertCurrentImage());
  refs.copyBtn.addEventListener('click', copyOutputToClipboard);
  refs.downloadBtn.addEventListener('click', downloadOutput);
  refs.resetBtn.addEventListener('click', resetApp);
  refs.undoOptimizationBtn.addEventListener('click', undoOptimization);
  refs.performanceMode.addEventListener('change', updateModeLabel);

  const dragEvents = ['dragenter', 'dragover'];
  dragEvents.forEach((eventName) => {
    refs.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      refs.dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    refs.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      refs.dropZone.classList.remove('drag-over');
    });
  });

  refs.dropZone.addEventListener('drop', async (event) => {
    const [file] = event.dataTransfer.files;
    if (file) {
      await handleFile(file);
    }
  });
}

async function handleFileSelection(event) {
  const [file] = event.target.files;
  if (file) {
    await handleFile(file);
  }
}

async function handleFile(file) {
  setStatus('Loading');
  state.file = file;

  try {
    state.image = await loadImageFromFile(file);
    const context = workingCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('Canvas unavailable');
    }

    const imageSize = drawImageToCanvas(state.image, workingCanvas, refs.performanceMode.value);
    state.imageSize = imageSize;
    renderPreview();
    setStatus('Ready');
    refs.summaryLabel.textContent = `${file.name} loaded. Ready to convert.`;
  } catch (error) {
    setStatus('Error');
    refs.summaryLabel.textContent = error.message;
  }
}

async function convertCurrentImage() {
  if (!state.image) {
    setStatus('No image');
    refs.summaryLabel.textContent = 'Upload an image first.';
    return;
  }

  setStatus('Converting');

  try {
    const imageData = getImageData(workingCanvas);
    const preprocessing = applyPreprocessing(imageData, {
      noiseReduction: Number(refs.noiseReduction.value),
      detailMode: refs.performanceMode.value,
    });

    const detected = detectShapes(preprocessing, {
      minShapeSize: Number(refs.minShapeSize.value),
      samplingStep: preprocessing.samplingStep,
    });

    state.originalShapes = mapShapesToFrl(detected, state.imageSize);
    state.optimizedShapes = optimizeShapes(state.originalShapes, {
      maxLayers: 1300,
      minArea: Number(refs.minShapeSize.value),
      compressionLevel: Number(refs.compressionLevel.value),
    });

    state.outputText = exportFrlText(state.optimizedShapes);
    state.summary = createSummary(state.optimizedShapes);
    refs.outputText.value = state.outputText;
    refs.layerCount.textContent = String(state.optimizedShapes.length);
    refs.summaryLabel.textContent = formatSummary(state.summary);
    setStatus('Converted');
    renderPreview();
  } catch (error) {
    setStatus('Error');
    refs.summaryLabel.textContent = error.message;
  }
}

function renderPreview() {
  const context = refs.previewCanvas.getContext('2d');
  if (!context) {
    return;
  }

  const sourceWidth = workingCanvas.width;
  const sourceHeight = workingCanvas.height;
  const canvasWidth = refs.previewCanvas.width;
  const canvasHeight = refs.previewCanvas.height;
  context.clearRect(0, 0, canvasWidth, canvasHeight);

  if (sourceWidth === 0 || sourceHeight === 0) {
    drawIdlePreview();
    return;
  }

  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const offsetX = (canvasWidth - drawWidth) / 2;
  const offsetY = (canvasHeight - drawHeight) / 2;

  context.drawImage(workingCanvas, offsetX, offsetY, drawWidth, drawHeight);

  if (state.optimizedShapes.length === 0 && state.originalShapes.length === 0) {
    return;
  }

  const overlayShapes = state.optimizedShapes.length > 0 ? state.optimizedShapes : state.originalShapes;
  context.save();
  context.translate(offsetX, offsetY);
  context.scale(scale, scale);
  context.lineWidth = Math.max(1.2, 2 / scale);
  context.strokeStyle = 'rgba(255, 36, 0, 0.8)';
  context.fillStyle = 'rgba(255, 36, 0, 0.16)';

  overlayShapes.slice(0, 200).forEach((shape) => {
    context.save();
    context.translate(shape.x + shape.width / 2, shape.y + shape.height / 2);
    context.rotate((shape.rotation * Math.PI) / 180);
    context.beginPath();

    if (shape.type === 'circle') {
      context.ellipse(0, 0, shape.width / 2, shape.height / 2, 0, 0, Math.PI * 2);
    } else if (shape.type === 'triangle') {
      context.moveTo(0, -shape.height / 2);
      context.lineTo(shape.width / 2, shape.height / 2);
      context.lineTo(-shape.width / 2, shape.height / 2);
      context.closePath();
    } else if (shape.type === 'line') {
      context.moveTo(-shape.width / 2, 0);
      context.lineTo(shape.width / 2, 0);
    } else {
      context.rect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
    }

    context.fill();
    context.stroke();
    context.restore();
  });

  context.restore();
}

function drawIdlePreview() {
  const context = refs.previewCanvas.getContext('2d');
  if (!context) {
    return;
  }

  const width = refs.previewCanvas.width;
  const height = refs.previewCanvas.height;
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#101826');
  gradient.addColorStop(1, '#06080c');

  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  context.lineWidth = 2;

  for (let index = 0; index < 12; index += 1) {
    const position = (index / 12) * width;
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, height);
    context.stroke();
  }

  context.fillStyle = 'rgba(255, 255, 255, 0.16)';
  context.font = '700 28px Trebuchet MS';
  context.textAlign = 'center';
  context.fillText('Preview will appear here', width / 2, height / 2);
}

async function copyOutputToClipboard() {
  if (!refs.outputText.value) {
    return;
  }

  await navigator.clipboard.writeText(refs.outputText.value);
  setStatus('Copied');
  refs.summaryLabel.textContent = 'Output copied to clipboard.';
}

function downloadOutput() {
  if (!refs.outputText.value) {
    return;
  }

  const blob = new Blob([refs.outputText.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'frl-livery.txt';
  anchor.click();
  URL.revokeObjectURL(url);
}

function resetApp() {
  state.file = null;
  state.image = null;
  state.imageSize = { width: 0, height: 0 };
  state.originalShapes = [];
  state.optimizedShapes = [];
  state.outputText = '';
  state.summary = null;
  refs.fileInput.value = '';
  refs.outputText.value = '';
  refs.layerCount.textContent = '0';
  refs.summaryLabel.textContent = 'Waiting for input';
  setStatus('Idle');
  drawIdlePreview();
}

function undoOptimization() {
  if (state.originalShapes.length === 0) {
    return;
  }

  const restored = restoreOriginalShapes(state.originalShapes);
  state.optimizedShapes = restored;
  state.outputText = exportFrlText(restored);
  state.summary = createSummary(restored);
  refs.outputText.value = state.outputText;
  refs.layerCount.textContent = String(restored.length);
  refs.summaryLabel.textContent = formatSummary(state.summary);
  renderPreview();
}

function updateModeLabel() {
  const modeNames = {
    balanced: 'Balanced',
    low: 'Low memory',
    high: 'High detail',
  };

  refs.modeLabel.textContent = modeNames[refs.performanceMode.value] ?? 'Balanced';
}

function setStatus(status) {
  refs.statusLabel.textContent = status;
}

function formatSummary(summary) {
  return `Total ${summary.total} layers | circle ${summary.circle} | rectangle ${summary.rectangle} | triangle ${summary.triangle} | line ${summary.line}`;
}

async function registerPwa() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register('./service-worker.js');
  } catch {
    // Offline enhancement only.
  }
}