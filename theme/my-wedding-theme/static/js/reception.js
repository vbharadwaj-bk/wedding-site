(() => {
  const frame = document.querySelector("[data-rc-flower]");
  const image = frame?.querySelector("img");
  if (!frame || !image) {
    return;
  }

  let cropQueued = false;

  const queueCrop = () => {
    if (cropQueued || !image.complete || image.naturalWidth === 0) {
      return;
    }

    cropQueued = true;
    window.requestAnimationFrame(() => {
      cropQueued = false;
      window.applyDynamicCrop(image, frame);
      frame.classList.add("is-ready");
    });
  };

  image.addEventListener("load", queueCrop, { once: true });
  new ResizeObserver(queueCrop).observe(frame);
  queueCrop();
})();
