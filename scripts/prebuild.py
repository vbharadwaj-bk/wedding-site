from __future__ import annotations

import argparse
import base64
from pathlib import Path
from typing import Any

import svgwrite


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}

    raw = path.read_text(encoding="utf-8")

    try:
        import yaml  # type: ignore

        data = yaml.safe_load(raw) or {}
        return data if isinstance(data, dict) else {}
    except ModuleNotFoundError:
        data: dict[str, Any] = {}
        current_section: str | None = None

        for line in raw.splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue

            indent = len(line) - len(line.lstrip(" "))
            cleaned = line.strip()

            if indent == 0 and cleaned.endswith(":"):
                current_section = cleaned[:-1].strip()
                data[current_section] = {}
                continue

            if ":" not in cleaned:
                continue

            key, value = cleaned.split(":", 1)
            parsed_key = key.strip()
            parsed_value = value.strip().strip('"').strip("'")

            if indent >= 2 and current_section and isinstance(data.get(current_section), dict):
                data[current_section][parsed_key] = parsed_value
            elif indent == 0:
                data[parsed_key] = parsed_value
                current_section = None

        return data


def _extract_logo_config(cfg: dict[str, Any]) -> dict[str, Any]:
    logo = cfg.get("logo", {}) if isinstance(cfg.get("logo", {}), dict) else {}

    bride_name = str(cfg.get("bride_name", "Aditi Lahiri"))
    groom_name = str(cfg.get("groom_name", "Vivek Bharadwaj"))

    return {
        "left_name": str(logo.get("left_name", bride_name)),
        "right_name": str(logo.get("right_name", groom_name)),
        "ampersand": str(logo.get("ampersand", "&")),
        "font_name": str(logo.get("font_name", "La Charlune-Regular.ttf")),
        "font_scale": float(logo.get("font_scale", 1.0)),
        "background": str(logo.get("background", "transparent")),
        "foreground": str(logo.get("foreground", "#24170f")),
    }


def _extract_jpeg_quality(cfg: dict[str, Any]) -> int:
    logo = cfg.get("logo", {})
    value: Any = None

    if isinstance(logo, dict):
        value = logo.get("jpeg_quality")

    if value is None:
        return 82

    try:
        quality = int(value)
    except (TypeError, ValueError):
        return 82

    return max(1, min(95, quality))


def _is_transparent(color_value: str) -> bool:
    return color_value.strip().lower() in {"", "transparent", "none", "null"}


def _resolve_logo_font(root: Path, font_name: str) -> tuple[str, str | None]:
    safe_font_name = Path(font_name).name
    candidates = [
        root / "fonts" / safe_font_name,
        root / "theme" / "my-wedding-theme" / "static" / "fonts" / safe_font_name,
        root / "content" / "fonts" / safe_font_name,
    ]

    for font_path in candidates:
        if font_path.exists():
            encoded = base64.b64encode(font_path.read_bytes()).decode("ascii")
            return "WeddingLockupFont", f"data:font/ttf;base64,{encoded}"

    return "Cormorant Garamond", None


def _lockup_svg(
    path: Path,
    left: str,
    amp: str,
    right: str,
    bg: str,
    fg: str,
    font_scale: float,
    font_family: str,
    font_data_uri: str | None,
) -> None:
    scale = max(0.6, min(font_scale, 2.2))
    width = 1800
    height = int(620 + max(0.0, scale - 1.0) * 260)

    name_size = int(178 * scale)
    amp_size = int(132 * scale)
    first_baseline = int(height * 0.36)
    amp_baseline = int(height * 0.58)
    second_baseline = int(height * 0.85)

    dwg = svgwrite.Drawing(str(path), size=(f"{width}px", f"{height}px"))
    if not _is_transparent(bg):
        dwg.add(dwg.rect(insert=(0, 0), size=("100%", "100%"), fill=bg))

    if font_data_uri:
        style = (
            f"@font-face {{ font-family: '{font_family}'; "
            f"src: url('{font_data_uri}') format('truetype'); }}"
        )
        dwg.defs.add(dwg.style(style))

    center_x = width / 2
    dwg.add(
        dwg.text(
            left,
            insert=(center_x, first_baseline),
            text_anchor="middle",
            font_family=f"{font_family}, Cormorant Garamond, serif",
            font_size=name_size,
            fill=fg,
        )
    )
    dwg.add(
        dwg.text(
            amp,
            insert=(center_x, amp_baseline),
            text_anchor="middle",
            font_family=f"{font_family}, Cormorant Garamond, serif",
            font_size=amp_size,
            fill=fg,
            fill_opacity=0.8,
        )
    )
    dwg.add(
        dwg.text(
            right,
            insert=(center_x, second_baseline),
            text_anchor="middle",
            font_family=f"{font_family}, Cormorant Garamond, serif",
            font_size=name_size,
            fill=fg,
        )
    )
    dwg.save()


def _render_logo(cfg: dict[str, Any], root: Path) -> None:
    output_dir = root / "content" / "images" / "logo"
    output_dir.mkdir(parents=True, exist_ok=True)

    logo_cfg = _extract_logo_config(cfg)
    font_family, font_data_uri = _resolve_logo_font(root, str(logo_cfg["font_name"]))

    _lockup_svg(
        output_dir / "names-lockup.svg",
        str(logo_cfg["left_name"]),
        str(logo_cfg["ampersand"]),
        str(logo_cfg["right_name"]),
        str(logo_cfg["background"]),
        str(logo_cfg["foreground"]),
        float(logo_cfg["font_scale"]),
        font_family,
        font_data_uri,
    )

    print("Rendered SVG files:")
    print("- content/images/logo/names-lockup.svg")


def _iter_images(source_dir: Path) -> list[Path]:
    allowed = {".jpg", ".jpeg", ".png", ".webp"}
    files = [
        p
        for p in source_dir.iterdir()
        if p.is_file() and p.suffix.lower() in allowed
    ]
    return sorted(files, key=lambda p: p.name.lower())


def _save_optimized(src: Path, dst: Path, jpeg_quality: int) -> None:
    try:
        from PIL import Image, ImageOps
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "Pillow is required for image minification. Install from requirements.txt."
        ) from exc

    with Image.open(src) as img:
        normalized = ImageOps.exif_transpose(img)
        suffix = src.suffix.lower()

        dst.parent.mkdir(parents=True, exist_ok=True)

        if suffix in {".jpg", ".jpeg"}:
            if normalized.mode not in {"RGB", "L"}:
                normalized = normalized.convert("RGB")
            normalized.save(
                dst,
                format="JPEG",
                quality=jpeg_quality,
                optimize=True,
                progressive=True,
            )
            return

        if suffix == ".png":
            normalized.save(dst, format="PNG", optimize=True, compress_level=9)
            return

        if suffix == ".webp":
            normalized.save(dst, format="WEBP", quality=jpeg_quality, method=6)
            return

        normalized.save(dst, optimize=True)


def _folder_size_bytes(folder: Path) -> int:
    if not folder.exists() or not folder.is_dir():
        return 0

    total = 0
    for p in folder.rglob("*"):
        if p.is_file():
            total += p.stat().st_size
    return total


def _format_bytes(size: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size)
    unit_index = 0

    while value >= 1024.0 and unit_index < len(units) - 1:
        value /= 1024.0
        unit_index += 1

    if unit_index == 0:
        return f"{int(value)} {units[unit_index]}"
    return f"{value:.2f} {units[unit_index]}"


def _minify_slides(
    cfg: dict[str, Any],
    source_dir: Path,
    dest_dir: Path,
    dry_run: bool,
) -> None:
    if not source_dir.exists() or not source_dir.is_dir():
        raise SystemExit(f"Source folder not found: {source_dir}")

    jpeg_quality = _extract_jpeg_quality(cfg)
    source_initial_size = _folder_size_bytes(source_dir)

    images = _iter_images(source_dir)
    if not images:
        raise SystemExit(f"No supported images found in: {source_dir}")

    print(f"JPEG quality from config: {jpeg_quality}")
    print(f"Source: {source_dir}")
    print(f"Destination: {dest_dir}")

    written = 0
    failed = 0

    for src in images:
        dst = dest_dir / src.name
        try:
            if dry_run:
                print(f"[dry-run] {src.name} -> {dst}")
            else:
                _save_optimized(src, dst, jpeg_quality)
                print(f"[ok] {src.name} -> {dst}")
                written += 1
        except Exception as exc:
            failed += 1
            print(f"[error] {src.name}: {exc}")

    if dry_run:
        print(f"Dry run complete. {len(images)} files would be processed.")
        return

    dest_final_size = _folder_size_bytes(dest_dir)
    saved_bytes = source_initial_size - dest_final_size
    reduction_pct = 0.0
    if source_initial_size > 0:
        reduction_pct = (saved_bytes / source_initial_size) * 100.0

    print(f"Done. Wrote {written} files.")
    print("Size comparison:")
    print(
        "- Source highres_slides (initial): "
        f"{source_initial_size} bytes ({_format_bytes(source_initial_size)})"
    )
    print(
        "- Destination images/slides (after minification): "
        f"{dest_final_size} bytes ({_format_bytes(dest_final_size)})"
    )
    print(
        f"- Difference: {saved_bytes} bytes "
        f"({_format_bytes(abs(saved_bytes))}, {reduction_pct:.2f}% change vs source)"
    )

    if failed:
        print(f"Failed: {failed}")


def main() -> None:
    root = Path(__file__).resolve().parent.parent

    parser = argparse.ArgumentParser(
        description=(
            "Prebuild static assets by rendering logo lockup and minifying slide images "
            "using settings from content/config.yml"
        )
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=root / "content" / "config.yml",
        help="Path to config.yml.",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=root / "highres_slides",
        help="Source folder containing high-resolution slide images.",
    )
    parser.add_argument(
        "--dest",
        type=Path,
        default=root / "content" / "images" / "slides",
        help="Destination folder for optimized slide images.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show slide minification operations without writing files.",
    )
    parser.add_argument(
        "--skip-logo",
        action="store_true",
        help="Skip logo rendering.",
    )
    parser.add_argument(
        "--skip-slides",
        action="store_true",
        help="Skip slide minification.",
    )
    args = parser.parse_args()

    cfg = _load_yaml(args.config)

    if not args.skip_logo:
        _render_logo(cfg, root)

    if not args.skip_slides:
        _minify_slides(cfg, args.source, args.dest, args.dry_run)


if __name__ == "__main__":
    main()
