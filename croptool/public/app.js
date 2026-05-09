const DEFAULT_DESIGN_RATIO = 1920 / 1080;
const RATIO_EPSILON = 0.0005;

const state = {
  images: [],
  selectedIndex: -1,
  designPointsByImage: {},
  ratioValue: 1.33,
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
  folderInput: document.getElementById('folder-input'),
  thumbStrip: document.getElementById('thumb-strip'),
  thumbLeft: document.getElementById('thumb-left'),
  thumbRight: document.getElementById('thumb-right'),
  canvas: document.getElementById('main-canvas'),
  emptyState: document.getElementById('empty-state'),
  aspectSlider: document.getElementById('aspect-slider'),
  designPointStrip: document.getElementById('design-point-strip'),
  aspectLabel: document.getElementById('aspect-label'),
  removeDesignPointBtn: document.getElementById('remove-design-point-btn'),
  selectedName: document.getElementById('selected-name'),
  selectedX: document.getElementById('selected-x'),
  selectedY: document.getElementById('selected-y'),
  centersJson: document.getElementById('centers-json'),
  copyJsonBtn: document.getElementById('copy-json-btn')
};

const ctx = els.canvas.getContext('2d');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function normalizeRatio(ratio) {
  return clamp(ratio, state.ratioMin, state.ratioMax);
}

function isSupportedImage(file) {
  if (!file) {
    return false;
  }

  const lower = file.name.toLowerCase();
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg');
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      resolve({
        file,
        name: file.name,
        url,
        width: img.naturalWidth,
        height: img.naturalHeight,
        element: img
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };

    img.src = url;
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
    ratio: DEFAULT_DESIGN_RATIO,
    x: crop.x,
    y: crop.y,
    scale: crop.w
  };
}

function sortDesignPoints(points) {
  points.sort((a, b) => a.ratio - b.ratio);
}

function findExactDesignPointIndex(points, ratio) {
  return points.findIndex((point) => Math.abs(point.ratio - ratio) <= RATIO_EPSILON);
}

function findNearestDesignPoint(points, ratio) {
  if (points.length === 0) {
    return { index: -1, distance: Infinity };
  }

  let bestIndex = 0;
  let bestDistance = Math.abs(points[0].ratio - ratio);

  for (let i = 1; i < points.length; i += 1) {
    const distance = Math.abs(points[i].ratio - ratio);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  return { index: bestIndex, distance: bestDistance };
}

function getSelectedImage() {
  if (state.selectedIndex < 0 || state.selectedIndex >= state.images.length) {
    return null;
  }

  return state.images[state.selectedIndex];
}

function getDesignPointsForSelected() {
  const selected = getSelectedImage();
  if (!selected) {
    return [];
  }

  if (!state.designPointsByImage[selected.name]) {
    state.designPointsByImage[selected.name] = [makeDefaultDesignPoint(selected)];
  }

  const points = state.designPointsByImage[selected.name];
  sortDesignPoints(points);
  return points;
}

function makeCropFromDesignPoint(point, ratio) {
  return {
    x: point.x,
    y: point.y,
    w: point.scale,
    h: point.scale / ratio
  };
}

function clampScaleToFitAtCenter(crop, imageWidth, imageHeight, ratio) {
  crop.x = clamp(crop.x, 0, imageWidth);
  crop.y = clamp(crop.y, 0, imageHeight);

  const maxWByX = 2 * Math.min(crop.x, imageWidth - crop.x);
  const maxWByY = 2 * Math.min(crop.y, imageHeight - crop.y) * ratio;
  const maxFeasibleWidth = Math.max(2, Math.min(maxWByX, maxWByY, imageWidth, imageHeight * ratio));

  crop.w = clamp(crop.w, 2, maxFeasibleWidth);
  crop.h = crop.w / ratio;
}

function clampCenterToFit(crop, imageWidth, imageHeight) {
  const halfW = crop.w / 2;
  const halfH = crop.h / 2;

  crop.x = clamp(crop.x, halfW, imageWidth - halfW);
  crop.y = clamp(crop.y, halfH, imageHeight - halfH);
}

function resolveCropAtRatio(points, ratio, imageWidth, imageHeight) {
  if (points.length === 0) {
    const fallback = makeDefaultCrop(imageWidth, imageHeight, ratio);
    return { crop: fallback, exactIndex: -1 };
  }

  const exactIndex = findExactDesignPointIndex(points, ratio);
  let crop;

  if (exactIndex !== -1) {
    crop = makeCropFromDesignPoint(points[exactIndex], ratio);
  } else if (ratio < points[0].ratio) {
    crop = makeCropFromDesignPoint(points[0], ratio);
  } else if (ratio > points[points.length - 1].ratio) {
    crop = makeCropFromDesignPoint(points[points.length - 1], ratio);
  } else {
    let lower = points[0];
    let upper = points[points.length - 1];

    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[i];
      const p1 = points[i + 1];
      if (ratio >= p0.ratio && ratio <= p1.ratio) {
        lower = p0;
        upper = p1;
        break;
      }
    }

    const t = (ratio - lower.ratio) / (upper.ratio - lower.ratio);
    crop = {
      x: lerp(lower.x, upper.x, t),
      y: lerp(lower.y, upper.y, t),
      w: lerp(lower.scale, upper.scale, t),
      h: lerp(lower.scale, upper.scale, t) / ratio
    };
  }

  clampScaleToFitAtCenter(crop, imageWidth, imageHeight, ratio);
  return { crop, exactIndex };
}

function upsertDesignPoint(points, ratio, crop) {
  const exactIndex = findExactDesignPointIndex(points, ratio);
  if (exactIndex !== -1) {
    points[exactIndex].x = crop.x;
    points[exactIndex].y = crop.y;
    points[exactIndex].scale = crop.w;
    return exactIndex;
  }

  points.push({
    ratio,
    x: crop.x,
    y: crop.y,
    scale: crop.w
  });

  sortDesignPoints(points);
  return findExactDesignPointIndex(points, ratio);
}

function ensureEditablePointAtCurrentRatio() {
  const selected = getSelectedImage();
  if (!selected) {
    return { points: [], index: -1 };
  }

  const points = getDesignPointsForSelected();
  let index = findExactDesignPointIndex(points, state.ratioValue);

  if (index === -1) {
    const resolved = resolveCropAtRatio(points, state.ratioValue, selected.width, selected.height).crop;
    index = upsertDesignPoint(points, state.ratioValue, resolved);
  }

  return { points, index };
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

function snapRatioToNearbyPoint(ratio, points) {
  const nearest = findNearestDesignPoint(points, ratio);
  if (nearest.index !== -1 && nearest.distance <= state.snapThreshold) {
    return points[nearest.index].ratio;
  }

  return ratio;
}

function updateSliderDecor(points, exactIndex) {
  els.designPointStrip.innerHTML = '';

  points.forEach((point, index) => {
    const dot = document.createElement('div');
    dot.className = `design-point-dot ${index === exactIndex ? 'active' : ''}`;
    const leftPercent = ((point.ratio - state.ratioMin) / (state.ratioMax - state.ratioMin)) * 100;
    dot.style.left = `${clamp(leftPercent, 0, 100)}%`;
    dot.title = `Aspect ${point.ratio.toFixed(3)}`;
    dot.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      state.ratioValue = point.ratio;
      els.aspectSlider.value = String(state.ratioValue);
      draw();
    });
    els.designPointStrip.appendChild(dot);
  });

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
    els.centersJson.textContent = JSON.stringify(state.designPointsByImage, null, 2);
    return;
  }

  els.selectedName.textContent = selected.name;
  els.selectedX.textContent = crop.x.toFixed(1);
  els.selectedY.textContent = crop.y.toFixed(1);
  els.aspectLabel.textContent = state.ratioValue.toFixed(3);
  els.centersJson.textContent = JSON.stringify(state.designPointsByImage, null, 2);
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
    label.textContent = img.name;

    btn.appendChild(image);
    btn.appendChild(label);
    btn.addEventListener('click', () => selectImage(index));
    els.thumbStrip.appendChild(btn);
  });
}

function selectImage(index) {
  state.selectedIndex = index;
  state.ratioValue = normalizeRatio(DEFAULT_DESIGN_RATIO);
  els.aspectSlider.value = String(state.ratioValue);
  renderThumbnails();
  draw();
}

async function handleFolderSelection(event) {
  const allFiles = Array.from(event.target.files || []);
  const imageFiles = allFiles.filter(isSupportedImage);

  state.images.forEach((item) => URL.revokeObjectURL(item.url));

  state.images = [];
  state.selectedIndex = -1;
  state.designPointsByImage = {};

  if (imageFiles.length === 0) {
    renderThumbnails();
    draw();
    return;
  }

  const loaded = [];
  for (const file of imageFiles.sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      loaded.push(await loadImageFromFile(file));
    } catch (err) {
      console.warn(err);
    }
  }

  state.images = loaded;
  renderThumbnails();

  if (state.images.length > 0) {
    selectImage(0);
  } else {
    draw();
  }
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

  const points = getDesignPointsForSelected();
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

  ensureEditablePointAtCurrentRatio();
  draw();

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

  const points = getDesignPointsForSelected();
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
    const crop = makeCropFromDesignPoint(point, state.ratioValue);
    crop.x += (dx / state.renderCache.drawRect.w) * selected.width;
    crop.y += (dy / state.renderCache.drawRect.h) * selected.height;
    clampCenterToFit(crop, selected.width, selected.height);

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

    clampScaleToFitAtCenter(trial, selected.width, selected.height, state.ratioValue);
    point.scale = trial.w;
  }

  draw();
}

function onCanvasPointerUp(event) {
  if (!state.drag.active) {
    return;
  }

  state.drag.active = false;
  if (state.drag.pointerId !== null) {
    els.canvas.releasePointerCapture(state.drag.pointerId);
  }

  state.drag.mode = null;
  state.drag.pointerId = null;
}

function jumpToAdjacentDesignPoint(direction) {
  const points = getDesignPointsForSelected();
  if (points.length === 0) {
    return;
  }

  let targetRatio = state.ratioValue;
  if (direction > 0) {
    for (const point of points) {
      if (point.ratio > state.ratioValue + RATIO_EPSILON) {
        targetRatio = point.ratio;
        break;
      }
    }
  } else {
    for (let i = points.length - 1; i >= 0; i -= 1) {
      if (points[i].ratio < state.ratioValue - RATIO_EPSILON) {
        targetRatio = points[i].ratio;
        break;
      }
    }
  }

  state.ratioValue = normalizeRatio(targetRatio);
  els.aspectSlider.value = String(state.ratioValue);
  draw();
}

function removeCurrentDesignPoint() {
  const points = getDesignPointsForSelected();
  if (points.length <= 1) {
    return;
  }

  const exactIndex = findExactDesignPointIndex(points, state.ratioValue);
  if (exactIndex === -1) {
    return;
  }

  points.splice(exactIndex, 1);
  sortDesignPoints(points);

  const nearest = findNearestDesignPoint(points, state.ratioValue);
  if (nearest.index !== -1) {
    state.ratioValue = points[nearest.index].ratio;
    els.aspectSlider.value = String(state.ratioValue);
  }

  draw();
}

function setupEvents() {
  els.pickFolderBtn.addEventListener('click', () => els.folderInput.click());
  els.folderInput.addEventListener('change', handleFolderSelection);

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

  els.aspectSlider.addEventListener('input', (event) => {
    const selected = getSelectedImage();
    let nextRatio = normalizeRatio(Number(event.target.value));

    if (selected) {
      const points = getDesignPointsForSelected();
      nextRatio = snapRatioToNearbyPoint(nextRatio, points);
    }

    state.ratioValue = nextRatio;
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

    const points = getDesignPointsForSelected();
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

  els.canvas.addEventListener('pointerdown', onCanvasPointerDown);
  els.canvas.addEventListener('pointermove', onCanvasPointerMove);
  els.canvas.addEventListener('pointerup', onCanvasPointerUp);
  els.canvas.addEventListener('pointercancel', onCanvasPointerUp);
  els.canvas.addEventListener('pointerleave', onCanvasPointerUp);

  window.addEventListener('resize', draw);

  els.copyJsonBtn.addEventListener('click', async () => {
    const text = JSON.stringify(state.designPointsByImage, null, 2);

    try {
      await navigator.clipboard.writeText(text);
      els.copyJsonBtn.textContent = 'Copied';
      setTimeout(() => {
        els.copyJsonBtn.textContent = 'Copy Design Points JSON';
      }, 900);
    } catch (err) {
      console.warn('Clipboard copy failed', err);
      els.copyJsonBtn.textContent = 'Copy failed';
      setTimeout(() => {
        els.copyJsonBtn.textContent = 'Copy Design Points JSON';
      }, 1100);
    }
  });
}

setupEvents();
draw();
