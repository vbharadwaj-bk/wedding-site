const DEFAULT_DESIGN_RATIO = 1920 / 1080;
const RATIO_EPSILON = 0.0005;
const DB_NAME = 'croptool-state';
const DB_VERSION = 1;
const DB_STORE = 'handles';
const DB_KEY = 'selected-folder-handle';

const state = {
  images: [],
  selectedIndex: -1,
  folderHandle: null,
  folderName: '',
  designPointsByImage: {},
  ratioValue: DEFAULT_DESIGN_RATIO,
  ratioMin: 0.4,
  ratioMax: 2.4,
  ratioStep: 0.001,
  snapThreshold: 0.02,
  drag: {
    active: false,
    mode: null,
    pointerId: null,
    lastX: 0,
    lastY: 0
  },
  renderCache: null
};

const els = {
  pickFolderBtn: document.getElementById('pick-folder-btn'),
  thumbStrip: document.getElementById('thumb-strip'),
  thumbLeft: document.getElementById('thumb-left'),
  thumbRight: document.getElementById('thumb-right'),
  canvas: document.getElementById('main-canvas'),
  emptyState: document.getElementById('empty-state'),
  aspectSlider: document.getElementById('aspect-slider'),
  designPointStrip: document.getElementById('design-point-strip'),
  aspectLabel: document.getElementById('aspect-label'),
  removeDesignPointBtn: document.getElementById('remove-design-point-btn'),
  saveCropSettingsBtn: document.getElementById('save-crop-settings-btn'),
  selectedName: document.getElementById('selected-name'),
  selectedX: document.getElementById('selected-x'),
  selectedY: document.getElementById('selected-y'),
  centersJson: document.getElementById('centers-json')
};

const ctx = els.canvas.getContext('2d');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function quoteYamlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function isSupportedImage(file) {
  if (!file) {
    return false;
  }

  const lower = file.name.toLowerCase();
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg');
}

function isProbablyYamlFile(file) {
  return file && file.name.toLowerCase() === 'crops.yaml';
}

function loadImageFromRecord(record) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      resolve({
        name: record.name,
        displayName: record.displayName || record.name,
        url: record.dataUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
        element: img
      });
    };

    img.onerror = () => {
      reject(new Error(`Failed to load image: ${record.name}`));
    };

    img.src = record.dataUrl;
  });
}

function makeDefaultCrop(imageWidth, imageHeight, ratioValue) {
  const maxCoverage = 0.7;
  const maxW = imageWidth * maxCoverage;
  const maxH = imageHeight * maxCoverage;

  let boxW = maxW;
  let boxH = boxW / ratioValue;

  if (boxH > maxH) {
    boxH = maxH;
    boxW = boxH * ratioValue;
  }

  return {
    x: imageWidth / 2,
    y: imageHeight / 2,
    w: boxW,
    h: boxH
  };
}

function makeDefaultDesignPoint(image) {
  const crop = makeDefaultCrop(image.width, image.height, DEFAULT_DESIGN_RATIO);
  return {
    aspectRatio: DEFAULT_DESIGN_RATIO,
    x: crop.x,
    y: crop.y,
    scale: crop.w
  };
}

function openStateDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open IndexedDB'));
  });
}

async function fetchLastFolderCache() {
  const response = await fetch('/api/last-folder');
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    return null;
  }

  return payload.data || null;
}

async function saveLastFolderCache(folderPath, folderName) {
  if (!folderPath) {
    return;
  }

  await fetch('/api/last-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath, folderName })
  });
}

async function requestFolderSelection() {
  const response = await fetch('/api/folder-path', { method: 'POST' });
  const payload = await response.json();

  if (payload.cancelled) {
    return null;
  }

  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error || 'Folder selection failed');
  }

  return payload.data;
}

async function fetchFolderData(folderPath) {
  const response = await fetch('/api/read-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath })
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Folder load failed');
  }

  return payload.data;
}

async function deleteCropsFile(folderPath) {
  const response = await fetch('/api/delete-crops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath })
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Unable to delete crops.yaml');
  }
}

async function parseCropsYamlText(content) {
  const response = await fetch('/api/parse-crops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Design point parse failed');
  }

  return payload.designPointsByImage || {};
}

function buildCropYaml(designPointsByImage) {
  const lines = ['images:'];
  const imageNames = Object.keys(designPointsByImage).sort((a, b) => a.localeCompare(b));

  for (const imageName of imageNames) {
    lines.push(`  ${quoteYamlString(imageName)}:`);
    const points = getDesignPointEntries(designPointsByImage, imageName);

    for (const point of points) {
      lines.push(`    - aspectRatio: ${formatNumber(point.aspectRatio)}`);
      lines.push(`      x: ${formatNumber(point.x)}`);
      lines.push(`      y: ${formatNumber(point.y)}`);
      lines.push(`      scale: ${formatNumber(point.scale)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function buildSerializableDesignPoints(designPointsByImage) {
  const serializable = {};
  const imageNames = Object.keys(designPointsByImage).sort((a, b) => a.localeCompare(b));

  for (const imageName of imageNames) {
    const points = getDesignPointEntries(designPointsByImage, imageName);
    serializable[imageName] = points.map((point) => ({
      aspectRatio: Number(point.aspectRatio),
      x: Number(point.x),
      y: Number(point.y),
      scale: Number(point.scale)
    }));
  }

  return serializable;
}

function buildCropLookupJs(designPointsByImage) {
  const serialized = JSON.stringify(buildSerializableDesignPoints(designPointsByImage), null, 2);

  return [
    '/* Auto-generated by Crop Center Tool. */',
    'const CROP_DESIGN_POINTS = ' + serialized + ';',
    '',
    'const RATIO_EPSILON = 0.0005;',
    '',
    'function lerp(a, b, t) {',
    '  return a + (b - a) * t;',
    '}',
    '',
    'function getCropCenterAndScale(imageName, aspectRatio) {',
    '  const ratio = Number(aspectRatio);',
    '  if (!imageName || !Number.isFinite(ratio)) {',
    '    return null;',
    '  }',
    '',
    '  const points = CROP_DESIGN_POINTS[imageName];',
    '  if (!Array.isArray(points) || points.length === 0) {',
    '    return null;',
    '  }',
    '',
    '  const sorted = points.slice().sort((a, b) => a.aspectRatio - b.aspectRatio);',
    '  const exact = sorted.find((point) => Math.abs(point.aspectRatio - ratio) <= RATIO_EPSILON);',
    '  if (exact) {',
    '    return { x: exact.x, y: exact.y, scale: exact.scale };',
    '  }',
    '',
    '  if (ratio <= sorted[0].aspectRatio) {',
    '    return { x: sorted[0].x, y: sorted[0].y, scale: sorted[0].scale };',
    '  }',
    '',
    '  const last = sorted[sorted.length - 1];',
    '  if (ratio >= last.aspectRatio) {',
    '    return { x: last.x, y: last.y, scale: last.scale };',
    '  }',
    '',
    '  for (let i = 0; i < sorted.length - 1; i += 1) {',
    '    const lower = sorted[i];',
    '    const upper = sorted[i + 1];',
    '    if (ratio >= lower.aspectRatio && ratio <= upper.aspectRatio) {',
    '      const t = (ratio - lower.aspectRatio) / (upper.aspectRatio - lower.aspectRatio);',
    '      return {',
    '        x: lerp(lower.x, upper.x, t),',
    '        y: lerp(lower.y, upper.y, t),',
    '        scale: lerp(lower.scale, upper.scale, t)',
    '      };',
    '    }',
    '  }',
    '',
    '  return null;',
    '}',
    '',
    'if (typeof module !== "undefined" && module.exports) {',
    '  module.exports = { CROP_DESIGN_POINTS, getCropCenterAndScale };',
    '}',
    '',
    'if (typeof window !== "undefined") {',
    '  window.CROP_DESIGN_POINTS = CROP_DESIGN_POINTS;',
    '  window.getCropCenterAndScale = getCropCenterAndScale;',
    '}',
    ''
  ].join('\n');
}

async function writeCurrentCropSettings() {
  if (!state.folderHandle) {
    throw new Error('Select a folder before saving crop settings.');
  }

  const yamlText = buildCropYaml(state.designPointsByImage);
  const jsText = buildCropLookupJs(state.designPointsByImage);
  const response = await fetch('/api/save-crops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath: state.folderHandle, content: yamlText, jsContent: jsText })
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Unable to save crop settings');
  }
}

async function saveCurrentCropSettingsWithFeedback() {
  const originalLabel = els.saveCropSettingsBtn.textContent;
  els.saveCropSettingsBtn.textContent = 'Saving...';

  try {
    await writeCurrentCropSettings();
    els.saveCropSettingsBtn.textContent = 'Saved';
    setTimeout(() => {
      els.saveCropSettingsBtn.textContent = originalLabel;
    }, 900);
  } catch (error) {
    console.warn(error);
    els.saveCropSettingsBtn.textContent = 'Save failed';
    setTimeout(() => {
      els.saveCropSettingsBtn.textContent = originalLabel;
    }, 1100);
    window.alert(error.message || 'Unable to save crop settings.');
  }
}

async function autoSaveCropSettings() {
  try {
    await writeCurrentCropSettings();
  } catch (error) {
    console.warn(error);
  }
}

function getSelectedImage() {
  if (state.selectedIndex < 0 || state.selectedIndex >= state.images.length) {
    return null;
  }

  return state.images[state.selectedIndex];
}

function getDesignPointsMapForImage(imageName) {
  return state.designPointsByImage[imageName] || null;
}

function normalizeDesignPointEntry(point) {
  const aspectRatio = Number(point && point.aspectRatio);
  const x = Number(point && point.x);
  const y = Number(point && point.y);
  const scale = Number(point && point.scale);

  if (!Number.isFinite(aspectRatio) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale)) {
    return null;
  }

  return { aspectRatio, x, y, scale };
}

function normalizeDesignPointEntries(entries) {
  if (!entries) {
    return [];
  }

  const normalized = [];

  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const point = normalizeDesignPointEntry(entry);
      if (point) {
        normalized.push(point);
      }
    }
  } else if (typeof entries === 'object') {
    for (const [key, value] of Object.entries(entries)) {
      const point = normalizeDesignPointEntry({
        aspectRatio: value && value.aspectRatio !== undefined ? value.aspectRatio : key,
        x: value && value.x,
        y: value && value.y,
        scale: value && value.scale
      });

      if (point) {
        normalized.push(point);
      }
    }
  }

  normalized.sort((a, b) => a.aspectRatio - b.aspectRatio);
  return normalized;
}

function setDesignPointsMapForImage(imageName, points) {
  state.designPointsByImage[imageName] = normalizeDesignPointEntries(points);
}

function getDesignPointEntries(designPointsByImage = state.designPointsByImage, imageName = null) {
  const targetName = imageName || getSelectedImage()?.name;
  if (!targetName) {
    return [];
  }

  return normalizeDesignPointEntries(designPointsByImage[targetName]);
}

function setDesignPointEntries(imageName, entries) {
  setDesignPointsMapForImage(imageName, entries);
}

function ensureDesignPointsForImage(imageName, imageWidth, imageHeight, changedImages = new Set()) {
  const currentEntries = getDesignPointEntries(state.designPointsByImage, imageName);
  if (currentEntries.length > 0) {
    return;
  }

  const defaultPoint = makeDefaultDesignPoint({ width: imageWidth, height: imageHeight });
  setDesignPointEntries(imageName, [defaultPoint]);
  changedImages.add(imageName);
}

function ensureDesignPointsForLoadedImages(changedImages = new Set()) {
  for (const image of state.images) {
    ensureDesignPointsForImage(image.name, image.width, image.height, changedImages);
  }
}

function findExactDesignPointIndex(points, ratio) {
  return points.findIndex((point) => Math.abs(point.aspectRatio - ratio) <= RATIO_EPSILON);
}

function findNearestDesignPoint(points, ratio) {
  if (points.length === 0) {
    return { index: -1, distance: Infinity };
  }

  let bestIndex = 0;
  let bestDistance = Math.abs(points[0].aspectRatio - ratio);

  for (let i = 1; i < points.length; i += 1) {
    const distance = Math.abs(points[i].aspectRatio - ratio);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return { index: bestIndex, distance: bestDistance };
}

function clampCropToImage(crop, imageWidth, imageHeight, ratioValue) {
  crop.x = clamp(crop.x, 0, imageWidth);
  crop.y = clamp(crop.y, 0, imageHeight);

  const maxScaleByX = 2 * Math.min(crop.x, imageWidth - crop.x);
  const maxScaleByY = 2 * Math.min(crop.y, imageHeight - crop.y) * ratioValue;
  const maxScale = Math.max(2, Math.min(maxScaleByX, maxScaleByY, imageWidth, imageHeight * ratioValue));

  crop.w = clamp(crop.w, 2, maxScale);
  crop.h = crop.w / ratioValue;
  crop.x = clamp(crop.x, crop.w / 2, imageWidth - crop.w / 2);
  crop.y = clamp(crop.y, crop.h / 2, imageHeight - crop.h / 2);
}

function resolveCropAtRatio(points, ratio, imageWidth, imageHeight) {
  if (points.length === 0) {
    const fallback = makeDefaultCrop(imageWidth, imageHeight, ratio);
    return { crop: fallback, exactIndex: -1 };
  }

  const exactIndex = findExactDesignPointIndex(points, ratio);
  let crop;

  if (exactIndex !== -1) {
    const point = points[exactIndex];
    crop = { x: point.x, y: point.y, w: point.scale, h: point.scale / ratio };
  } else if (ratio <= points[0].aspectRatio) {
    const point = points[0];
    crop = { x: point.x, y: point.y, w: point.scale, h: point.scale / ratio };
  } else if (ratio >= points[points.length - 1].aspectRatio) {
    const point = points[points.length - 1];
    crop = { x: point.x, y: point.y, w: point.scale, h: point.scale / ratio };
  } else {
    let lower = points[0];
    let upper = points[points.length - 1];

    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (ratio >= a.aspectRatio && ratio <= b.aspectRatio) {
        lower = a;
        upper = b;
        break;
      }
    }

    const t = (ratio - lower.aspectRatio) / (upper.aspectRatio - lower.aspectRatio);
    const scale = lerp(lower.scale, upper.scale, t);
    crop = {
      x: lerp(lower.x, upper.x, t),
      y: lerp(lower.y, upper.y, t),
      w: scale,
      h: scale / ratio
    };
  }

  clampCropToImage(crop, imageWidth, imageHeight, ratio);
  return { crop, exactIndex };
}

function upsertDesignPoint(points, ratio, crop) {
  const exactIndex = findExactDesignPointIndex(points, ratio);
  const nextPoint = {
    aspectRatio: ratio,
    x: crop.x,
    y: crop.y,
    scale: crop.w
  };

  if (exactIndex !== -1) {
    points[exactIndex] = nextPoint;
    return exactIndex;
  }

  points.push(nextPoint);
  points.sort((a, b) => a.aspectRatio - b.aspectRatio);
  return findExactDesignPointIndex(points, ratio);
}

function getCurrentCropPoints() {
  const selected = getSelectedImage();
  if (!selected) {
    return [];
  }

  return getDesignPointEntries(state.designPointsByImage, selected.name);
}

function ensureEditableDesignPointAtCurrentRatio() {
  const selected = getSelectedImage();
  if (!selected) {
    return null;
  }

  const points = getCurrentCropPoints();
  const exactIndex = findExactDesignPointIndex(points, state.ratioValue);
  if (exactIndex !== -1) {
    return { points, exactIndex, changed: false };
  }

  const resolved = resolveCropAtRatio(points, state.ratioValue, selected.width, selected.height).crop;
  const workingPoints = [...points];
  const newIndex = upsertDesignPoint(workingPoints, state.ratioValue, resolved);
  setDesignPointEntries(selected.name, workingPoints);
  return { points: workingPoints, exactIndex: newIndex, changed: true };
}

function fitImageToCanvas(imgWidth, imgHeight, canvasWidth, canvasHeight) {
  const imgRatio = imgWidth / imgHeight;
  const canvasRatio = canvasWidth / canvasHeight;

  let drawWidth;
  let drawHeight;
  let drawX;
  let drawY;

  if (imgRatio > canvasRatio) {
    drawWidth = canvasWidth;
    drawHeight = canvasWidth / imgRatio;
    drawX = 0;
    drawY = (canvasHeight - drawHeight) / 2;
  } else {
    drawHeight = canvasHeight;
    drawWidth = canvasHeight * imgRatio;
    drawX = (canvasWidth - drawWidth) / 2;
    drawY = 0;
  }

  return { x: drawX, y: drawY, w: drawWidth, h: drawHeight };
}

function getCropRectInCanvas(crop, imageWidth, imageHeight, drawRect) {
  const centerCanvasX = drawRect.x + (crop.x / imageWidth) * drawRect.w;
  const centerCanvasY = drawRect.y + (crop.y / imageHeight) * drawRect.h;
  const boxCanvasW = (crop.w / imageWidth) * drawRect.w;
  const boxCanvasH = (crop.h / imageHeight) * drawRect.h;

  return {
    x: centerCanvasX - boxCanvasW / 2,
    y: centerCanvasY - boxCanvasH / 2,
    w: boxCanvasW,
    h: boxCanvasH,
    centerX: centerCanvasX,
    centerY: centerCanvasY
  };
}

function getCornerHandles(boxRect) {
  return {
    nw: { x: boxRect.x, y: boxRect.y },
    ne: { x: boxRect.x + boxRect.w, y: boxRect.y },
    sw: { x: boxRect.x, y: boxRect.y + boxRect.h },
    se: { x: boxRect.x + boxRect.w, y: boxRect.y + boxRect.h }
  };
}

function hitTestCorner(x, y, boxRect) {
  const handles = getCornerHandles(boxRect);
  const hitRadius = 14;

  for (const [corner, point] of Object.entries(handles)) {
    const dx = x - point.x;
    const dy = y - point.y;
    if (dx * dx + dy * dy <= hitRadius * hitRadius) {
      return corner;
    }
  }

  return null;
}

function resizeCanvasToDisplaySize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = els.canvas.getBoundingClientRect();
  const targetWidth = Math.max(1, Math.floor(rect.width * dpr));
  const targetHeight = Math.max(1, Math.floor(rect.height * dpr));

  if (els.canvas.width !== targetWidth || els.canvas.height !== targetHeight) {
    els.canvas.width = targetWidth;
    els.canvas.height = targetHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
}

function updateSliderDecor(points, exactIndex) {
  els.designPointStrip.innerHTML = '';

  for (const [index, point] of points.entries()) {
    const dot = document.createElement('div');
    dot.className = `design-point-dot ${index === exactIndex ? 'active' : ''}`;
    const leftPercent = ((point.aspectRatio - state.ratioMin) / (state.ratioMax - state.ratioMin)) * 100;
    dot.style.left = `${clamp(leftPercent, 0, 100)}%`;
    dot.title = `Aspect ${point.aspectRatio.toFixed(3)}`;
    dot.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.ratioValue = point.aspectRatio;
      els.aspectSlider.value = String(state.ratioValue);
      draw();
    });
    els.designPointStrip.appendChild(dot);
  }

  const onDesignPoint = exactIndex !== -1;
  els.aspectSlider.classList.toggle('on-design-point', onDesignPoint);
  els.removeDesignPointBtn.disabled = !(onDesignPoint && points.length > 1);
}

function updateMeta(crop) {
  const selected = getSelectedImage();
  if (!selected || !crop) {
    els.selectedName.textContent = 'None';
    els.selectedX.textContent = '-';
    els.selectedY.textContent = '-';
    els.aspectLabel.textContent = state.ratioValue.toFixed(3);
    els.centersJson.textContent = '{}';
    return;
  }

  els.selectedName.textContent = selected.displayName || selected.name;
  els.selectedX.textContent = crop.x.toFixed(1);
  els.selectedY.textContent = crop.y.toFixed(1);
  els.aspectLabel.textContent = state.ratioValue.toFixed(3);
  const selectedOnly = {
    [selected.name]: getDesignPointEntries(state.designPointsByImage, selected.name)
  };
  els.centersJson.textContent = JSON.stringify(selectedOnly, null, 2);
}

function updateSaveButtonState() {
  const canSave = Boolean(state.folderHandle);
  els.saveCropSettingsBtn.disabled = !canSave;
  els.saveCropSettingsBtn.title = canSave
    ? ''
    : 'Select a folder first to enable saving crop settings.';
}

function renderThumbnails() {
  els.thumbStrip.innerHTML = '';

  state.images.forEach((img, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `thumb ${index === state.selectedIndex ? 'active' : ''}`;
    btn.title = img.name;

    const image = document.createElement('img');
    image.src = img.url;
    image.alt = img.name;

    const label = document.createElement('div');
    label.className = 'thumb-name';
    label.textContent = img.displayName || img.name;

    btn.appendChild(image);
    btn.appendChild(label);
    btn.addEventListener('click', () => selectImage(index));
    els.thumbStrip.appendChild(btn);
  });
}

function selectImage(index) {
  state.selectedIndex = index;
  state.ratioValue = DEFAULT_DESIGN_RATIO;
  els.aspectSlider.value = String(state.ratioValue);
  renderThumbnails();
  draw();
}

async function loadImagesFromRecords(imageRecords) {
  const loaded = [];
  for (const record of imageRecords) {
    try {
      loaded.push(await loadImageFromRecord(record));
    } catch (error) {
      console.warn(error);
    }
  }
  return loaded;
}

function clearImageUrls() {
  state.images.forEach((item) => {
    if (typeof item.url === 'string' && item.url.startsWith('blob:')) {
      URL.revokeObjectURL(item.url);
    }
  });
}

async function loadFolderData(folderData, options = {}) {
  const { persistRecentFolder = true } = options;
  const { folderPath, folderName, imageRecords, cropsText } = folderData;

  if (!Array.isArray(imageRecords) || imageRecords.length === 0) {
    throw new Error('No PNG/JPG/JPEG images were found in the selected folder.');
  }

  let loadedDesignPoints = {};
  let needsSave = false;

  if (cropsText) {
    try {
      loadedDesignPoints = await parseCropsYamlText(cropsText);
    } catch (error) {
      const shouldDelete = window.confirm(
        'Design point parse failed. Delete crops.yaml and open the folder anyway?'
      );

      if (!shouldDelete) {
        throw error;
      }

      await deleteCropsFile(folderPath);
      loadedDesignPoints = {};
      needsSave = true;
    }
  } else {
    needsSave = true;
  }

  clearImageUrls();
  const loadedImages = await loadImagesFromRecords(imageRecords);

  state.images = loadedImages;
  state.selectedIndex = 0;
  state.folderHandle = folderPath;
  state.folderName = folderName;
  state.designPointsByImage = loadedDesignPoints;
  updateSaveButtonState();

  const changedImages = new Set();
  ensureDesignPointsForLoadedImages(changedImages);
  if (changedImages.size > 0) {
    needsSave = true;
  }

  renderThumbnails();
  selectImage(0);

  if (persistRecentFolder) {
    void saveLastFolderCache(folderPath, folderName);
  }

  if (needsSave) {
    void autoSaveCropSettings();
  }
}

async function chooseFolder() {
  const folderData = await requestFolderSelection();
  if (!folderData) {
    return;
  }

  await loadFolderData(folderData);
}

function snapRatioToNearbyPoint(ratio, points) {
  const nearest = findNearestDesignPoint(points, ratio);
  if (nearest.index !== -1 && nearest.distance <= state.snapThreshold) {
    return points[nearest.index].ratio;
  }

  return ratio;
}

function jumpToAdjacentDesignPoint(direction) {
  const points = getCurrentCropPoints();
  if (points.length === 0) {
    return;
  }

  let targetRatio = state.ratioValue;
  if (direction > 0) {
    for (const point of points) {
      if (point.aspectRatio > state.ratioValue + RATIO_EPSILON) {
        targetRatio = point.aspectRatio;
        break;
      }
    }
  } else {
    for (let i = points.length - 1; i >= 0; i -= 1) {
      if (points[i].aspectRatio < state.ratioValue - RATIO_EPSILON) {
        targetRatio = points[i].aspectRatio;
        break;
      }
    }
  }

  state.ratioValue = clamp(targetRatio, state.ratioMin, state.ratioMax);
  els.aspectSlider.value = String(state.ratioValue);
  draw();
}

function removeCurrentDesignPoint() {
  const selected = getSelectedImage();
  if (!selected) {
    return;
  }

  const points = getCurrentCropPoints();
  if (points.length <= 1) {
    return;
  }

  const exactIndex = findExactDesignPointIndex(points, state.ratioValue);
  if (exactIndex === -1) {
    return;
  }

  points.splice(exactIndex, 1);
  setDesignPointEntries(selected.name, points);

  const nearest = findNearestDesignPoint(points, state.ratioValue);
  if (nearest.index !== -1) {
    state.ratioValue = points[nearest.index].aspectRatio;
    els.aspectSlider.value = String(state.ratioValue);
  }

  draw();
  void autoSaveCropSettings();
}

function persistCurrentDesignPoints() {
  if (!state.folderHandle) {
    return;
  }

  void autoSaveCropSettings();
}

function draw() {
  resizeCanvasToDisplaySize();
  const width = els.canvas.clientWidth;
  const height = els.canvas.clientHeight;

  ctx.clearRect(0, 0, width, height);

  const selected = getSelectedImage();
  if (!selected) {
    els.emptyState.style.display = 'grid';
    state.renderCache = null;
    updateSliderDecor([], -1);
    updateMeta(null);
    return;
  }

  els.emptyState.style.display = 'none';

  const points = getCurrentCropPoints();
  const resolved = resolveCropAtRatio(points, state.ratioValue, selected.width, selected.height);
  const crop = resolved.crop;
  const exactIndex = resolved.exactIndex;

  const drawRect = fitImageToCanvas(selected.width, selected.height, width, height);
  ctx.drawImage(selected.element, drawRect.x, drawRect.y, drawRect.w, drawRect.h);

  const boxRect = getCropRectInCanvas(crop, selected.width, selected.height, drawRect);
  const corners = getCornerHandles(boxRect);

  ctx.fillStyle = 'rgba(16, 23, 36, 0.5)';
  ctx.beginPath();
  ctx.rect(drawRect.x, drawRect.y, drawRect.w, drawRect.h);
  ctx.rect(boxRect.x, boxRect.y, boxRect.w, boxRect.h);
  ctx.fill('evenodd');

  ctx.strokeStyle = '#00f6ff';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(boxRect.x, boxRect.y, boxRect.w, boxRect.h);

  const handleSize = 8;
  ctx.fillStyle = '#00f6ff';
  ctx.strokeStyle = '#031820';
  ctx.lineWidth = 1.6;
  for (const point of Object.values(corners)) {
    ctx.beginPath();
    ctx.rect(point.x - handleSize / 2, point.y - handleSize / 2, handleSize, handleSize);
    ctx.fill();
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(boxRect.centerX, boxRect.centerY);
  ctx.strokeStyle = '#00f6ff';
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.stroke();

  const gap = 7;
  const arm = 16;
  ctx.beginPath();
  ctx.moveTo(-arm, 0);
  ctx.lineTo(-gap, 0);
  ctx.moveTo(gap, 0);
  ctx.lineTo(arm, 0);
  ctx.moveTo(0, -arm);
  ctx.lineTo(0, -gap);
  ctx.moveTo(0, gap);
  ctx.lineTo(0, arm);
  ctx.stroke();
  ctx.restore();

  state.renderCache = {
    drawRect,
    boxRect,
    crop,
    exactIndex
  };

  updateSliderDecor(points, exactIndex);
  updateMeta(crop);
}

function onCanvasPointerDown(event) {
  if (!state.renderCache) {
    return;
  }

  const rect = els.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const corner = hitTestCorner(x, y, state.renderCache.boxRect);
  const insideBox =
    x >= state.renderCache.boxRect.x &&
    x <= state.renderCache.boxRect.x + state.renderCache.boxRect.w &&
    y >= state.renderCache.boxRect.y &&
    y <= state.renderCache.boxRect.y + state.renderCache.boxRect.h;

  if (!corner && !insideBox) {
    return;
  }

  const editable = ensureEditableDesignPointAtCurrentRatio();
  if (editable && editable.changed) {
    draw();
  }

  state.drag.active = true;
  state.drag.mode = corner ? 'resize' : 'move';
  state.drag.pointerId = event.pointerId;
  state.drag.lastX = x;
  state.drag.lastY = y;
  els.canvas.setPointerCapture(event.pointerId);
}

function onCanvasPointerMove(event) {
  if (!state.drag.active || !state.renderCache) {
    return;
  }

  const selected = getSelectedImage();
  if (!selected) {
    return;
  }

  const points = getCurrentCropPoints();
  const editableIndex = findExactDesignPointIndex(points, state.ratioValue);
  if (editableIndex === -1) {
    return;
  }

  const point = points[editableIndex];

  const rect = els.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const dx = x - state.drag.lastX;
  const dy = y - state.drag.lastY;

  state.drag.lastX = x;
  state.drag.lastY = y;

  if (state.drag.mode === 'move') {
    const crop = { x: point.x, y: point.y, w: point.scale, h: point.scale / state.ratioValue };
    crop.x += (dx / state.renderCache.drawRect.w) * selected.width;
    crop.y += (dy / state.renderCache.drawRect.h) * selected.height;
    clampCropToImage(crop, selected.width, selected.height, state.ratioValue);
    point.x = crop.x;
    point.y = crop.y;
  } else if (state.drag.mode === 'resize') {
    const pointerImageX = ((x - state.renderCache.drawRect.x) / state.renderCache.drawRect.w) * selected.width;
    const pointerImageY = ((y - state.renderCache.drawRect.y) / state.renderCache.drawRect.h) * selected.height;

    const halfWFromX = Math.abs(pointerImageX - point.x);
    const halfWFromY = Math.abs(pointerImageY - point.y) * state.ratioValue;
    const halfW = Math.max(halfWFromX, halfWFromY);

    const trial = {
      x: point.x,
      y: point.y,
      w: Math.max(4, halfW * 2),
      h: Math.max(4, (halfW * 2) / state.ratioValue)
    };

    clampCropToImage(trial, selected.width, selected.height, state.ratioValue);
    point.scale = trial.w;
  }

  setDesignPointEntries(selected.name, points);
  draw();
  persistCurrentDesignPoints();
}

function onCanvasPointerUp() {
  if (!state.drag.active) {
    return;
  }

  state.drag.active = false;
  state.drag.mode = null;
  state.drag.pointerId = null;
}

function wireEvents() {
  els.pickFolderBtn.addEventListener('click', chooseFolder);

  els.thumbLeft.addEventListener('click', () => {
    els.thumbStrip.scrollBy({ left: -300, behavior: 'smooth' });
  });

  els.thumbRight.addEventListener('click', () => {
    els.thumbStrip.scrollBy({ left: 300, behavior: 'smooth' });
  });

  els.aspectSlider.min = String(state.ratioMin);
  els.aspectSlider.max = String(state.ratioMax);
  els.aspectSlider.step = String(state.ratioStep);
  els.aspectSlider.value = String(state.ratioValue);
  els.aspectLabel.textContent = state.ratioValue.toFixed(3);

  els.aspectSlider.addEventListener('input', (event) => {
    state.ratioValue = clamp(Number(event.target.value), state.ratioMin, state.ratioMax);
    els.aspectSlider.value = String(state.ratioValue);
    draw();
  });

  els.aspectSlider.addEventListener('keydown', (event) => {
    if (!event.shiftKey) {
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      jumpToAdjacentDesignPoint(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      jumpToAdjacentDesignPoint(-1);
    }
  });

  els.aspectSlider.addEventListener('pointerdown', (event) => {
    if (!event.shiftKey) {
      return;
    }

    const points = getCurrentCropPoints();
    if (points.length === 0) {
      return;
    }

    event.preventDefault();
    const rect = els.aspectSlider.getBoundingClientRect();
    const ratioAtClick = state.ratioMin + ((event.clientX - rect.left) / rect.width) * (state.ratioMax - state.ratioMin);
    const direction = ratioAtClick >= state.ratioValue ? 1 : -1;
    jumpToAdjacentDesignPoint(direction);
  });

  els.removeDesignPointBtn.addEventListener('click', removeCurrentDesignPoint);
  els.saveCropSettingsBtn.addEventListener('click', saveCurrentCropSettingsWithFeedback);

  els.canvas.addEventListener('pointerdown', onCanvasPointerDown);
  els.canvas.addEventListener('pointermove', onCanvasPointerMove);
  els.canvas.addEventListener('pointerup', onCanvasPointerUp);
  els.canvas.addEventListener('pointercancel', onCanvasPointerUp);
  els.canvas.addEventListener('pointerleave', onCanvasPointerUp);

  window.addEventListener('resize', draw);
}

async function restoreLastFolderIfAvailable() {
  try {
    const cache = await fetchLastFolderCache();
    if (!cache || !cache.folderPath) {
      return;
    }

    const folderData = await fetchFolderData(cache.folderPath);
    await loadFolderData(folderData, { persistRecentFolder: false });
  } catch (error) {
    console.warn(error);
  }
}

async function initialize() {
  wireEvents();
  els.saveCropSettingsBtn.textContent = 'Save crop settings';
  updateSaveButtonState();
  await restoreLastFolderIfAvailable();
  draw();
}

initialize();
