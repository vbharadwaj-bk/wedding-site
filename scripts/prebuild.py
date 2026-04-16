from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import yaml
from PIL import Image, ImageOps


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}

    raw = path.read_text(encoding="utf-8")

    data = yaml.safe_load(raw) or {}
    return data if isinstance(data, dict) else {}


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


def _iter_images(source_dir: Path) -> list[Path]:
    allowed = {".jpg", ".jpeg", ".png", ".webp"}
    files = [
        p
        for p in source_dir.iterdir()
        if p.is_file() and p.suffix.lower() in allowed
    ]
    return sorted(files, key=lambda p: p.name.lower())


def _save_optimized(src: Path, dst: Path, jpeg_quality: int) -> None:
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
            "Prebuild static assets by minifying slide images "
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
        "--skip-slides",
        action="store_true",
        help="Skip slide minification.",
    )
    args = parser.parse_args()

    cfg = _load_yaml(args.config)

    if not args.skip_slides:
        _minify_slides(cfg, args.source, args.dest, args.dry_run)


if __name__ == "__main__":
    main()
