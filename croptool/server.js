const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const YAML = require('yaml');

const START_PORT = Number.parseInt(process.env.PORT || '4173', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_DIR = path.join(__dirname, '.croptool-cache');
const LAST_FOLDER_FILE = path.join(CACHE_DIR, 'last-folder.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const fsp = fs.promises;

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function isSupportedImageName(fileName) {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg');
}

function toDataUrl(fileName, buffer) {
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

async function pickFolderPath() {
  if (process.platform !== 'darwin') {
    throw new Error('Selecting a folder path from Node is only supported on macOS in this build.');
  }

  return new Promise((resolve, reject) => {
    const script = 'POSIX path of (choose folder with prompt "Select a folder of images")';
    const child = spawn('osascript', ['-e', script]);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code) => {
      const output = `${stdout}\n${stderr}`.trim();

      if (code === 0 && stdout.trim()) {
        resolve(path.resolve(stdout.trim()));
        return;
      }

      if (/User canceled|User canceled\./i.test(output)) {
        resolve(null);
        return;
      }

      reject(new Error(output || `Folder picker failed with exit code ${code}`));
    });
  });
}

async function readFolderImages(folderPath) {
  const imageRecords = [];

  async function walk(currentPath, relativeDir = '') {
    const entries = await fsp.readdir(currentPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

      if (entry.isDirectory()) {
        await walk(entryPath, relativePath);
        continue;
      }

      if (entry.isFile() && isSupportedImageName(entry.name)) {
        const buffer = await fsp.readFile(entryPath);
        imageRecords.push({
          name: relativePath,
          displayName: entry.name,
          dataUrl: toDataUrl(entry.name, buffer)
        });
      }
    }
  }

  await walk(folderPath);
  return imageRecords;
}

async function readFolderAtPath(folderPath) {
  const resolvedPath = path.resolve(folderPath);
  const folderStat = await fsp.stat(resolvedPath);

  if (!folderStat.isDirectory()) {
    throw new Error('Selected path is not a folder.');
  }

  const imageRecords = await readFolderImages(resolvedPath);
  if (imageRecords.length === 0) {
    throw new Error('No PNG/JPG/JPEG images were found in the selected folder.');
  }

  let cropsText = null;
  try {
    cropsText = await fsp.readFile(path.join(resolvedPath, 'crops.yaml'), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  return {
    folderPath: resolvedPath,
    folderName: path.basename(resolvedPath),
    imageRecords,
    cropsText
  };
}

async function writeCropsFile(folderPath, content) {
  const resolvedPath = path.resolve(folderPath);
  await fsp.writeFile(path.join(resolvedPath, 'crops.yaml'), content, 'utf8');
}

async function deleteCropsFile(folderPath) {
  const resolvedPath = path.resolve(folderPath);

  try {
    await fsp.unlink(path.join(resolvedPath, 'crops.yaml'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

function readJsonFile(filePath, fallback = null) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return fallback;
    }

    throw err;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(payload)}\n`);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function normalizePointEntry(point, fallbackAspectRatio = null) {
  const aspectRatio = Number(point && point.aspectRatio !== undefined ? point.aspectRatio : fallbackAspectRatio);
  const x = Number(point && point.x);
  const y = Number(point && point.y);
  const scale = Number(point && point.scale);

  if (!Number.isFinite(aspectRatio) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale)) {
    return null;
  }

  return { aspectRatio, x, y, scale };
}

function normalizeCropPoints(parsed) {
  const images = parsed && typeof parsed === 'object'
    ? parsed.images || parsed.design_points || parsed.designPoints || parsed
    : null;

  if (!images || typeof images !== 'object' || Array.isArray(images)) {
    throw new Error('crops.yaml must contain an image-to-design-point dictionary');
  }

  const normalized = {};

  for (const [imageName, points] of Object.entries(images)) {
    if (!points || typeof points !== 'object') {
      throw new Error(`Invalid design point entry for ${imageName}`);
    }

    const pointList = [];

    if (Array.isArray(points)) {
      for (const point of points) {
        const normalizedPoint = normalizePointEntry(point);
        if (!normalizedPoint) {
          throw new Error(`Invalid design point data for ${imageName}`);
        }

        pointList.push(normalizedPoint);
      }
    } else {
      for (const [ratioLabel, point] of Object.entries(points)) {
        const normalizedPoint = normalizePointEntry(point, ratioLabel);
        if (!normalizedPoint) {
          throw new Error(`Invalid design point data for ${imageName} at ratio ${ratioLabel}`);
        }

        pointList.push(normalizedPoint);
      }
    }

    pointList.sort((a, b) => a.aspectRatio - b.aspectRatio);
    normalized[imageName] = pointList;
  }

  return normalized;
}

function parseCropYaml(content) {
  const parsed = YAML.parse(content);
  return normalizeCropPoints(parsed);
}

ensureCacheDir();

function createServer() {
  return http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (req.method === 'GET' && urlPath === '/api/last-folder') {
    try {
      const data = readJsonFile(LAST_FOLDER_FILE, null);
      sendJson(res, 200, { ok: true, data });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/last-folder') {
    readRequestBody(req)
      .then((body) => {
        const payload = body ? JSON.parse(body) : {};
        const folderPath = typeof payload.folderPath === 'string' ? payload.folderPath.trim() : '';
        const folderName = typeof payload.folderName === 'string' ? payload.folderName.trim() : path.basename(folderPath);

        if (!folderPath) {
          sendJson(res, 400, { ok: false, error: 'folderPath is required' });
          return;
        }

        const data = {
          folderPath,
          folderName,
          updatedAt: new Date().toISOString()
        };

        writeJsonFile(LAST_FOLDER_FILE, data);
        sendJson(res, 200, { ok: true, data });
      })
      .catch((err) => {
        sendJson(res, 400, { ok: false, error: err.message });
      });
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/pick-folder') {
    pickFolderPath()
      .then((folderPath) => {
        if (!folderPath) {
          sendJson(res, 200, { ok: true, cancelled: true });
          return;
        }

        sendJson(res, 200, {
          ok: true,
          folderPath,
          folderName: path.basename(folderPath)
        });
      })
      .catch((err) => {
        sendJson(res, 500, { ok: false, error: err.message });
      });
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/read-folder') {
    readRequestBody(req)
      .then((body) => {
        const payload = body ? JSON.parse(body) : {};
        const folderPath = typeof payload.folderPath === 'string' ? payload.folderPath.trim() : '';

        if (!folderPath) {
          sendJson(res, 400, { ok: false, error: 'folderPath is required' });
          return;
        }

        readFolderAtPath(folderPath)
          .then((data) => {
            sendJson(res, 200, { ok: true, data });
          })
          .catch((err) => {
            sendJson(res, 400, { ok: false, error: err.message });
          });
      })
      .catch((err) => {
        sendJson(res, 400, { ok: false, error: err.message });
      });
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/save-crops') {
    readRequestBody(req)
      .then((body) => {
        const payload = body ? JSON.parse(body) : {};
        const folderPath = typeof payload.folderPath === 'string' ? payload.folderPath.trim() : '';
        const content = typeof payload.content === 'string' ? payload.content : '';

        if (!folderPath) {
          sendJson(res, 400, { ok: false, error: 'folderPath is required' });
          return;
        }

        if (!content.trim()) {
          sendJson(res, 400, { ok: false, error: 'content is required' });
          return;
        }

        writeCropsFile(folderPath, content)
          .then(() => {
            sendJson(res, 200, { ok: true });
          })
          .catch((err) => {
            sendJson(res, 400, { ok: false, error: err.message });
          });
      })
      .catch((err) => {
        sendJson(res, 400, { ok: false, error: err.message });
      });
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/delete-crops') {
    readRequestBody(req)
      .then((body) => {
        const payload = body ? JSON.parse(body) : {};
        const folderPath = typeof payload.folderPath === 'string' ? payload.folderPath.trim() : '';

        if (!folderPath) {
          sendJson(res, 400, { ok: false, error: 'folderPath is required' });
          return;
        }

        deleteCropsFile(folderPath)
          .then(() => {
            sendJson(res, 200, { ok: true });
          })
          .catch((err) => {
            sendJson(res, 400, { ok: false, error: err.message });
          });
      })
      .catch((err) => {
        sendJson(res, 400, { ok: false, error: err.message });
      });
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/folder-path') {
    pickFolderPath()
      .then((folderPath) => {
        if (!folderPath) {
          sendJson(res, 200, { ok: true, cancelled: true });
          return;
        }

        readFolderAtPath(folderPath)
          .then((data) => {
            sendJson(res, 200, { ok: true, data });
          })
          .catch((err) => {
            sendJson(res, 400, { ok: false, error: err.message });
          });
      })
      .catch((err) => {
        sendJson(res, 500, { ok: false, error: err.message });
      });
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/parse-crops') {
    readRequestBody(req)
      .then((body) => {
        const payload = body ? JSON.parse(body) : {};
        const content = typeof payload.content === 'string' ? payload.content : '';

        if (!content.trim()) {
          sendJson(res, 400, { ok: false, error: 'content is required' });
          return;
        }

        try {
          const designPointsByImage = parseCropYaml(content);
          sendJson(res, 200, { ok: true, designPointsByImage });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err.message });
        }
      })
      .catch((err) => {
        sendJson(res, 400, { ok: false, error: err.message });
      });
    return;
  }

  const safePath = path.normalize(urlPath).replace(/^\/+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);

  if (urlPath === '/' || safePath === '') {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  sendFile(res, filePath);
});
}

function startServer(port) {
  const server = createServer();

  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is in use, trying ${port + 1}...`);
      startServer(port + 1);
      return;
    }

    throw err;
  });

  server.listen(port, () => {
    console.log(`Croptool running at http://localhost:${port}`);
  });
}

startServer(START_PORT);
