import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer'; // Yeni import

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// In-memory storage for generated images
const imageStorage = new Map();

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Sadece görsel dosyaları yüklenebilir'));
    }
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/generate-image', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Generate unique session ID
  const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);

  // Server-Sent Events headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  try {
    console.log('Starting image generation for prompt:', prompt);
    
    const stream = await openai.responses.create({
      model: "gpt-4.1",
      input: prompt,
      stream: true,
      tools: [{ 
        type: "image_generation", 
        partial_images: 3
      }],
    });

    let lastPartialImage = null;
    let highestPartialIndex = -1;

    for await (const event of stream) {
      console.log('Received event:', event.type);
      
      if (event.type === "response.image_generation_call.partial_image") {
        const data = {
          type: 'partial',
          index: event.partial_image_index,
          image: event.partial_image_b64,
          sessionId: sessionId
        };
        
        // Son partial image'ı saklayalım (en yüksek index'e sahip olan)
        if (event.partial_image_index > highestPartialIndex) {
          highestPartialIndex = event.partial_image_index;
          lastPartialImage = event.partial_image_b64;
        }
        
        console.log(`Sending partial image ${event.partial_image_index}, size: ${event.partial_image_b64?.length || 0}`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
      
      if (event.type === "response.image_generation_call.completed") {
        console.log('Completed event full object:', JSON.stringify(event, null, 2));
        
        // Store final image for download
        const imageData = {
          prompt: prompt,
          image: lastPartialImage,
          createdAt: new Date().toISOString(),
          filename: `ai_generated_${sessionId}.png`
        };
        
        imageStorage.set(sessionId, imageData);
        
        // Son partial image'ı nihai görsel olarak kullan
        const data = {
          type: 'completed',
          image: lastPartialImage,
          sessionId: sessionId,
          downloadUrl: `/download/${sessionId}`
        };
        
        console.log(`Sending final image (using last partial), size: ${lastPartialImage?.length || 0}`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        break;
      }
    }

    res.write(`data: ${JSON.stringify({type: "done"})}\n\n`);
    res.end();

  } catch (error) {
    console.error('Error generating image:', error);
    const errorData = {
      type: 'error', 
      message: error.message
    };
    res.write(`data: ${JSON.stringify(errorData)}\n\n`);
    res.end();
  }
});

// Image download endpoint
app.get('/download/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const imageData = imageStorage.get(sessionId);

  if (!imageData) {
    return res.status(404).json({ error: 'Görsel bulunamadı' });
  }

  try {
    // Convert base64 to buffer
    const imageBuffer = Buffer.from(imageData.image, 'base64');
    
    // Set headers for file download
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${imageData.filename}"`);
    res.setHeader('Content-Length', imageBuffer.length);
    
    // Send the image
    res.send(imageBuffer);
    
    console.log(`Image downloaded: ${imageData.filename}`);
    
  } catch (error) {
    console.error('Error serving image:', error);
    res.status(500).json({ error: 'Görsel indirirken hata oluştu' });
  }
});

// Image analysis endpoint - Generate prompt from uploaded image
app.post('/analyze-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Görsel dosyası gerekli' });
    }

    console.log('Analyzing uploaded image:', req.file.originalname);

    // Convert buffer to base64
    const imageBase64 = req.file.buffer.toString('base64');
    const imageDataUrl = `data:${req.file.mimetype};base64,${imageBase64}`;

    // Analyze image with GPT-4 Vision
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Bu görseli detaylı olarak analiz et ve bu görsel için AI görsel üretim modeline verilebilecek mükemmel bir prompt oluştur. 

Prompt'ın özellikleri:
- Görsel unsurları (objeler, kişiler, hayvanlar) açık bir şekilde tanımla
- Renk paletini ve atmosferi belirt
- Sanat stilini veya tekniği açıkla (fotoğraf, çizim, dijital sanat vb.)
- Kompozisyon ve perspektifi tanımla
- Işıklandırma ve gölgelendirmeyi açıkla
- Arka plan ve ortamı detaylandır

Sadece prompt'ı ver, açıklama yapma. Prompt Türkçe olsun ve AI görsel üretimi için optimize edilmiş olsun.`
            },
            {
              type: "image_url",
              image_url: {
                url: imageDataUrl
              }
            }
          ]
        }
      ],
      max_tokens: 500
    });

    const generatedPrompt = response.choices[0].message.content;

    console.log('Generated prompt:', generatedPrompt);

    res.json({
      success: true,
      prompt: generatedPrompt,
      imageInfo: {
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    });

  } catch (error) {
    console.error('Error analyzing image:', error);
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Dosya boyutu çok büyük (maksimum 10MB)' });
    }
    
    res.status(500).json({ 
      error: 'Görsel analizi sırasında hata oluştu: ' + error.message 
    });
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:3000`);
});