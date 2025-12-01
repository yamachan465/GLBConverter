import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Setup
app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.static('.'));

// Temp directory for uploads
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.body.sessionId || Date.now().toString();
    const sessionDir = path.join(TEMP_DIR, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// API endpoint: Receive processed files and create ZIP
app.post('/api/create-zip', express.json({ limit: '100mb' }), async (req, res) => {
  try {
    const { sessionId, files } = req.body;

    console.log(`Creating ZIP for session ${sessionId}...`);

    const outputDir = path.join(TEMP_DIR, sessionId, 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save all files
    for (const fileData of files) {
      const { path: filePath, content, type } = fileData;
      const fullPath = path.join(outputDir, filePath);
      const dirPath = path.dirname(fullPath);

      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      let buffer;
      if (type === 'base64') {
        // Remove data URL prefix if present
        const base64Data = content.replace(/^data:.*?;base64,/, '');
        buffer = Buffer.from(base64Data, 'base64');
      } else if (type === 'json') {
        buffer = Buffer.from(JSON.stringify(content, null, 2));
      } else {
        buffer = Buffer.from(content);
      }

      fs.writeFileSync(fullPath, buffer);
      console.log(`  Saved: ${filePath}`);
    }

    // Create ZIP
    const zipPath = path.join(TEMP_DIR, sessionId, 'ar_output.zip');
    await createZip(outputDir, zipPath);

    res.json({
      success: true,
      downloadUrl: `/download/${sessionId}/ar_output.zip`
    });
  } catch (error) {
    console.error('Error creating ZIP:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Proxy endpoint for CORS bypass
app.get('/api/proxy-image', async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    // Convert Google Drive URL if needed
    let fetchUrl = url;
    const driveMatch1 = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    const driveMatch2 = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);

    if (driveMatch1) {
      fetchUrl = `https://drive.google.com/uc?export=download&id=${driveMatch1[1]}`;
    } else if (driveMatch2) {
      fetchUrl = `https://drive.google.com/uc?export=download&id=${driveMatch2[1]}`;
    }

    const response = await fetch(fetchUrl);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Failed to fetch: ${response.statusText}` });
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    res.set('Content-Type', contentType);
    res.set('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download endpoint
app.get('/download/:sessionId/:filename', (req, res) => {
  const { sessionId, filename } = req.params;
  const filePath = path.join(TEMP_DIR, sessionId, filename);

  if (fs.existsSync(filePath)) {
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('Download error:', err);
      }
      // Cleanup after download
      setTimeout(() => {
        const sessionDir = path.join(TEMP_DIR, sessionId);
        if (fs.existsSync(sessionDir)) {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        }
      }, 60000); // Clean up after 1 minute
    });
  } else {
    res.status(404).send('File not found');
  }
});

// Helper function
async function createZip(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

app.listen(PORT, () => {
  console.log(`🚀 AR Automation Server running at http://localhost:${PORT}`);
  console.log(`📁 Open http://localhost:${PORT}/ar-automation.html to start`);
});
