# Wedding Site Rebuild Guide

This repo uses a prebuild step to generate static assets before running Pelican.

## Prerequisites

1. Put high-resolution slideshow photos in highres_slides.
2. Put your font file in fonts.
3. Set the font file name in content/config.yml under logo.font_name.
4. Install dependencies in your current Python environment:

   python3 -m pip install -r requirements.txt

## Rebuild Steps

1. Run the prebuild script:

   python3 scripts/prebuild.py

2. The prebuild step does two things:
   - Renders content/images/logo/names-lockup.svg from config and the selected font.
   - Minifies highres_slides images into content/images/slides using logo.jpeg_quality.

3. Build the site as usual (example):

   pelican content -s pelicanconf.py

## Useful Options

- Dry-run minification without writing slides:

  python3 scripts/prebuild.py --dry-run

- Run only logo rendering:

  python3 scripts/prebuild.py --skip-slides

- Run only slide minification:

  python3 scripts/prebuild.py --skip-logo

## Git Ignore Notes

Font files are ignored by .gitignore for both:
- fonts
- theme/my-wedding-theme/static/fonts

If a font was already staged or tracked before the ignore rules, untrack it once:

git rm --cached -r fonts theme/my-wedding-theme/static/fonts
