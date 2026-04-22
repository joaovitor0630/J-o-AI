// ── State ──
let currentImageBlob = null;
let currentPrompt = '';
let gallery = JSON.parse(localStorage.getItem('neuravision_gallery') || '[]');
let apiKey = localStorage.getItem('neuravision_apikey') || '';

// ── DOM refs ──
const promptInput = document.getElementById('promptInput');
const negativePrompt = document.getElementById('negativePrompt');
const modelSelect = document.getElementById('modelSelect');
const stepsRange = document.getElementById('stepsRange');
const stepsValue = document.getElementById('stepsValue');
const guidanceRange = document.getElementById('guidanceRange');
const guidanceValue = document.getElementById('guidanceValue');
const generateBtn = document.getElementById('generateBtn');
const resultSection = document.getElementById('resultSection');
const resultImage = document.getElementById('resultImage');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');
const charCount = document.getElementById('charCount');
const galleryGrid = document.getElementById('galleryGrid');
const galleryEmpty = document.getElementById('galleryEmpty');
const galleryCount = document.getElementById('galleryCount');
const settingsModal = document.getElementById('settingsModal');
const apiKeyInput = document.getElementById('apiKeyInput');
const lightboxModal = document.getElementById('lightboxModal');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxInfo = document.getElementById('lightboxInfo');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    createParticles();
    setupEventListeners();
    renderGallery();
    if (apiKey) apiKeyInput.value = apiKey;
});

// ── Particles ──
function createParticles() {
    const container = document.getElementById('bgParticles');
    const colors = ['#a855f7', '#06b6d4', '#ec4899', '#8b5cf6', '#22d3ee'];
    for (let i = 0; i < 20; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const size = Math.random() * 200 + 50;
        p.style.cssText = `
            width:${size}px;height:${size}px;
            left:${Math.random()*100}%;top:${Math.random()*100}%;
            background:${colors[i % colors.length]};
            animation-delay:${Math.random()*-20}s;
            animation-duration:${15 + Math.random()*15}s;
            filter:blur(${40 + Math.random()*40}px);
        `;
        container.appendChild(p);
    }
}

// ── Event listeners ──
function setupEventListeners() {
    promptInput.addEventListener('input', () => {
        charCount.textContent = promptInput.value.length;
    });
    stepsRange.addEventListener('input', () => { stepsValue.textContent = stepsRange.value; });
    guidanceRange.addEventListener('input', () => { guidanceValue.textContent = guidanceRange.value; });

    // Tab navigation
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.getElementById(btn.dataset.tab + 'Tab').classList.add('active');
        });
    });

    // Keyboard shortcut
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generateImage();
        if (e.key === 'Escape') { closeSettings(); closeLightbox(); }
    });
}

// ── Random prompts ──
const inspirations = [
    "A majestic dragon perched on a crystal mountain at sunset, digital art, 8k, cinematic lighting",
    "Cyberpunk cityscape at night with neon reflections in rain-soaked streets, ultra detailed",
    "An enchanted forest with bioluminescent plants and floating lanterns, fantasy art, dreamy atmosphere",
    "A cozy Japanese café interior during autumn, warm lighting, studio ghibli style, watercolor",
    "Astronaut floating above Earth with galaxies reflecting in the visor, hyperrealistic, NASA photography",
    "Steampunk clockwork owl made of brass and copper gears, macro photography, bokeh background",
    "Underwater temple ruins overgrown with coral, rays of sunlight filtering through water, concept art",
    "A futuristic space station orbiting a ringed planet, sci-fi illustration, volumetric lighting",
    "Portrait of a warrior queen wearing ornate golden armor, oil painting style, dramatic lighting",
    "Miniature fairy village inside a hollow tree trunk, tilt-shift photography, magical atmosphere"
];

function fillRandomPrompt() {
    const idx = Math.floor(Math.random() * inspirations.length);
    promptInput.value = inspirations[idx];
    charCount.textContent = promptInput.value.length;
    promptInput.focus();
    showToast('✨ Prompt filled! Feel free to customize it.');
}

// ── Generate (with auto-retry for cold models) ──
async function generateImage() {
    const prompt = promptInput.value.trim();
    if (!prompt) { showToast('⚠️ Digite um prompt primeiro.'); promptInput.focus(); return; }
    if (!apiKey) { showToast('🔑 Configure sua API key nas Configurações.'); openSettings(); return; }

    // UI state
    generateBtn.disabled = true;
    generateBtn.querySelector('.btn-content').style.display = 'none';
    generateBtn.querySelector('.btn-loading').style.display = 'flex';
    errorSection.style.display = 'none';
    resultSection.style.display = 'none';

    const model = modelSelect.value;
    const negative = negativePrompt.value.trim();
    const startTime = Date.now();
    const maxRetries = 3;

    try {
        // Simple body - just the prompt input
        const body = { inputs: prompt };
        if (negative) {
            body.parameters = { negative_prompt: negative };
        }

        let response;
        let lastError = '';

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const loadingSpan = generateBtn.querySelector('.btn-loading span');

            try {
                console.log(`[NeuraVision] Attempt ${attempt}/${maxRetries} — Model: ${model}`);

                // Send through local proxy to avoid CORS
                response = await fetch('/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: model,
                        api_key: apiKey,
                        inputs: prompt,
                        parameters: negative ? { negative_prompt: negative } : undefined
                    })
                });
            } catch (networkError) {
                console.error('[NeuraVision] Network error:', networkError);
                // This catches "Failed to fetch" - a network-level error
                if (attempt < maxRetries) {
                    loadingSpan.textContent = `Erro de rede. Tentativa ${attempt + 1}/${maxRetries}...`;
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }
                throw new Error(
                    'Erro de conexão (Failed to fetch). Possíveis causas:\n' +
                    '• Sem conexão com a internet\n' +
                    '• Antivírus ou firewall bloqueando\n' +
                    '• VPN interferindo na conexão\n' +
                    'Tente desativar antivírus/VPN temporariamente.'
                );
            }

            if (response.ok) break;

            // Try to parse the error
            let errData = {};
            try {
                const text = await response.text();
                errData = JSON.parse(text);
                console.log('[NeuraVision] API error response:', errData);
            } catch(e) { /* ignore parse errors */ }

            // Model is loading — wait and retry
            if (response.status === 503) {
                const waitTime = errData.estimated_time ? Math.min(Math.ceil(errData.estimated_time), 60) : 20;
                if (attempt < maxRetries) {
                    loadingSpan.textContent = `Modelo carregando... Tentativa ${attempt}/${maxRetries} (aguardando ${waitTime}s)`;
                    showToast(`⏳ Modelo carregando, aguardando ${waitTime}s...`);
                    await new Promise(r => setTimeout(r, waitTime * 1000));
                    continue;
                }
                lastError = `O modelo está carregando. Tempo estimado: ${waitTime}s. Tente novamente em alguns segundos.`;
            } else if (response.status === 401) {
                lastError = 'API key inválida. Verifique sua chave nas Configurações. A chave deve começar com "hf_".';
            } else if (response.status === 403) {
                lastError = 'Acesso negado. Sua API key pode não ter permissão para este modelo. Tente outro modelo.';
            } else if (response.status === 429) {
                lastError = 'Limite de requisições atingido. Aguarde um momento e tente novamente.';
            } else if (response.status === 422) {
                lastError = errData.error || 'Parâmetros inválidos. Tente com valores padrão.';
            } else {
                lastError = errData.error || `Erro da API (${response.status}): ${response.statusText}`;
            }

            if (attempt === maxRetries) throw new Error(lastError);
        }

        const blob = await response.blob();
        console.log(`[NeuraVision] Response blob: type=${blob.type}, size=${blob.size}`);

        // Check if the response is actually an image
        if (blob.size < 200 || (blob.type && !blob.type.startsWith('image/'))) {
            const text = await blob.text();
            console.log('[NeuraVision] Non-image response:', text);
            try {
                const parsed = JSON.parse(text);
                throw new Error(parsed.error || 'A API não retornou uma imagem. Tente outro modelo.');
            } catch(e) {
                if (e instanceof SyntaxError) {
                    throw new Error('Resposta inesperada da API. Tente outro modelo.');
                }
                throw e;
            }
        }

        currentImageBlob = blob;
        currentPrompt = prompt;
        const url = URL.createObjectURL(blob);
        resultImage.src = url;

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        document.getElementById('resultModel').textContent = `Modelo: ${modelSelect.options[modelSelect.selectedIndex].text}`;
        document.getElementById('resultTime').textContent = `Gerado em ${elapsed}s`;

        resultSection.style.display = 'block';
        resultSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showToast('🎨 Imagem gerada com sucesso!');
    } catch (err) {
        errorMessage.textContent = err.message;
        errorSection.style.display = 'block';
        console.error('[NeuraVision] Generation error:', err);
    } finally {
        generateBtn.disabled = false;
        generateBtn.querySelector('.btn-content').style.display = 'flex';
        generateBtn.querySelector('.btn-loading').style.display = 'none';
        generateBtn.querySelector('.btn-loading span').textContent = 'Criando sua obra-prima...';
    }
}

// ── Download ──
function downloadImage() {
    if (!currentImageBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(currentImageBlob);
    a.download = `neuravision_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('📥 Image downloaded!');
}

// ── Gallery ──
function saveToGallery() {
    if (!currentImageBlob) return;
    const reader = new FileReader();
    reader.onload = () => {
        gallery.unshift({
            id: Date.now(),
            image: reader.result,
            prompt: currentPrompt,
            model: modelSelect.options[modelSelect.selectedIndex].text,
            date: new Date().toLocaleDateString()
        });
        localStorage.setItem('neuravision_gallery', JSON.stringify(gallery));
        renderGallery();
        showToast('💾 Saved to gallery!');
    };
    reader.readAsDataURL(currentImageBlob);
}

function renderGallery() {
    const items = galleryGrid.querySelectorAll('.gallery-item');
    items.forEach(i => i.remove());
    galleryEmpty.style.display = gallery.length === 0 ? 'block' : 'none';
    galleryCount.textContent = `${gallery.length} image${gallery.length !== 1 ? 's' : ''}`;

    gallery.forEach(item => {
        const div = document.createElement('div');
        div.className = 'gallery-item';
        div.innerHTML = `
            <img src="${item.image}" alt="${item.prompt.substring(0,50)}" loading="lazy">
            <div class="gallery-item-overlay">
                <div class="gallery-item-prompt">${item.prompt}</div>
            </div>
            <button class="gallery-item-delete" onclick="event.stopPropagation();deleteGalleryItem(${item.id})">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;
        div.addEventListener('click', () => openLightbox(item));
        galleryGrid.appendChild(div);
    });
}

function deleteGalleryItem(id) {
    gallery = gallery.filter(i => i.id !== id);
    localStorage.setItem('neuravision_gallery', JSON.stringify(gallery));
    renderGallery();
    showToast('🗑️ Image removed.');
}

function clearGallery() {
    if (!confirm('Delete all saved images?')) return;
    gallery = [];
    localStorage.setItem('neuravision_gallery', JSON.stringify(gallery));
    renderGallery();
    showToast('🗑️ Gallery cleared.');
}

// ── Lightbox ──
function openLightbox(item) {
    lightboxImage.src = item.image;
    lightboxInfo.textContent = item.prompt;
    lightboxModal.classList.add('active');
}
function closeLightbox() { lightboxModal.classList.remove('active'); }

// ── Settings ──
function openSettings() { settingsModal.classList.add('active'); }
function closeSettings() { settingsModal.classList.remove('active'); }
function saveSettings() {
    apiKey = apiKeyInput.value.trim();
    localStorage.setItem('neuravision_apikey', apiKey);
    closeSettings();
    showToast('✅ API key saved!');
}
function toggleApiKeyVisibility() {
    const input = apiKeyInput;
    input.type = input.type === 'password' ? 'text' : 'password';
}

// ── Copy prompt ──
function copyPromptFromResult() {
    navigator.clipboard.writeText(currentPrompt).then(() => showToast('📋 Prompt copied!'));
}

// ── Toast ──
function showToast(msg) {
    toastMessage.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('visible'), 3000);
}
