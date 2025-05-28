import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg'; // Yeni import
import fs from 'fs';
import { promisify } from 'util';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// In-memory storage for generated images and videos
const imageStorage = new Map();
const videoStorage = new Map();

// Enhanced multer configuration for both images and videos
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit for videos
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Sadece görsel ve video dosyaları yüklenebilir'));
    }
  }
});

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);

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

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
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

// Video analysis endpoint - Enhanced with better audio integration
app.post('/analyze-video', upload.single('video'), async (req, res) => {
  const tempVideoPath = path.join(__dirname, 'temp_video_' + Date.now() + '.mp4');
  const tempAudioPath = path.join(__dirname, 'temp_audio_' + Date.now() + '.wav'); // WAV format
  const tempFramesDir = path.join(__dirname, 'temp_frames_' + Date.now());

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Video dosyası gerekli' });
    }

    console.log('Analyzing uploaded video with enhanced audio:', req.file.originalname);

    // Create temp directory for frames
    if (!fs.existsSync(tempFramesDir)) {
      fs.mkdirSync(tempFramesDir);
    }

    // Save video file temporarily
    await writeFile(tempVideoPath, req.file.buffer);

    // Extract frames from video
    console.log('Extracting frames...');
    const frameFiles = await extractFrames(tempVideoPath, tempFramesDir);

    if (frameFiles.length === 0) {
      throw new Error('Video\'dan frame çıkarılamadı');
    }

    console.log(`Extracted ${frameFiles.length} frames from video`);

    // Convert frames to base64
    const frameBase64Array = [];
    for (let i = 0; i < Math.min(frameFiles.length, 6); i++) {
      const framePath = path.join(tempFramesDir, frameFiles[i]);
      const frameBuffer = fs.readFileSync(framePath);
      const frameBase64 = frameBuffer.toString('base64');
      frameBase64Array.push(`data:image/jpeg;base64,${frameBase64}`);
    }

    // Extract and transcribe audio
    console.log('Extracting and analyzing audio...');
    const audioTranscription = await extractAndTranscribeAudio(tempVideoPath, tempAudioPath);

    console.log('Audio analysis result:', audioTranscription);

    // Determine if we have meaningful audio
    const hasValidAudio = audioTranscription &&
      !audioTranscription.includes('sessiz') &&
      !audioTranscription.includes('yapılamadı') &&
      !audioTranscription.includes('çıkarılamadı') &&
      !audioTranscription.includes('problemi') // Yeni eklenen kontrol
    audioTranscription.length > 20;

    // Create enhanced analysis prompt
    let analysisPrompt;

    if (hasValidAudio) {
      analysisPrompt = `Bu video karelerini ve ses içeriğini birlikte analiz et:

🎵 **SES İÇERİĞİ:**
"${audioTranscription}"

📹 **GÖRSEL ANALİZİ:**
Video karelerini inceleyerek şunları detaylandır:

**İçerik ve Hikaye:**
- Video boyunca neler oluyor? Genel akış nedir?
- Ses ile görüntü arasında nasıl bir bağlantı var?
- Konuşulan konu görsel içerikle uyumlu mu?

**Görsel Detaylar:**
- Hangi objeler, kişiler, hayvanlar görünüyor?
- Ortam nedir? (iç/dış mekan, doğa, şehir, stüdyo vb.)
- Renkler, ışıklandırma ve atmosfer nasıl?
- Önemli hareket ve aksiyonlar neler?

**Genel Değerlendirme:**
- Video hangi kategori? (eğitim, eğlence, belgesel, spor vb.)
- Ses tonu ve atmosferi nasıl?
- Öne çıkan önemli anlar var mı?

Hem ses hem görsel içeriği birleştirerek kapsamlı bir analiz yap. Türkçe cevap ver.`;
    } else {
      analysisPrompt = `Bu video karelerini analiz et:

📹 **GÖRSEL ODAKLI ANALİZ:**
(Bu video sessiz veya ses analizi yapılamadı: ${audioTranscription})

**İçerik ve Hikaye:**
- Video boyunca neler oluyor? Görsel akış nedir?
- Hangi objeler, kişiler, hayvanlar görünüyor?
- Ortam nedir? (iç/dış mekan, doğa, şehir, stüdyo vb.)

**Atmosfer ve Teknik:**
- Renkler, ışıklandırma ve atmosfer nasıl?
- Hareket ve aksiyonlar neler?
- Video hangi tür/kategori? (eğitim, eğlence, belgesel vb.)
- Önemli anlar veya sahneler var mı?

**Not:** Bu videoda ses analizi yapılamadığı için sadece görsel içerik değerlendirildi.

Detaylı görsel analiz yap. Türkçe cevap ver.`;
    }

    // Analyze with GPT-4 Vision
    const messages = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: analysisPrompt
          },
          ...frameBase64Array.map(frame => ({
            type: "image_url",
            image_url: { url: frame }
          }))
        ]
      }
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      max_tokens: 1200
    });

    const videoAnalysis = response.choices[0].message.content;

    console.log('Generated enhanced video analysis');

    // Store video info and analysis
    const videoId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const videoData = {
      originalName: req.file.originalname,
      videoBase64: req.file.buffer.toString('base64'),
      mimetype: req.file.mimetype,
      size: req.file.size,
      analysis: videoAnalysis,
      audioTranscription: audioTranscription,
      hasValidAudio: hasValidAudio,
      frameCount: frameFiles.length,
      createdAt: new Date().toISOString()
    };

    videoStorage.set(videoId, videoData);

    res.json({
      success: true,
      videoId: videoId,
      analysis: videoAnalysis,
      videoInfo: {
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        frameCount: frameFiles.length,
        hasValidAudio: hasValidAudio,
        audioLength: audioTranscription?.length || 0
      }
    });

  } catch (error) {
    console.error('Error analyzing video:', error);

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Video dosyası çok büyük (maksimum 50MB)' });
    }

    res.status(500).json({
      error: 'Video analizi sırasında hata oluştu: ' + error.message
    });
  } finally {
    // Clean up temporary files
    try {
      if (fs.existsSync(tempVideoPath)) {
        await unlink(tempVideoPath);
      }
      if (fs.existsSync(tempAudioPath)) {
        await unlink(tempAudioPath);
      }
      if (fs.existsSync(tempFramesDir)) {
        const files = fs.readdirSync(tempFramesDir);
        for (const file of files) {
          await unlink(path.join(tempFramesDir, file));
        }
        fs.rmdirSync(tempFramesDir);
      }
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError);
    }
  }
});

// Video serve endpoint
app.get('/video/:videoId', (req, res) => {
  const { videoId } = req.params;
  const videoData = videoStorage.get(videoId);

  if (!videoData) {
    return res.status(404).json({ error: 'Video bulunamadı' });
  }

  try {
    const videoBuffer = Buffer.from(videoData.videoBase64, 'base64');

    res.setHeader('Content-Type', videoData.mimetype);
    res.setHeader('Content-Length', videoBuffer.length);
    res.setHeader('Accept-Ranges', 'bytes');

    res.send(videoBuffer);

  } catch (error) {
    console.error('Error serving video:', error);
    res.status(500).json({ error: 'Video servis edilirken hata oluştu' });
  }
});

// Helper function to extract frames from video
function extractFrames(videoPath, outputDir) {
  return new Promise((resolve, reject) => {
    const frameFiles = [];

    ffmpeg(videoPath)
      .screenshots({
        count: 6, // Extract 6 frames
        folder: outputDir,
        filename: 'frame_%i.jpg',
        size: '640x480'
      })
      .on('end', () => {
        try {
          const files = fs.readdirSync(outputDir);
          const sortedFiles = files
            .filter(file => file.startsWith('frame_') && file.endsWith('.jpg'))
            .sort((a, b) => {
              const numA = parseInt(a.match(/frame_(\d+)\.jpg/)[1]);
              const numB = parseInt(b.match(/frame_(\d+)\.jpg/)[1]);
              return numA - numB;
            });
          resolve(sortedFiles);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}

// Enhanced helper function for audio extraction and transcription
async function extractAndTranscribeAudio(videoPath, audioPath) {
  try {
    console.log('Starting audio extraction...');

    // Extract audio using FFmpeg with WAV format (more compatible)
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .output(audioPath.replace('.mp3', '.wav')) // WAV format kullan
        .audioCodec('pcm_s16le') // PCM codec (her zaman mevcut)
        .audioFrequency(16000) // Whisper prefers 16kHz
        .audioChannels(1) // Mono channel
        .format('wav') // WAV format
        .on('start', (commandLine) => {
          console.log('FFmpeg command:', commandLine);
        })
        .on('end', () => {
          console.log('Audio extraction completed');
          resolve();
        })
        .on('error', (error) => {
          console.error('FFmpeg error:', error);
          reject(error);
        })
        .run();
    });

    // Update audio path to WAV
    const wavAudioPath = audioPath.replace('.mp3', '.wav');

    // Check if audio file exists and has meaningful content
    if (!fs.existsSync(wavAudioPath)) {
      console.log('Audio file not created');
      return 'Video sessiz - ses dosyası oluşturulamadı';
    }

    const audioStats = fs.statSync(wavAudioPath);
    console.log(`Audio file size: ${audioStats.size} bytes`);

    if (audioStats.size < 1000) { // Less than 1KB probably means no/minimal audio
      console.log('Audio file too small, likely no audio content');
      return 'Video sessiz veya çok az ses içeriği var';
    }

    console.log('Starting Whisper transcription...');

    // Read audio file and create FormData for Whisper
    const audioBuffer = fs.readFileSync(wavAudioPath);

    // Create a proper File object for the API
    const audioFile = new File([audioBuffer], 'audio.wav', {
      type: 'audio/wav'
    });

    // Transcribe audio with Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'tr', // Try Turkish first
      response_format: 'text',
      temperature: 0.2
    });

    console.log('Whisper transcription result:', transcription);

    // Handle different response formats
    const transcriptionText = typeof transcription === 'string' ? transcription : transcription.text;

    if (!transcriptionText || transcriptionText.trim().length === 0) {
      console.log('Empty transcription result');
      return 'Video sesli ancak konuşma metni çıkarılamadı (müzik, efekt sesi veya anlaşılmaz konuşma olabilir)';
    }

    if (transcriptionText.trim().length < 10) {
      console.log('Very short transcription:', transcriptionText);
      return `Video sesli ancak çok kısa ses içeriği: "${transcriptionText}"`;
    }

    console.log('Successful transcription, length:', transcriptionText.length);

    // Clean up WAV file
    try {
      await unlink(wavAudioPath);
    } catch (cleanupError) {
      console.error('WAV cleanup error:', cleanupError);
    }

    return transcriptionText;

  } catch (error) {
    console.error('Audio extraction/transcription error:', error);

    // More specific error handling
    if (error.message.includes('ffmpeg')) {
      return 'Video ses çıkarma hatası - FFmpeg problemi';
    } else if (error.message.includes('whisper') || error.message.includes('transcription')) {
      return 'Ses metne çevirme hatası - Whisper API problemi';
    } else {
      return `Ses analizi yapılamadı: ${error.message}`;
    }
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:3000`);
});