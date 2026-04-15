# Aditi and Vivek's Wedding Website 

All text content and configuration options are in `content/config.yml`.

## Prerequisites

1. Put high-resolution slideshow photos in highres_slides. The photo names must
   match those specified in `config.yml`.
2. Put your font file in fonts. The font name is specified in `config.yml`.
3. Install dependencies in your current Python environment:

   ```bash
   python3 -m pip install -r requirements.txt
   ```

## Rebuild Steps

1. Run the prebuild script:

   ```bash
   python3 scripts/prebuild.py
   ```

   The prebuild step does two things:
   - Renders content/images/logo/names-lockup.svg from config and the selected font.
   - Minifies highres_slides images into content/images/slides using logo.jpeg_quality.

2. Build the site: 

   ```bash
   python -m invoke livereload 
   ```

## Useful Options

- Dry-run minification without writing slides:

  python3 scripts/prebuild.py --dry-run

- Run only logo rendering:

  python3 scripts/prebuild.py --skip-slides

- Run only slide minification:

  python3 scripts/prebuild.py --skip-logo
