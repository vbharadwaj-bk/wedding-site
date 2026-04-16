from __future__ import annotations

from pathlib import Path

import yaml


def _load_content_config(config_path: Path) -> dict:
    if not config_path.exists():
        return {}

    raw_text = config_path.read_text(encoding="utf-8")

    parsed = yaml.safe_load(raw_text) or {}
    return parsed if isinstance(parsed, dict) else {}


def _load_available_photo_paths(content_root: Path) -> set[str]:
    available: set[str] = set()

    # Primary location for slideshow assets.
    slides_root = content_root / "images" / "slides"
    if slides_root.exists():
        for file_path in slides_root.rglob("*"):
            if file_path.is_file():
                relative = file_path.relative_to(content_root).as_posix()
                available.add(relative)

    # Legacy path support in case older content still exists.
    photos_root = content_root / "photos"
    if photos_root.exists():
        for file_path in photos_root.rglob("*"):
            if file_path.is_file():
                relative = file_path.relative_to(content_root).as_posix()
                available.add(relative)

    return available

AUTHOR = "Aditi & Vivek"
SITENAME = "Aditi & Vivek"
SITEURL = ""

PATH = "content"
TIMEZONE = "America/Los_Angeles"
DEFAULT_LANG = "en"

PAGE_PATHS = ["pages"]
ARTICLE_PATHS = []

STATIC_PATHS = ["images", "extras"]

THEME = "theme/my-wedding-theme"

DEFAULT_PAGINATION = False

# Keep page generation predictable for a single-event website.
DELETE_OUTPUT_DIRECTORY = True

MARKDOWN = {
    "extension_configs": {
        "markdown.extensions.extra": {},
        "markdown.extensions.meta": {},
        "markdown.extensions.sane_lists": {},
    },
    "output_format": "html5",
}

DIRECT_TEMPLATES = []
PAGINATED_TEMPLATES = {}

FEED_ALL_ATOM = None
CATEGORY_FEED_ATOM = None
AUTHOR_FEED_ATOM = None
AUTHOR_FEED_RSS = None
TAG_FEED_ATOM = None
TAG_FEED_RSS = None
TRANSLATION_FEED_ATOM = None
TRANSLATION_FEED_RSS = None

RELATIVE_URLS = True

CONTENT_CONFIG = _load_content_config(Path(PATH) / "config.yml")
SLIDESHOW_CROPS = CONTENT_CONFIG.get("slideshow_crops", {}) if isinstance(CONTENT_CONFIG.get("slideshow_crops", {}), dict) else {}
WEDDING_SCHEDULE = CONTENT_CONFIG.get("wedding_schedule", {}) if isinstance(CONTENT_CONFIG.get("wedding_schedule", {}), dict) else {}
PANE_SLIDES = CONTENT_CONFIG.get("pane_slides", {}) if isinstance(CONTENT_CONFIG.get("pane_slides", {}), dict) else {}
AVAILABLE_PHOTOS = _load_available_photo_paths(Path(PATH))

JINJA_GLOBALS = {
    "CONTENT_CONFIG": CONTENT_CONFIG,
    "SLIDESHOW_CROPS": SLIDESHOW_CROPS,
    "WEDDING_SCHEDULE": WEDDING_SCHEDULE,
    "PANE_SLIDES": PANE_SLIDES,
    "AVAILABLE_PHOTOS": AVAILABLE_PHOTOS,
}
