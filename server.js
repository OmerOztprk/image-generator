import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
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
          image: event.partial_image_b64
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
        
        // Son partial image'ı nihai görsel olarak kullan
        const data = {
          type: 'completed',
          image: lastPartialImage
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

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:3000`);
});