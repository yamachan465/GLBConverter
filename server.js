import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import validator from 'validator';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// ========================================
// セキュリティ設定
// ========================================

// Helmet - セキュリティヘッダー
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "esm.sh", "unpkg.com", "cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "drive.google.com"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true
  }
}));

// CORS - 特定のオリジンのみ許可（開発環境用）
const corsOptions = {
  origin: function (origin, callback) {
    // localhostからのアクセスのみ許可（本番環境では特定ドメインを指定）
    const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
};
app.use(cors(corsOptions));

// レート制限 - 全体
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 100, // 最大100リクエスト
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});
app.use(generalLimiter);

// レート制限 - プロキシエンドポイント（特に厳しく）
const proxyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分
  max: 10, // 最大10リクエスト
  message: 'Too many proxy requests, please slow down.'
});

// ボディパーサー - サイズ制限を厳しく
app.use(express.json({ limit: '50mb' })); // 500mbから50mbに削減
app.use(express.static('.'));

// ========================================
// ユーティリティ関数
// ========================================

// セキュアなセッションID生成
function generateSecureSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

// パストラバーサル対策
function sanitizePath(unsafePath) {
  // パスの正規化と..の除去
  const normalized = path.normalize(unsafePath).replace(/^(\.\.[\/\\])+/, '');
  // スラッシュのみに統一
  return normalized.split(path.sep).join('/');
}

// ファイルパスの検証（ベースディレクトリ外へのアクセス防止）
function validatePath(basePath, targetPath) {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase);
}

// ファイル名の検証
function isValidFilename(filename) {
  // 英数字、アンダースコア、ハイフン、ドットのみ許可
  return /^[a-zA-Z0-9_\-\.]+$/.test(filename);
}

// セッションIDの検証
function isValidSessionId(sessionId) {
  return /^[a-f0-9]{64}$/.test(sessionId);
}

// 拡張子の検証
function isAllowedFileExtension(filename) {
  const allowed = ['.glb', '.mind', '.json'];
  const ext = path.extname(filename).toLowerCase();
  return allowed.includes(ext);
}

// 画像マジックバイトの検証
function validateImageBuffer(buffer) {
  const uint8 = new Uint8Array(buffer).slice(0, 4);

  // PNG: 89 50 4E 47
  if (uint8[0] === 0x89 && uint8[1] === 0x50 && uint8[2] === 0x4E && uint8[3] === 0x47) {
    return { valid: true, type: 'image/png' };
  }

  // JPEG: FF D8 FF
  if (uint8[0] === 0xFF && uint8[1] === 0xD8 && uint8[2] === 0xFF) {
    return { valid: true, type: 'image/jpeg' };
  }

  // WebP: 52 49 46 46
  if (uint8[0] === 0x52 && uint8[1] === 0x49 && uint8[2] === 0x46 && uint8[3] === 0x46) {
    return { valid: true, type: 'image/webp' };
  }

  return { valid: false, type: null };
}

// URLのホワイトリスト検証
function isAllowedDomain(url) {
  try {
    const urlObj = new URL(url);
    const allowedDomains = [
      'drive.google.com',
      'lh3.googleusercontent.com' // Google Drive画像
    ];
    return allowedDomains.includes(urlObj.hostname);
  } catch {
    return false;
  }
}

// プライベートIPアドレスのチェック（SSRF対策）
function isPrivateIP(hostname) {
  // IPv4プライベートアドレス範囲
  const privateRanges = [
    /^127\./,                     // localhost
    /^10\./,                      // Class A private
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Class B private
    /^192\.168\./,                // Class C private
    /^169\.254\./,                // Link-local
    /^::1$/,                      // IPv6 localhost
    /^fc00:/,                     // IPv6 private
    /^fe80:/                      // IPv6 link-local
  ];

  return privateRanges.some(pattern => pattern.test(hostname));
}

// ========================================
// Temp directory setup
// ========================================

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ========================================
// Multer設定
// ========================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.body.sessionId || generateSecureSessionId();

    // セッションIDの検証
    if (!isValidSessionId(sessionId)) {
      return cb(new Error('Invalid session ID'));
    }

    const sessionDir = path.join(TEMP_DIR, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    // ファイル名のサニタイズ
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    cb(null, sanitized);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MBに制限
    files: 10 // 最大10ファイル
  },
  fileFilter: (req, file, cb) => {
    // MIMEタイプの検証
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
    }
  }
});

// ========================================
// API エンドポイント
// ========================================

// API endpoint: Receive processed files and create ZIP
app.post('/api/create-zip', express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const { sessionId, files } = req.body;

    // 入力検証
    if (!sessionId || !isValidSessionId(sessionId)) {
      return res.status(400).json({ success: false, error: 'Invalid session ID' });
    }

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid files array' });
    }

    if (files.length > 1000) {
      return res.status(400).json({ success: false, error: 'Too many files' });
    }

    console.log(`Creating ZIP for session ${sessionId}...`);

    const sessionDir = path.join(TEMP_DIR, sessionId);
    const outputDir = path.join(sessionDir, 'output');

    // パスの検証
    if (!validatePath(TEMP_DIR, sessionDir)) {
      return res.status(400).json({ success: false, error: 'Invalid path' });
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save all files
    for (const fileData of files) {
      const { path: filePath, content, type } = fileData;

      // ファイルパスのサニタイズと検証
      const safePath = sanitizePath(filePath);

      if (!safePath || safePath.length > 255) {
        console.warn(`Invalid file path: ${filePath}`);
        continue;
      }

      const fullPath = path.join(outputDir, safePath);

      // パストラバーサル対策
      if (!validatePath(outputDir, fullPath)) {
        console.warn(`Path traversal attempt: ${filePath}`);
        continue;
      }

      // 拡張子の検証
      if (!isAllowedFileExtension(fullPath)) {
        console.warn(`Invalid file extension: ${filePath}`);
        continue;
      }

      const dirPath = path.dirname(fullPath);

      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      let buffer;
      if (type === 'base64') {
        // Base64のサイズ制限
        if (content.length > 20 * 1024 * 1024) { // 20MB
          console.warn(`Base64 content too large: ${filePath}`);
          continue;
        }

        const base64Data = content.replace(/^data:.*?;base64,/, '');
        buffer = Buffer.from(base64Data, 'base64');
      } else if (type === 'json') {
        buffer = Buffer.from(JSON.stringify(content, null, 2));
      } else {
        buffer = Buffer.from(content);
      }

      // バッファサイズの検証
      if (buffer.length > 20 * 1024 * 1024) {
        console.warn(`Buffer too large: ${filePath}`);
        continue;
      }

      fs.writeFileSync(fullPath, buffer);
      console.log(`  Saved: ${safePath}`);
    }

    // Create ZIP
    const zipPath = path.join(sessionDir, 'ar_output.zip');
    await createZip(outputDir, zipPath);

    res.json({
      success: true,
      downloadUrl: `/download/${sessionId}/ar_output.zip`
    });
  } catch (error) {
    console.error('Error creating ZIP:', error);
    // 詳細なエラーは隠す
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Proxy endpoint for CORS bypass（SSRF対策強化）
app.get('/api/proxy-image', proxyLimiter, async (req, res) => {
  try {
    const { url } = req.query;

    // URL検証
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Invalid URL parameter' });
    }

    if (!validator.isURL(url, { protocols: ['https'], require_protocol: true })) {
      return res.status(400).json({ error: 'Invalid URL format. Only HTTPS URLs are allowed.' });
    }

    // ドメインホワイトリスト検証
    if (!isAllowedDomain(url)) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }

    console.log('Proxy request for:', url);

    // Convert Google Drive URL if needed
    let fetchUrl = url;
    const driveMatch1 = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    const driveMatch2 = url.match(/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/);

    if (driveMatch1) {
      const fileId = driveMatch1[1];
      fetchUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
      console.log('Converted to Google Drive download URL');
    } else if (driveMatch2) {
      const fileId = driveMatch2[1];
      fetchUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
      console.log('Converted to Google Drive download URL');
    }

    // タイムアウト設定
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30秒

    try {
      // Fetch with proper headers
      const response = await fetch(fetchUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      clearTimeout(timeout);

      console.log('Response status:', response.status, response.statusText);

      if (!response.ok) {
        console.error('Fetch failed:', response.status, response.statusText);
        return res.status(response.status).json({ error: 'Failed to fetch image' });
      }

      const buffer = await response.arrayBuffer();

      // サイズ制限
      const MAX_SIZE = 10 * 1024 * 1024; // 10MB
      if (buffer.byteLength > MAX_SIZE) {
        return res.status(413).json({ error: 'File too large' });
      }

      // 画像の検証（マジックバイト）
      const validation = validateImageBuffer(buffer);
      if (!validation.valid) {
        return res.status(400).json({ error: 'Invalid image file' });
      }

      console.log('Successfully fetched:', buffer.byteLength, 'bytes, type:', validation.type);

      res.set('Content-Type', validation.type);
      res.set('Access-Control-Allow-Origin', 'http://localhost:3000');
      res.set('Cache-Control', 'public, max-age=3600'); // 1時間キャッシュ
      res.send(Buffer.from(buffer));
    } catch (fetchError) {
      clearTimeout(timeout);
      if (fetchError.name === 'AbortError') {
        return res.status(408).json({ error: 'Request timeout' });
      }
      throw fetchError;
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download endpoint（パストラバーサル対策）
app.get('/download/:sessionId/:filename', (req, res) => {
  try {
    const { sessionId, filename } = req.params;

    // セッションIDの検証
    if (!isValidSessionId(sessionId)) {
      return res.status(400).send('Invalid session ID');
    }

    // ファイル名の検証
    if (!isValidFilename(filename)) {
      return res.status(400).send('Invalid filename');
    }

    const sessionDir = path.join(TEMP_DIR, sessionId);
    const filePath = path.join(sessionDir, filename);

    // パストラバーサル対策
    if (!validatePath(sessionDir, filePath)) {
      console.warn(`Path traversal attempt: ${filename}`);
      return res.status(400).send('Invalid path');
    }

    if (fs.existsSync(filePath)) {
      res.download(filePath, filename, (err) => {
        if (err) {
          console.error('Download error:', err);
          return res.status(500).send('Download failed');
        }
        // Cleanup after download
        setTimeout(() => {
          if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
          }
        }, 60000); // Clean up after 1 minute
      });
    } else {
      res.status(404).send('File not found');
    }
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).send('Internal server error');
  }
});

// ========================================
// ヘルパー関数
// ========================================

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

// ========================================
// エラーハンドリング
// ========================================

// 404ハンドラー
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// グローバルエラーハンドラー
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ========================================
// サーバー起動
// ========================================

app.listen(PORT, () => {
  console.log(`🚀 AR Automation Server running at http://localhost:${PORT}`);
  console.log(`📁 Open http://localhost:${PORT}/index.html to start`);
  console.log(`🔒 Security features enabled: Helmet, Rate Limiting, Input Validation`);
});
