class StreamImageGenerator {
    constructor() {
        this.promptInput = document.getElementById('promptInput');
        this.generateBtn = document.getElementById('generateBtn');
        this.statusText = document.getElementById('statusText');
        this.imageContainer = document.getElementById('imageContainer');
        this.imageContent = document.getElementById('imageContent');
        this.progressText = document.getElementById('progressText');
        this.progressFill = document.getElementById('progressFill');

        this.buffer = ''; // Buffer for incomplete data
        this.currentStage = 0;
        this.totalStages = 4; // 0, 1, 2, 3 (4 aşama)

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
                this.updatePartialImage(data.index, data.image);
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

    updatePartialImage(index, imageBase64) {
        this.currentStage = index + 1;
        this.updateProgress();

        if (imageBase64) {
            try {
                const img = document.createElement('img');
                img.src = `data:image/png;base64,${imageBase64}`;
                img.alt = `Aşama ${this.currentStage}`;
                img.className = 'image-fade-in';

                img.onload = () => {
                    this.imageContent.innerHTML = '';
                    this.imageContent.appendChild(img);
                    this.showStatus(`Aşama ${this.currentStage}/${this.totalStages} tamamlandı`);
                };

                img.onerror = () => {
                    console.error(`Invalid image data for stage ${this.currentStage}`);
                };

            } catch (e) {
                console.error('Error creating image:', e);
            }
        }
    }

    showFinalImage(imageBase64) {
        this.currentStage = this.totalStages;
        this.updateProgress();

        if (imageBase64) {
            this.imageContent.classList.remove('loading');

            try {
                const img = document.createElement('img');
                img.src = `data:image/png;base64,${imageBase64}`;
                img.alt = 'Nihai görsel';
                img.className = 'image-fade-in';

                img.onload = () => {
                    this.imageContent.innerHTML = '';
                    this.imageContent.appendChild(img);
                    this.showStatus('Görsel başarıyla oluşturuldu!');
                    this.progressText.textContent = 'Tamamlandı!';
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

    updateProgress() {
        const percentage = (this.currentStage / this.totalStages) * 100;
        this.progressFill.style.width = `${percentage}%`;
        this.progressText.textContent = `Aşama ${this.currentStage}/${this.totalStages}`;
    }

    startGeneration() {
        this.generateBtn.disabled = true;
        this.generateBtn.textContent = 'Oluşturuluyor...';
        this.currentStage = 0;

        this.showStatus('Görsel oluşturma başlatılıyor...');
        this.imageContainer.classList.remove('hidden');

        // Reset image display
        this.imageContent.classList.add('loading');
        this.imageContent.innerHTML = 'Görsel oluşturuluyor...';

        // Reset progress
        this.progressFill.style.width = '0%';
        this.progressText.textContent = 'Başlatılıyor...';
    }

    finishGeneration() {
        this.generateBtn.disabled = false;
        this.generateBtn.textContent = 'Görsel Oluştur';
        this.imageContent.classList.remove('loading');
    }

    resetUI() {
        this.generateBtn.disabled = false;
        this.generateBtn.textContent = 'Görsel Oluştur';
        this.imageContainer.classList.add('hidden');
        this.currentStage = 0;
    }

    showStatus(message) {
        this.statusText.textContent = message;
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new StreamImageGenerator();
});