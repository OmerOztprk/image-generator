class StreamImageGenerator {
    constructor() {
        // Existing elements
        this.promptInput = document.getElementById('promptInput');
        this.generateBtn = document.getElementById('generateBtn');
        this.statusText = document.getElementById('statusText');
        this.imageContainer = document.getElementById('imageContainer');
        this.imageContent = document.getElementById('imageContent');
        this.progressText = document.getElementById('progressText');
        this.progressFill = document.getElementById('progressFill');
        this.downloadSection = document.getElementById('downloadSection');
        this.downloadBtn = document.getElementById('downloadBtn');

        // New elements for analysis
        this.tabBtns = document.querySelectorAll('.tab-btn');
        this.tabContents = document.querySelectorAll('.tab-content');
        this.dropZone = document.getElementById('dropZone');
        this.fileInput = document.getElementById('fileInput');
        this.analyzeBtn = document.getElementById('analyzeBtn');
        this.analysisStatus = document.getElementById('analysisStatus');
        this.analysisResult = document.getElementById('analysisResult');
        this.previewImage = document.getElementById('previewImage');
        this.generatedPrompt = document.getElementById('generatedPrompt');
        this.copyPromptBtn = document.getElementById('copyPromptBtn');
        this.usePromptBtn = document.getElementById('usePromptBtn');

        this.buffer = '';
        this.currentStage = 0;
        this.totalStages = 4;
        this.currentSessionId = null;
        this.currentPrompt = '';
        this.selectedFile = null;

        this.initEventListeners();
    }

    initEventListeners() {
        // Existing listeners
        this.generateBtn.addEventListener('click', () => this.generateImage());
        this.downloadBtn.addEventListener('click', () => this.downloadImage());

        this.promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.generateImage();
            }
        });

        // Tab switching
        this.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        // File upload
        this.dropZone.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e.target.files[0]));

        // Drag and drop
        this.dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.dropZone.addEventListener('drop', (e) => this.handleDrop(e));

        // Analysis
        this.analyzeBtn.addEventListener('click', () => this.analyzeImage());
        this.copyPromptBtn.addEventListener('click', () => this.copyPrompt());
        this.usePromptBtn.addEventListener('click', () => this.useGeneratedPrompt());
    }

    switchTab(tabName) {
        // Update tab buttons
        this.tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // Update tab contents
        this.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}Tab`);
        });
    }

    handleDragOver(e) {
        e.preventDefault();
        this.dropZone.classList.add('drag-over');
    }

    handleDragLeave(e) {
        e.preventDefault();
        this.dropZone.classList.remove('drag-over');
    }

    handleDrop(e) {
        e.preventDefault();
        this.dropZone.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.handleFileSelect(files[0]);
        }
    }

    handleFileSelect(file) {
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            this.showAnalysisStatus('Lütfen geçerli bir görsel dosyası seçin');
            return;
        }

        // Validate file size (10MB)
        if (file.size > 10 * 1024 * 1024) {
            this.showAnalysisStatus('Dosya boyutu çok büyük (maksimum 10MB)');
            return;
        }

        this.selectedFile = file;
        this.updateDropZone();
        this.showPreview();
        this.analyzeBtn.disabled = false;
    }

    updateDropZone() {
        if (this.selectedFile) {
            this.dropZone.classList.add('has-file');
            this.dropZone.querySelector('.upload-text').textContent = this.selectedFile.name;
            this.dropZone.querySelector('.upload-subtext').textContent = `${(this.selectedFile.size / 1024 / 1024).toFixed(2)} MB`;
        }
    }

    showPreview() {
        const reader = new FileReader();
        reader.onload = (e) => {
            this.previewImage.src = e.target.result;
        };
        reader.readAsDataURL(this.selectedFile);
    }

    async analyzeImage() {
        if (!this.selectedFile) {
            this.showAnalysisStatus('Lütfen bir görsel seçin');
            return;
        }

        this.analyzeBtn.disabled = true;
        this.analyzeBtn.textContent = 'Analiz ediliyor...';
        this.showAnalysisStatus('Görsel analiz ediliyor, lütfen bekleyin...');

        try {
            const formData = new FormData();
            formData.append('image', this.selectedFile);

            const response = await fetch('/analyze-image', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                this.generatedPrompt.value = result.prompt;
                this.analysisResult.classList.remove('hidden');
                this.showAnalysisStatus('Analiz tamamlandı!');
            } else {
                this.showAnalysisStatus('Hata: ' + result.error);
            }

        } catch (error) {
            console.error('Analysis error:', error);
            this.showAnalysisStatus('Analiz sırasında hata oluştu: ' + error.message);
        } finally {
            this.analyzeBtn.disabled = false;
            this.analyzeBtn.textContent = 'Görseli Analiz Et';
        }
    }

    copyPrompt() {
        navigator.clipboard.writeText(this.generatedPrompt.value).then(() => {
            this.copyPromptBtn.textContent = '✅ Kopyalandı';
            setTimeout(() => {
                this.copyPromptBtn.textContent = '📋 Kopyala';
            }, 2000);
        }).catch(err => {
            console.error('Copy failed:', err);
        });
    }

    useGeneratedPrompt() {
        // Switch to generate tab
        this.switchTab('generate');
        
        // Set the prompt
        this.promptInput.value = this.generatedPrompt.value;
        this.promptInput.focus();
        
        this.showStatus('Prompt aktarıldı! Şimdi "Görsel Oluştur" butonuna tıklayın.');
    }

    showAnalysisStatus(message) {
        this.analysisStatus.textContent = message;
    }

    async generateImage() {
        const prompt = this.promptInput.value.trim();

        if (!prompt) {
            this.showStatus('Lütfen bir prompt girin');
            return;
        }

        this.currentPrompt = prompt;
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
            this.buffer = '';

            while (true) {
                const { done, value } = await reader.read();

                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                this.buffer += chunk;

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
                if (data.sessionId) {
                    this.currentSessionId = data.sessionId;
                }
                break;

            case 'completed':
                this.showFinalImage(data.image);
                if (data.sessionId) {
                    this.currentSessionId = data.sessionId;
                }
                this.showDownloadButton();
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

    showDownloadButton() {
        if (this.currentSessionId) {
            this.downloadSection.classList.remove('hidden');
        }
    }

    hideDownloadButton() {
        this.downloadSection.classList.add('hidden');
    }

    downloadImage() {
        if (!this.currentSessionId) {
            this.showStatus('İndirme hatası: Session ID bulunamadı');
            return;
        }

        try {
            const downloadUrl = `/download/${this.currentSessionId}`;
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = `ai_generated_${this.currentSessionId}.png`;
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            this.showStatus('Görsel indiriliyor...');
            
            setTimeout(() => {
                this.showStatus('Görsel başarıyla indirildi!');
            }, 1000);

        } catch (error) {
            console.error('Download error:', error);
            this.showStatus('İndirme hatası: ' + error.message);
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
        this.currentSessionId = null;

        this.showStatus('Görsel oluşturma başlatılıyor...');
        this.imageContainer.classList.remove('hidden');
        this.hideDownloadButton();

        this.imageContent.classList.add('loading');
        this.imageContent.innerHTML = 'Görsel oluşturuluyor...';

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
        this.hideDownloadButton();
        this.currentStage = 0;
        this.currentSessionId = null;
    }

    showStatus(message) {
        this.statusText.textContent = message;
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new StreamImageGenerator();
});