(() => {
  const root = document.querySelector("[data-slideshow]");
  if (!root) {
    return;
  }

  const mobileMedia = window.matchMedia("(max-width: 900px)");
  const isMobile = () => mobileMedia.matches;
  const SWIPE_MIN_PX = 28;

  const addSwipeNavigation = (element, onDirection) => {
    let startX = 0;
    let startY = 0;

    element.addEventListener(
      "touchstart",
      (event) => {
        if (!isMobile() || !event.touches.length) {
          return;
        }

        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
      },
      { passive: true }
    );

    element.addEventListener(
      "touchend",
      (event) => {
        if (!isMobile() || !event.changedTouches.length) {
          return;
        }

        const endX = event.changedTouches[0].clientX;
        const endY = event.changedTouches[0].clientY;
        const dx = endX - startX;
        const dy = endY - startY;

        if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) {
          return;
        }

        const direction = dx < 0 ? 1 : -1;
        onDirection(direction);
      },
      { passive: true }
    );
  };

  const detailsPane = root.querySelector(".split-right");
  const mainScroller = document.querySelector(".home-page main");
  const paneButtons = Array.from(root.querySelectorAll(".pane-scroll-btn"));
  const paneSections = Array.from(root.querySelectorAll(".split-right .pane[id]"));

  const isMainScrollerActive = () => {
    if (!mainScroller) {
      return false;
    }

    const styles = window.getComputedStyle(mainScroller);
    const overflowY = styles.overflowY;
    const canScroll = mainScroller.scrollHeight > mainScroller.clientHeight + 1;
    return (overflowY === "auto" || overflowY === "scroll") && canScroll;
  };

  const isInnerScrollerActive = () => {
    if (!detailsPane) {
      return false;
    }

    const styles = window.getComputedStyle(detailsPane);
    const overflowY = styles.overflowY;
    const canScroll = detailsPane.scrollHeight > detailsPane.clientHeight + 1;
    return (overflowY === "auto" || overflowY === "scroll") && canScroll;
  };

  const scrollToPane = (target) => {
    if (!target) {
      return;
    }

    if (isInnerScrollerActive()) {
      detailsPane.scrollTo({
        top: target.offsetTop,
        behavior: "smooth",
      });
      return;
    }

    if (isMainScrollerActive()) {
      const top = target.offsetTop;
      mainScroller.scrollTo({
        top,
        behavior: "smooth",
      });
      return;
    }

    const y = target.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: y, behavior: "smooth" });
  };

  paneButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const targetId = button.getAttribute("data-next-pane");
      if (!targetId) {
        return;
      }

      const target = root.querySelector(`#${targetId}`);
      scrollToPane(target);
    });
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest(".pane-scroll-btn[data-next-pane]")) {
      return;
    }

    if (target.closest(".fa-angle-down")) {
      scrollPaneByDirection(1);
    } else if (target.closest(".fa-angle-up")) {
      scrollPaneByDirection(-1);
    }
  });

  const slides = Array.from(root.querySelectorAll(".slide"));
  const dots = Array.from(root.querySelectorAll(".dot"));
  if (!slides.length) {
    return;
  }

  const slidePathToIndex = new Map();
  slides.forEach((slide, index) => {
    const path = slide.getAttribute("data-slide-path");
    if (path) {
      slidePathToIndex.set(path, index);
    }
  });

  const parsePaneSlots = (paneEl) => {
    const raw = paneEl.getAttribute("data-pane-slides") || "";
    if (!raw) {
      return [];
    }

    return raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 4)
      .map((path) => slidePathToIndex.get(path))
      .filter((value) => typeof value === "number");
  };

  const dotCount = dots.length || 4;
  const allIndices = slides.map((_, index) => index);
  const firstPaneId = paneSections[0]?.id || null;
  const firstPane = firstPaneId ? root.querySelector(`#${firstPaneId}`) : null;
  const firstPaneSlotsRaw = firstPane ? parsePaneSlots(firstPane) : [];

  const defaultSlots = [];
  for (let i = 0; i < dotCount; i += 1) {
    if (typeof firstPaneSlotsRaw[i] === "number") {
      defaultSlots.push(firstPaneSlotsRaw[i]);
      continue;
    }
    if (allIndices.length) {
      defaultSlots.push(allIndices[i % allIndices.length]);
    }
  }

  const normalizeSlots = (rawSlots) => {
    const slots = [];
    for (let i = 0; i < dotCount; i += 1) {
      if (typeof rawSlots[i] === "number") {
        slots.push(rawSlots[i]);
      } else if (typeof defaultSlots[i] === "number") {
        slots.push(defaultSlots[i]);
      }
    }
    return slots;
  };

  const paneSlotMap = new Map();
  paneSections.forEach((pane) => {
    if (!pane.id) {
      return;
    }
    paneSlotMap.set(pane.id, normalizeSlots(parsePaneSlots(pane)));
  });

  const getSlotsForPane = (paneId) => {
    const slots = paneSlotMap.get(paneId || "") || [];
    return slots.length ? slots : defaultSlots;
  };

  let activePaneId = firstPaneId;
  let currentIndex = 0;
  let currentSlot = 0;
  const AUTO_ADVANCE_MS = 5200;
  let timer = null;

  const setActive = (index) => {
    if (!slides.length) {
      return;
    }

    currentIndex = (index + slides.length) % slides.length;

    slides.forEach((slide, i) => {
      const active = i === currentIndex;
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", active ? "false" : "true");
    });

    dots.forEach((dot) => {
      const dotSlot = Number(dot.getAttribute("data-slot"));
      dot.classList.toggle("is-active", dotSlot === currentSlot);
    });
  };

  const getPanePhotoMapper = (paneId) => {
    const slots = getSlotsForPane(paneId);
    if (!slots.length) {
      return null;
    }

    return (slot) => {
      const normalizedSlot = ((slot % slots.length) + slots.length) % slots.length;
      return slots[normalizedSlot];
    };
  };

  const getSlotForPaneAndSlide = (paneId, slideIndex) => {
    const slots = getSlotsForPane(paneId);
    if (!slots.length) {
      return -1;
    }

    return slots.findIndex((index) => index === slideIndex);
  };

  const pickVisiblePaneId = () => {
    if (!isInnerScrollerActive() || !detailsPane || !paneSections.length) {
      return null;
    }

    const containerRect = detailsPane.getBoundingClientRect();
    const containerTop = containerRect.top;
    const containerBottom = containerRect.bottom;
    let winner = null;
    let winnerRatio = 0;

    paneSections.forEach((pane) => {
      const rect = pane.getBoundingClientRect();
      const visibleTop = Math.max(rect.top, containerTop);
      const visibleBottom = Math.min(rect.bottom, containerBottom);
      const visible = Math.max(0, visibleBottom - visibleTop);
      const ratio = rect.height > 0 ? visible / rect.height : 0;

      if (ratio > winnerRatio) {
        winnerRatio = ratio;
        winner = pane.id;
      }
    });

    return winner;
  };

  const pickVisiblePaneIndex = () => {
    if (!paneSections.length) {
      return -1;
    }

    if (isInnerScrollerActive()) {
      const visibleId = pickVisiblePaneId();
      if (!visibleId) {
        return -1;
      }
      return paneSections.findIndex((pane) => pane.id === visibleId);
    }

    const viewportTop = 0;
    const viewportBottom = window.innerHeight;
    let winnerIndex = 0;
    let winnerRatio = -1;

    paneSections.forEach((pane, index) => {
      const rect = pane.getBoundingClientRect();
      const visibleTop = Math.max(rect.top, viewportTop);
      const visibleBottom = Math.min(rect.bottom, viewportBottom);
      const visible = Math.max(0, visibleBottom - visibleTop);
      const ratio = rect.height > 0 ? visible / rect.height : 0;

      if (ratio > winnerRatio) {
        winnerRatio = ratio;
        winnerIndex = index;
      }
    });

    return winnerIndex;
  };

  const scrollPaneByDirection = (direction) => {
    const currentIndex = pickVisiblePaneIndex();
    if (currentIndex < 0) {
      return;
    }

    const nextIndex = Math.min(
      paneSections.length - 1,
      Math.max(0, currentIndex + direction)
    );

    if (nextIndex === currentIndex) {
      return;
    }

    scrollToPane(paneSections[nextIndex]);
  };

  const clearTimer = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const scheduleNextTransition = () => {
    clearTimer();
    timer = window.setTimeout(() => {
      runSlideTransition({ direction: 1 });
      scheduleNextTransition();
    }, AUTO_ADVANCE_MS);
  };

  const restartTimer = () => {
    scheduleNextTransition();
  };

  const getDisplayedPaneId = () => {
    const visiblePaneIndex = pickVisiblePaneIndex();
    if (visiblePaneIndex < 0) {
      return activePaneId || firstPaneId;
    }
    return paneSections[visiblePaneIndex]?.id || activePaneId || firstPaneId;
  };

  const runSlideTransition = ({ direction = 1, targetSlot = null } = {}) => {
    const paneId = getDisplayedPaneId();
    const slots = getSlotsForPane(paneId);
    const mapSlotToSlideIndex = getPanePhotoMapper(paneId);
    if (!slots.length || !mapSlotToSlideIndex) {
      return;
    }

    activePaneId = paneId;

    if (typeof targetSlot === "number" && !Number.isNaN(targetSlot)) {
      currentSlot = ((targetSlot % slots.length) + slots.length) % slots.length;
      setActive(mapSlotToSlideIndex(currentSlot));
      return;
    }

    const slotForCurrentSlide = getSlotForPaneAndSlide(paneId, currentIndex);
    const baseSlot = slotForCurrentSlide >= 0 ? slotForCurrentSlide : direction >= 0 ? -1 : 0;
    currentSlot = ((baseSlot + direction) % slots.length + slots.length) % slots.length;
    setActive(mapSlotToSlideIndex(currentSlot));
  };

  root.querySelector("[data-prev]")?.addEventListener("click", () => {
    runSlideTransition({ direction: -1 });
    restartTimer();
  });

  root.querySelector("[data-next]")?.addEventListener("click", () => {
    runSlideTransition({ direction: 1 });
    restartTimer();
  });

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const targetSlot = Number(dot.getAttribute("data-slot"));
      if (Number.isNaN(targetSlot)) {
        return;
      }

      runSlideTransition({ targetSlot });

      restartTimer();
    });
  });

  const mainSlideshowPane = root.querySelector(".slideshow-pane");
  if (mainSlideshowPane) {
    let suppressTapUntil = 0;

    addSwipeNavigation(mainSlideshowPane, (direction) => {
      runSlideTransition({ direction });
      restartTimer();
      suppressTapUntil = Date.now() + 360;
    });

    mainSlideshowPane.addEventListener("click", (event) => {
      if (!isMobile()) {
        return;
      }

      if (Date.now() < suppressTapUntil) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest(".slide-dots") || target.closest(".dot")) {
        return;
      }

      const rect = mainSlideshowPane.getBoundingClientRect();
      const relativeX = event.clientX - rect.left;
      const direction = relativeX < rect.width / 2 ? -1 : 1;
      runSlideTransition({ direction });
      restartTimer();
    });
  }

  window.addEventListener("keydown", (event) => {
    const activeEl = document.activeElement;
    if (
      activeEl &&
      (activeEl.tagName === "INPUT" ||
        activeEl.tagName === "TEXTAREA" ||
        activeEl.tagName === "SELECT" ||
        activeEl.isContentEditable)
    ) {
      return;
    }

    if (event.key === "ArrowRight") {
      runSlideTransition({ direction: 1 });
      restartTimer();
    } else if (event.key === "ArrowLeft") {
      runSlideTransition({ direction: -1 });
      restartTimer();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      scrollPaneByDirection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      scrollPaneByDirection(-1);
    }
  });

  const initMiniSlideshows = () => {
    const miniSliders = Array.from(root.querySelectorAll("[data-mini-slideshow]"));
    miniSliders.forEach((slider) => {
      const miniSlides = Array.from(slider.querySelectorAll(".mini-slide"));
      const miniDots = Array.from(slider.querySelectorAll(".mini-dot"));

      if (!miniSlides.length) {
        return;
      }

      let miniIndex = 0;
      let suppressTapUntil = 0;

      const setMiniActive = (index) => {
        miniIndex = (index + miniSlides.length) % miniSlides.length;
        miniSlides.forEach((slide, i) => {
          const active = i === miniIndex;
          slide.classList.toggle("is-active", active);
          slide.setAttribute("aria-hidden", active ? "false" : "true");
        });

        miniDots.forEach((dot, i) => {
          dot.classList.toggle("is-active", i === miniIndex);
        });
      };

      miniDots.forEach((dot) => {
        dot.addEventListener("click", (event) => {
          event.stopPropagation();
          const slot = Number(dot.getAttribute("data-mini-slot"));
          if (Number.isNaN(slot)) {
            return;
          }
          setMiniActive(slot);
        });
      });

      slider.addEventListener("click", (event) => {
        if (!isMobile() || miniSlides.length < 2) {
          return;
        }

        if (Date.now() < suppressTapUntil) {
          return;
        }

        const target = event.target;
        if (target instanceof Element && target.closest(".mini-dot")) {
          return;
        }

        const rect = slider.getBoundingClientRect();
        const relativeX = event.clientX - rect.left;
        const direction = relativeX < rect.width / 2 ? -1 : 1;
        setMiniActive(miniIndex + direction);
      });

      addSwipeNavigation(slider, (direction) => {
        if (miniSlides.length < 2) {
          return;
        }
        setMiniActive(miniIndex + direction);
        suppressTapUntil = Date.now() + 360;
      });

      setMiniActive(0);
    });
  };

  initMiniSlideshows();

  runSlideTransition({ targetSlot: 0 });
  restartTimer();
})();
