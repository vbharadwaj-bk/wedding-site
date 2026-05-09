# Croptool

A local Node.js web app for selecting image crop centers.

## What this does

- Lets you choose a folder from your computer.
- Shows all PNG/JPG/JPEG files as thumbnails in a horizontal bar.
- Lets you select an image and move a crop box on a large canvas.
- Shows a translucent haze outside the crop box.
- Draws a bright reticle at the crop center.
- Stores center points in memory as a dictionary mapping image names to `{ x, y }`.
- Defaults each image center point to the exact image center when first loaded.

## Prerequisite

Install Node.js 18 or newer.

## Run it

From the repository root:

```bash
cd croptool
npm start
```

Then open this URL in your browser:

http://localhost:4173

## Usage

1. Click **Select Folder**.
2. Pick any local folder containing images.
3. Click thumbnails to switch images.
4. Drag inside the crop box to move it.
5. Use the aspect ratio slider to change crop shape.
6. View or copy the in-memory JSON mapping on the right side.

## Notes

- This app is intentionally local and does not save files to disk.
- The centers dictionary exists in browser memory and resets on page reload.
