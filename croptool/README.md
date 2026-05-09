# Croptool

A local Node.js web app for selecting image design points and saving them to `crops.yaml`.

## What this does

- Lets you choose a folder from your computer using the local macOS folder picker.
- Shows all PNG/JPG/JPEG files as thumbnails in a horizontal bar.
- Lets you select an image and move a crop box on a large canvas.
- Shows a translucent haze outside the crop box.
- Draws a bright reticle at the crop center.
- Stores design points in memory as a dictionary mapping image names to aspect-ratio keyed `{ x, y, scale }` values.
- Automatically loads the last selected folder path when available.
- Saves crop settings back into a `crops.yaml` file in the selected folder path.

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
6. Click **Save crop settings** to write `crops.yaml` back into the selected folder.
7. View the in-memory design-point dictionary on the right side.

## Notes

- The app stores the last selected folder path in a small cache file in `croptool/.croptool-cache/`.
- The cache folder is gitignored and contains a `.gitkeep` placeholder so the directory exists in the repo.
- Saving crop settings requires running the local Node server on macOS so it can open the system folder dialog and write to the chosen folder.
