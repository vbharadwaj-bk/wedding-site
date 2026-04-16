# Aditi and Vivek's Wedding Website 

All text content and configuration options are in `content/config.yml`.

## Prerequisites

1. Put high-resolution slideshow photos in highres_slides. The photo names must
   match those specified in `config.yml`.
2. Install runtime dependencies (used for Pelican build/serve):

   ```bash
   python3 -m pip install -r requirements.txt
   ```

3. Install prebuild-only dependencies locally:

   ```bash
   python3 -m pip install -r requirements-prebuild.txt
   ```

## Rebuild Steps

1. Run the prebuild script:

   ```bash
   python3 scripts/prebuild.py
   ```

   The prebuild step minifies highres_slides images into content/images/slides using
   logo.jpeg_quality.

2. Build the site: 

   ```bash
   python -m invoke livereload 
   ```

## CI / GitHub Actions

GitHub Actions does not run prebuild and only installs dependencies from
`requirements.txt`. Commit prebuilt slide assets before pushing so CI can build
with Pelican only.

## Useful Options

- Dry-run minification without writing slides:

  python3 scripts/prebuild.py --dry-run

- Run only slide minification:

   python3 scripts/prebuild.py
