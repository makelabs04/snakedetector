const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ─── Gemini FREE API Setup ────────────────────────────────────────────────────
// Get your FREE key at: https://aistudio.google.com/app/apikey
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyCMiwyvaiKflf7LOatW9XbPg3SMRVTFmVI';
console.log('Using API key:', GEMINI_API_KEY.substring(0, 10) + '...');
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
// ─────────────────────────────────────────────────────────────────────────────

// Multer setup for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));

// Store latest detection result for ESP32 polling
let latestDetection = { snakeBite: false, confidence: 0, details: '', timestamp: null };
let connectedESP32 = false;

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.emit('detection-update', latestDetection);

  socket.on('esp32-register', () => {
    connectedESP32 = true;
    console.log('ESP32 registered');
    io.emit('esp32-status', { connected: true });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ─── Gemini Vision Analysis (with retry) ─────────────────────────────────────
async function analyzeImageForSnakeBite(imageBase64, mimeType) {
  const prompt = `You are a medical image analysis assistant specialized in detecting snake bite marks on human skin.

Carefully analyze this image and determine if it shows snake bite marks or puncture wounds consistent with a snake bite.

Look for:
- Two small puncture wounds close together (fang marks)
- Redness, swelling, or bruising around wound sites
- Characteristic fang mark patterns
- Any skin trauma consistent with snake envenomation

Respond ONLY with a valid JSON object, no markdown, no extra text:
{
  "snakeBite": true or false,
  "confidence": 0-100,
  "details": "brief explanation of what you observed",
  "severity": "none or mild or moderate or severe",
  "recommendation": "brief action recommendation"
}`;

  const imagePart = { inlineData: { data: imageBase64, mimeType } };

  // Retry up to 3 times on 503 / 429 transient errors
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[GEMINI] Attempt ${attempt}/3...`);
      const result = await model.generateContent([prompt, imagePart]);
      const text = result.response.text();
      console.log('Gemini raw response:', text);

      const clean = text.replace(/```json|```/g, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error(`Attempt ${attempt} failed:`, e.message);
      const is503 = e.message.includes('503') || e.message.includes('Service Unavailable');
      const is429transient = e.message.includes('429') && e.message.includes('retry in');

      if ((is503 || is429transient) && attempt < 3) {
        const waitSec = attempt * 5;
        console.log(`Waiting ${waitSec}s before retry...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      } else {
        throw e; // quota exhausted or non-retriable — surface the real error
      }
    }
  }

  return {
    snakeBite: false,
    confidence: 0,
    details: 'Could not analyze image properly.',
    severity: 'none',
    recommendation: 'Please try with a clearer image.'
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// POST /api/detect — Upload image file
app.post('/api/detect', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const imageBuffer = fs.readFileSync(req.file.path);
    const imageBase64 = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype;

    console.log(`\n[GEMINI] Analyzing image: ${req.file.filename}`);
    const result = await analyzeImageForSnakeBite(imageBase64, mimeType);

    latestDetection = {
      ...result,
      timestamp: new Date().toISOString(),
      imageFile: req.file.filename,
      source: 'upload'
    };

    io.emit('detection-update', latestDetection);
    fs.unlink(req.file.path, () => {});

    res.json(latestDetection);
  } catch (error) {
    console.error('Detection error:', error.message);
    res.status(500).json({ error: 'Analysis failed: ' + error.message });
  }
});

// POST /api/detect-camera — Base64 image from ESP32-CAM
app.post('/api/detect-camera', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    console.log('\n[GEMINI] Analyzing ESP32-CAM frame...');
    const result = await analyzeImageForSnakeBite(imageBase64, mimeType);

    latestDetection = {
      ...result,
      timestamp: new Date().toISOString(),
      source: 'esp32-camera'
    };

    io.emit('detection-update', latestDetection);
    res.json(latestDetection);
  } catch (error) {
    console.error('Camera detection error:', error.message);
    res.status(500).json({ error: 'Analysis failed: ' + error.message });
  }
});

// GET /api/status — ESP32 polls this
app.get('/api/status', (req, res) => {
  res.json({
    alert: latestDetection.snakeBite === true,
    snakeBite: latestDetection.snakeBite,
    confidence: latestDetection.confidence,
    severity: latestDetection.severity || 'none',
    timestamp: latestDetection.timestamp
  });
});

// GET /api/latest — Full latest result
app.get('/api/latest', (req, res) => {
  res.json(latestDetection);
});

// POST /api/reset — Reset alert state
app.post('/api/reset', (req, res) => {
  latestDetection = {
    snakeBite: false,
    confidence: 0,
    details: 'System reset',
    severity: 'none',
    recommendation: '',
    timestamp: new Date().toISOString()
  };
  io.emit('detection-update', latestDetection);
  res.json({ success: true, message: 'System reset' });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   🐍 SnakeGuard — Gemini FREE API Edition    ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   Dashboard  : http://localhost:${PORT}          ║`);
  console.log(`║   ESP32 poll : GET  /api/status              ║`);
  console.log(`║   Upload     : POST /api/detect              ║`);
  console.log(`║   CAM frame  : POST /api/detect-camera       ║`);
  console.log(`║   Model      : gemini-2.5-flash (FREE)       ║`);
  console.log('╚══════════════════════════════════════════════╝\n');
});
