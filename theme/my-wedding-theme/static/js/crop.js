(() => {
  const lookupCrop = typeof window.getCropCenterAndScale === "function" ? window.getCropCenterAndScale : null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const clampCropToImage = (crop, imageWidth, imageHeight, aspectRatio) => {
    const safeRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;

    crop.x = clamp(crop.x, 0, imageWidth);
    crop.y = clamp(crop.y, 0, imageHeight);

    const maxScaleByX = 2 * Math.min(crop.x, imageWidth - crop.x);
    const maxScaleByY = 2 * Math.min(crop.y, imageHeight - crop.y) * safeRatio;
    const maxScale = Math.max(2, Math.min(maxScaleByX, maxScaleByY, imageWidth, imageHeight * safeRatio));

    crop.scale = clamp(crop.scale, 2, maxScale);

    const halfW = crop.scale / 2;
    const halfH = crop.scale / (2 * safeRatio);
    crop.x = clamp(crop.x, halfW, imageWidth - halfW);
    crop.y = clamp(crop.y, halfH, imageHeight - halfH);

    return crop;
  };

  const getImageLookupCandidates = (imageEl) => {
    const candidates = [];
    const dataPath = imageEl.getAttribute("data-slide-path") || "";
    const src = imageEl.currentSrc || imageEl.getAttribute("src") || "";

    if (dataPath) {
      candidates.push(dataPath);
      const dataBaseName = dataPath.split("/").pop();
      if (dataBaseName) {
        candidates.push(dataBaseName);
      }
    }

    if (src) {
      const srcPath = src.split("?")[0].split("#")[0];
      const srcBaseName = srcPath.split("/").pop();
      if (srcBaseName) {
        candidates.push(srcBaseName);
      }
    }

    return Array.from(new Set(candidates.map((value) => decodeURIComponent(value))));
  };

  const resolveCropForImage = (imageEl, aspectRatio) => {
    if (!lookupCrop) {
      return null;
    }

    const keys = getImageLookupCandidates(imageEl);
    for (const key of keys) {
      const point = lookupCrop(key, aspectRatio);
      if (
        point &&
        Number.isFinite(Number(point.x)) &&
        Number.isFinite(Number(point.y)) &&
        Number.isFinite(Number(point.scale))
      ) {
        return { x: Number(point.x), y: Number(point.y), scale: Number(point.scale) };
      }
    }

    return null;
  };

  const resetDynamicCropStyle = (imageEl) => {
    imageEl.style.width = "";
    imageEl.style.height = "";
    imageEl.style.maxWidth = "";
    imageEl.style.maxHeight = "";
    imageEl.style.objectFit = "";
    imageEl.style.objectPosition = "";
    imageEl.style.transformOrigin = "";
    imageEl.style.transform = "";
  };

  const applyDynamicCrop = (imageEl, frameEl) => {
    if (!frameEl) {
      return;
    }

    const naturalWidth = Number(imageEl.naturalWidth);
    const naturalHeight = Number(imageEl.naturalHeight);
    if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) {
      return;
    }

    const rect = frameEl.getBoundingClientRect();
    const frameWidth = rect.width;
    const frameHeight = rect.height;
    if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight) || frameWidth <= 0 || frameHeight <= 0) {
      return;
    }

    const aspectRatio = frameWidth / frameHeight;
    const crop = resolveCropForImage(imageEl, aspectRatio);
    if (!crop || crop.scale <= 0) {
      resetDynamicCropStyle(imageEl);
      return;
    }

    clampCropToImage(crop, naturalWidth, naturalHeight, aspectRatio);

    const coverScale = Math.max(frameWidth / naturalWidth, frameHeight / naturalHeight);
    const baseWidth = naturalWidth * coverScale;
    const baseHeight = naturalHeight * coverScale;
    const cropDisplayWidth = (crop.scale / naturalWidth) * baseWidth;
    if (!Number.isFinite(cropDisplayWidth) || cropDisplayWidth <= 0) {
      resetDynamicCropStyle(imageEl);
      return;
    }

    const zoom = frameWidth / cropDisplayWidth;
    if (!Number.isFinite(zoom) || zoom <= 0) {
      resetDynamicCropStyle(imageEl);
      return;
    }

    const centerX = (crop.x / naturalWidth) * baseWidth;
    const centerY = (crop.y / naturalHeight) * baseHeight;
    const tx = frameWidth / 2 - centerX * zoom;
    const ty = frameHeight / 2 - centerY * zoom;

    imageEl.style.width = `${baseWidth}px`;
    imageEl.style.height = `${baseHeight}px`;
    imageEl.style.maxWidth = "none";
    imageEl.style.maxHeight = "none";
    imageEl.style.objectFit = "fill";
    imageEl.style.objectPosition = "0 0";
    imageEl.style.transformOrigin = "top left";
    imageEl.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
  };

  const isTouchDevice = () => {
    return (
      typeof window === "object" &&
      ("ontouchstart" in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0)
    );
  };

  const isLayoutViewportZoomedOnTouch = () => {
  if (!isTouchDevice()) return false;
    // 1. The modern, highly reliable way to check for pinch-zoom (iOS 13+, Android)
    if (window.visualViewport) {
      // We use a tiny tolerance because floating point math can sometimes return 1.00001
      return window.visualViewport.scale > 1.01 || window.visualViewport.scale < 0.99;
    }

    // 2. Legacy fallback for very old mobile browsers
    const layoutW = document.documentElement.clientWidth || 0;
    const visualW = window.innerWidth || 0; 
    
    // innerWidth typically represents the visual viewport on older mobile browsers
    const TOLERANCE = 0.95;
    if (visualW > 0 && layoutW > 0 && visualW < layoutW * TOLERANCE) return true;
    
    return false;
  };

  window.applyDynamicCrop = applyDynamicCrop;
  window.isLayoutViewportZoomedOnTouch = isLayoutViewportZoomedOnTouch;
})();
