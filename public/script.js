class StreamImageGenerator {
    constructor() {
        this.promptInput = document.getElementById('promptInput');
        this.generateBtn = document.getElementById('generateBtn');
        this.statusText = document.getElementById('statusText');
        this.imageContainer = document.getElementById('imageContainer');
        this.finalImage = document.getElementById('finalImage');

        this.partialSlots = {
            1: document.getElementById('partial1'),
            2: document.getElementById('partial2'),
            3: document.getElementById('partial3')
        };

        this.buffer = ''; // Buffer for incomplete data

        this.initEventListeners();
    }

    initEventListeners() {
        this.generateBtn.addEventListener('click', () => this.generateImage());

        this.promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.generateImage();
            }
        });
    }

    async generateImage() {
        const prompt = this.promptInput.value.trim();

        if (!prompt) {
            this.showStatus('Lütfen bir prompt girin');
            return;
        }

        this.startGeneration();

        try {
            const response = await fetch('/generate-image', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prompt })
            });

            if (!response.ok) {
                throw new Error('Sunucu hatası');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            this.buffer = ''; // Reset buffer

            while (true) {
                const { done, value } = await reader.read();

                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                this.buffer += chunk;

                // Process complete lines
                this.processBuffer();
            }

        } catch (error) {
            console.error('Error:', error);
            this.showStatus('Hata: ' + error.message);
            this.resetUI();
        }
    }

    processBuffer() {
        const lines = this.buffer.split('\n');

        // Keep the last potentially incomplete line in buffer
        this.buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.trim().startsWith('data: ')) {
                const jsonStr = line.slice(6).trim();

                if (jsonStr && jsonStr !== '') {
                    try {
                        const data = JSON.parse(jsonStr);
                        this.handleStreamData(data);
                    } catch (e) {
                        console.log('Parse error for line:', jsonStr, e);
                    }
                }
            }
        }
    }

    handleStreamData(data) {
        console.log('Received data:', data.type, data);

        switch (data.type) {
            case 'partial':
                this.showPartialImage(data.index, data.image);
                break;

            case 'completed':
                this.showFinalImage(data.image);
                break;

            case 'done':
                this.finishGeneration();
                break;

            case 'error':
                this.showStatus('Hata: ' + data.message);
                this.resetUI();
                break;
        }
    }

    showPartialImage(index, imageBase64) {
        // Index 0'dan başlıyor, 1'e çevirelim
        const adjustedIndex = index + 1;
        const slot = this.partialSlots[adjustedIndex];

        if (slot && imageBase64) {
            slot.classList.remove('loading');

            // Validate base64 data
            try {
                const img = document.createElement('img');
                img.src = `data:image/png;base64,${imageBase64}`;
                img.alt = `Kısmi görsel ${adjustedIndex}`;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '10px';

                img.onload = () => {
                    slot.innerHTML = '';
                    slot.appendChild(img);
                    this.showStatus(`Aşama ${adjustedIndex} tamamlandı`);
                };

                img.onerror = () => {
                    console.error(`Invalid image data for partial ${adjustedIndex}`);
                    slot.innerHTML = `<div class="progress-indicator">Aşama ${adjustedIndex} - Hata</div>`;
                };

            } catch (e) {
                console.error('Error creating image:', e);
            }
        }
    }

    showFinalImage(imageBase64) {
        if (imageBase64) {
            this.finalImage.classList.remove('loading');

            try {
                const img = document.createElement('img');
                img.src = `data:image/png;base64,${imageBase64}`;
                img.alt = 'Nihai görsel';
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '10px';

                img.onload = () => {
                    this.finalImage.innerHTML = '';
                    this.finalImage.appendChild(img);
                    this.showStatus('Görsel başarıyla oluşturuldu!');
                };

                img.onerror = () => {
                    console.error('Invalid final image data');
                    this.showStatus('Nihai görsel yüklenirken hata oluştu');
                };

            } catch (e) {
                console.error('Error creating final image:', e);
            }
        }
    }

    startGeneration() {
        this.generateBtn.disabled = true;
        this.generateBtn.textContent = 'Oluşturuluyor...';

        this.showStatus('Görsel oluşturma başlatılıyor...');
        this.imageContainer.classList.remove('hidden');

        // Reset partial images
        Object.values(this.partialSlots).forEach((slot, index) => {
            slot.classList.add('loading');
            slot.innerHTML = `<div class="progress-indicator">Aşama ${index + 1}</div>`;
        });

        // Reset final image
        this.finalImage.classList.add('loading');
        this.finalImage.innerHTML = 'Nihai görsel oluşturuluyor...';
    }

    finishGeneration() {
        this.generateBtn.disabled = false;
        this.generateBtn.textContent = 'Görsel Oluştur';
    }

    resetUI() {
        this.generateBtn.disabled = false;
        this.generateBtn.textContent = 'Görsel Oluştur';
        this.imageContainer.classList.add('hidden');
    }

    showStatus(message) {
        this.statusText.textContent = message;
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new StreamImageGenerator();
});