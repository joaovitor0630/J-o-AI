// ── State ──
let currentImages = [];
let currentPrompt = '';
let currentSeed = -1;
let gallery = JSON.parse(localStorage.getItem('nv_gallery') || '[]');
let promptHistory = JSON.parse(localStorage.getItem('nv_history') || '[]');
let apiKey = localStorage.getItem('nv_apikey') || '';
let serverMode = localStorage.getItem('nv_servermode') || 'local';
let colabUrl = localStorage.getItem('nv_colaburl') || '';
let refImageBase64 = null;
let selectedAspect = { w: 1024, h: 1024 };
let selectedQuality = 'high';

// ── DOM ──
const $ = id => document.getElementById(id);
const promptInput = $('promptInput');
const negativePrompt = $('negativePrompt');
const modelSelect = $('modelSelect');
const stepsRange = $('stepsRange');
const guidanceRange = $('guidanceRange');
const countRange = $('countRange');
const seedInput = $('seedInput');
const strengthRange = $('strengthRange');
const generateBtn = $('generateBtn');
const resultSection = $('resultSection');
const resultsGrid = $('resultsGrid');
const errorSection = $('errorSection');
const errorMessage = $('errorMessage');
const charCount = $('charCount');
const galleryGrid = $('galleryGrid');
const galleryEmpty = $('galleryEmpty');
const galleryCount = $('galleryCount');
const settingsModal = $('settingsModal');
const apiKeyInput = $('apiKeyInput');
const lightboxModal = $('lightboxModal');
const lightboxImage = $('lightboxImage');
const lightboxInfo = $('lightboxInfo');
const toast = $('toast');
const toastMessage = $('toastMessage');
const progressContainer = $('progressContainer');
const progressFill = $('progressFill');
const progressStatus = $('progressStatus');
const progressTime = $('progressTime');
const historyDropdown = $('historyDropdown');
const historyList = $('historyList');

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    createParticles();
    setupListeners();
    renderGallery();
    if (apiKey) apiKeyInput.value = apiKey;
    if (colabUrl) $('colabUrlInput').value = colabUrl;
    setServerMode(serverMode);
});

// ── Particles ──
function createParticles() {
    const c = $('bgParticles');
    const colors = ['#a855f7', '#06b6d4', '#ec4899', '#8b5cf6', '#22d3ee'];
    for (let i = 0; i < 15; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        const s = Math.random() * 180 + 60;
        p.style.cssText = `width:${s}px;height:${s}px;left:${Math.random() * 100}%;top:${Math.random() * 100}%;background:${colors[i % 5]};animation-delay:${Math.random() * -20}s;animation-duration:${15 + Math.random() * 15}s;filter:blur(${40 + Math.random() * 40}px);`;
        c.appendChild(p);
    }
}

// ── Listeners ──
function setupListeners() {
    promptInput.addEventListener('input', () => charCount.textContent = promptInput.value.length);
    stepsRange.addEventListener('input', () => $('stepsValue').textContent = stepsRange.value);
    guidanceRange.addEventListener('input', () => $('guidanceValue').textContent = guidanceRange.value);
    countRange.addEventListener('input', () => $('countValue').textContent = countRange.value);
    if (strengthRange) strengthRange.addEventListener('input', () => $('strengthValue').textContent = strengthRange.value);

    // Tabs
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            $(btn.dataset.tab + 'Tab').classList.add('active');
        });
    });

    // Style presets
    document.querySelectorAll('.preset-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            chip.classList.toggle('active');
            updatePromptWithStyles();
        });
    });

    // Aspect ratio buttons
    document.querySelectorAll('.aspect-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.aspect-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedAspect = { w: parseInt(btn.dataset.w), h: parseInt(btn.dataset.h) };
        });
    });

    // Image upload
    const uploadArea = $('uploadArea');
    const refInput = $('refImageInput');
    uploadArea.addEventListener('click', () => refInput.click());
    uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.style.borderColor = '#a855f7'; });
    uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = ''; });
    uploadArea.addEventListener('drop', e => { e.preventDefault(); uploadArea.style.borderColor = ''; if (e.dataTransfer.files[0]) handleRefImage(e.dataTransfer.files[0]); });
    refInput.addEventListener('change', () => { if (refInput.files[0]) handleRefImage(refInput.files[0]); });

    // Keyboard
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generateImage();
        if (e.key === 'Escape') { closeSettings(); closeLightbox(); historyDropdown.classList.remove('active'); }
    });
}

function updatePromptWithStyles() {
    const base = promptInput.value.replace(/, (photorealistic|anime style|oil painting|cyberpunk|watercolor|cinematic|pixel art|3d render|fantasy art|minimalist)[^,]*/gi, '').trim();
    let styles = '';
    document.querySelectorAll('.preset-chip.active').forEach(c => { styles += c.dataset.style; });
    promptInput.value = base + styles;
    charCount.textContent = promptInput.value.length;
}

// ── Ref Image ──
function handleRefImage(file) {
    if (file.size > 5 * 1024 * 1024) { showToast('Imagem muito grande (max 5MB)'); return; }
    const reader = new FileReader();
    reader.onload = () => {
        refImageBase64 = reader.result;
        $('refPreviewImg').src = refImageBase64;
        $('uploadArea').style.display = 'none';
        $('uploadPreview').style.display = 'inline-block';
        $('strengthControl').style.display = 'block';
    };
    reader.readAsDataURL(file);
}

function removeRefImage() {
    refImageBase64 = null;
    $('uploadArea').style.display = '';
    $('uploadPreview').style.display = 'none';
    $('strengthControl').style.display = 'none';
    $('refImageInput').value = '';
}

// ── Prompts ──
const inspirations = [
    "A majestic dragon perched atop a crystal mountain at golden hour, digital painting, cinematic lighting, epic composition, 8k uhd, by Greg Rutkowski",
    "Cyberpunk city at night with neon reflections on wet rain-soaked streets, volumetric fog, ultra detailed, blade runner style, moody atmosphere",
    "Enchanted forest with bioluminescent plants and floating paper lanterns, fantasy art, magical atmosphere, ethereal glow, concept art",
    "Cozy Japanese cafe in autumn, warm interior lighting, studio ghibli style, delicate watercolor painting, soft pastel colors, peaceful",
    "Astronaut floating above Earth with galaxies reflecting in the helmet visor, photorealistic, NASA photography style, deep space, ultra detailed",
    "Steampunk owl made of brass and copper gears, macro photography, shallow depth of field, beautiful bokeh, intricate mechanical details",
    "Ancient underwater temple ruins covered in colorful coral, sunbeams filtering through crystal clear water, photorealistic, National Geographic style",
    "Futuristic space station orbiting a ringed planet, sci-fi concept art, volumetric lighting, epic scale, detailed illustration, matte painting",
    "Portrait of a warrior queen in ornate golden armor, oil painting on canvas, renaissance style, dramatic chiaroscuro lighting, museum quality",
    "Miniature fairy village inside a hollow tree trunk, tilt-shift photography effect, magical details, warm sunlight, whimsical, highly detailed"
];

function fillRandomPrompt() {
    promptInput.value = inspirations[Math.floor(Math.random() * inspirations.length)];
    charCount.textContent = promptInput.value.length;
    promptInput.focus();
    showToast('Prompt preenchido! Personalize como quiser.');
}

// ── Enhance Prompt ──
async function enhancePrompt() {
    const prompt = promptInput.value.trim();
    if (!prompt) { showToast('Digite uma ideia inicial primeiro.'); promptInput.focus(); return; }

    if (serverMode === 'local' && !apiKey) { showToast('Configure sua API key nas Config.'); openSettings(); return; }
    if (serverMode === 'colab' && !colabUrl) { showToast('Configure a URL do Colab nas Config.'); openSettings(); return; }

    const enhanceBtn = $('enhanceBtn');
    const originalText = enhanceBtn.innerHTML;
    enhanceBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;border-top-color:#facc15;border-color:rgba(250,204,21,0.3);"></div> Pensando...';
    enhanceBtn.disabled = true;

    try {
        const apiUrl = serverMode === 'colab' ? colabUrl + '/api/enhance-prompt' : '/api/enhance-prompt';
        const headers = { 'Content-Type': 'application/json' };
        if (serverMode === 'colab') headers['ngrok-skip-browser-warning'] = 'true';

        const body = { prompt };
        if (serverMode === 'local') body.api_key = apiKey;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            let errData = {};
            try { errData = await response.json(); } catch (e) { }
            throw new Error(errData.error || `Erro da API (${response.status})`);
        }

        const data = await response.json();
        if (data.enhanced_prompt) {
            promptInput.value = data.enhanced_prompt;
            charCount.textContent = promptInput.value.length;
            showToast('✨ Prompt aprimorado com IA!');

            promptInput.style.transition = 'box-shadow 0.3s, background-color 0.3s';
            promptInput.style.boxShadow = '0 0 15px rgba(250, 204, 21, 0.4)';
            promptInput.style.backgroundColor = 'rgba(250, 204, 21, 0.05)';
            setTimeout(() => {
                promptInput.style.boxShadow = '';
                promptInput.style.backgroundColor = 'rgba(0,0,0,0.3)';
            }, 800);
        } else {
            throw new Error("Resposta inválida do servidor.");
        }
    } catch (err) {
        showToast('Erro ao melhorar prompt: ' + err.message);
    } finally {
        enhanceBtn.innerHTML = originalText;
        enhanceBtn.disabled = false;
    }
}

// ── Seed ──
function randomizeSeed() {
    seedInput.value = Math.floor(Math.random() * 2147483647);
}

// ── Quality ──
function setQuality(q) {
    selectedQuality = q;
    document.querySelectorAll('.quality-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.quality === q);
    });
}

// ── History ──
function addToHistory(prompt) {
    promptHistory = promptHistory.filter(p => p !== prompt);
    promptHistory.unshift(prompt);
    if (promptHistory.length > 20) promptHistory = promptHistory.slice(0, 20);
    localStorage.setItem('nv_history', JSON.stringify(promptHistory));
}

function toggleHistory() {
    if (promptHistory.length === 0) {
        historyList.innerHTML = '<div class="history-empty">Nenhum historico ainda</div>';
    } else {
        historyList.innerHTML = promptHistory.map(p =>
            `<div class="history-item" onclick="useHistoryPrompt(this)">${p}</div>`
        ).join('');
    }
    historyDropdown.classList.toggle('active');
}

function useHistoryPrompt(el) {
    promptInput.value = el.textContent;
    charCount.textContent = promptInput.value.length;
    historyDropdown.classList.remove('active');
}

// ── Generate ──
let progressInterval = null;

async function generateImage() {
    const prompt = promptInput.value.trim();
    if (!prompt) { showToast('Digite um prompt primeiro.'); promptInput.focus(); return; }
    if (serverMode === 'local' && !apiKey) { showToast('Configure sua API key nas Config.'); openSettings(); return; }
    if (serverMode === 'colab' && !colabUrl) { showToast('Configure a URL do Colab nas Config.'); openSettings(); return; }

    const count = parseInt(countRange.value);
    const model = modelSelect.value;
    const negative = negativePrompt.value.trim();
    const seed = seedInput.value ? parseInt(seedInput.value) : -1;

    // UI loading state
    generateBtn.disabled = true;
    $('btnContent').style.display = 'none';
    $('btnLoading').style.display = 'flex';
    errorSection.style.display = 'none';
    resultSection.style.display = 'none';

    // Progress bar
    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    const startTime = Date.now();
    let progress = 0;
    progressInterval = setInterval(() => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        progressTime.textContent = `${elapsed}s`;
        if (progress < 90) { progress += (90 - progress) * 0.02; progressFill.style.width = progress + '%'; }
    }, 200);

    addToHistory(prompt);
    currentImages = [];
    currentPrompt = prompt;

    try {
        const results = [];
        for (let i = 0; i < count; i++) {
            if (count > 1) {
                $('loadingText').textContent = `Gerando imagem ${i + 1} de ${count}...`;
                progressStatus.textContent = `Imagem ${i + 1}/${count}`;
            }

            const useSeed = seed >= 0 ? seed + i : -1;
            const body = {
                model, inputs: prompt,
                width: selectedAspect.w, height: selectedAspect.h,
                steps: parseInt(stepsRange.value),
                guidance_scale: parseFloat(guidanceRange.value),
                quality: selectedQuality,
                parameters: {}
            };
            // Local mode needs API key
            if (serverMode === 'local') body.api_key = apiKey;
            if (negative) body.parameters.negative_prompt = negative;
            if (useSeed >= 0) body.parameters.seed = useSeed;
            if (refImageBase64) {
                body.ref_image = refImageBase64;
                body.strength = parseFloat(strengthRange.value);
            }

            // Choose endpoint based on server mode
            const apiUrl = serverMode === 'colab' ? colabUrl + '/api/generate' : '/api/generate';

            const headers = { 'Content-Type': 'application/json' };
            if (serverMode === 'colab') headers['ngrok-skip-browser-warning'] = 'true';

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                let errData = {};
                try { errData = await response.json(); } catch (e) { }
                throw new Error(errData.error || `Erro da API (${response.status})`);
            }

            const blob = await response.blob();
            if (blob.size < 200) {
                const text = await blob.text();
                try { const p = JSON.parse(text); throw new Error(p.error || 'Resposta inesperada.'); }
                catch (e) { if (e instanceof SyntaxError) throw new Error('A API nao retornou uma imagem.'); throw e; }
            }

            results.push({ blob, url: URL.createObjectURL(blob), seed: useSeed });
        }

        currentImages = results;
        currentSeed = seed >= 0 ? seed : -1;

        // Show results
        progressFill.style.width = '100%';
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const cols = results.length;
        resultsGrid.className = `results-grid cols-${cols}`;
        resultsGrid.innerHTML = results.map((r, i) => `
            <div class="result-card">
                <img src="${r.url}" alt="Imagem gerada ${i + 1}" onclick="openLightboxUrl('${r.url}','${prompt.replace(/'/g, "\\'")}')" />
                <div class="result-card-actions">
                    <button onclick="downloadBlob(${i})">Baixar</button>
                    <button onclick="saveOneToGallery(${i})">Salvar</button>
                    <button onclick="copyText('${prompt.replace(/'/g, "\\'")}')">Copiar Prompt</button>
                </div>
            </div>
        `).join('');

        $('resultModel').textContent = `Modelo: ${modelSelect.options[modelSelect.selectedIndex].text}`;
        $('resultTime').textContent = `Gerado em ${elapsed}s`;
        $('resultSeed').textContent = seed >= 0 ? `Seed: ${seed}` : '';
        resultSection.style.display = 'block';
        resultSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showToast(`Imagem${count > 1 ? 'ns' : ''} gerada${count > 1 ? 's' : ''} com sucesso!`);

    } catch (err) {
        errorMessage.textContent = err.message;
        errorSection.style.display = 'block';
        console.error('[NeuraVision]', err);
    } finally {
        clearInterval(progressInterval);
        setTimeout(() => { progressContainer.style.display = 'none'; }, 1000);
        generateBtn.disabled = false;
        $('btnContent').style.display = 'flex';
        $('btnLoading').style.display = 'none';
        $('loadingText').textContent = 'Criando sua obra-prima...';
    }
}

// ── Download / Save ──
function downloadBlob(index) {
    const img = currentImages[index];
    if (!img) return;
    const a = document.createElement('a');
    a.href = img.url;
    a.download = `neuravision_${Date.now()}.png`;
    a.click();
    showToast('Imagem baixada!');
}

function saveOneToGallery(index) {
    const img = currentImages[index];
    if (!img) return;
    const reader = new FileReader();
    reader.onload = () => {
        gallery.unshift({ id: Date.now() + index, image: reader.result, prompt: currentPrompt, model: modelSelect.options[modelSelect.selectedIndex].text, date: new Date().toLocaleDateString() });
        localStorage.setItem('nv_gallery', JSON.stringify(gallery));
        renderGallery();
        showToast('Salva na galeria!');
    };
    reader.readAsDataURL(img.blob);
}

function copyText(text) {
    navigator.clipboard.writeText(text).then(() => showToast('Prompt copiado!'));
}

// ── Gallery ──
function renderGallery() {
    galleryGrid.querySelectorAll('.gallery-item').forEach(i => i.remove());
    galleryEmpty.style.display = gallery.length === 0 ? 'block' : 'none';
    galleryCount.textContent = `${gallery.length} imagen${gallery.length !== 1 ? 's' : ''}`;
    gallery.forEach(item => {
        const div = document.createElement('div');
        div.className = 'gallery-item';
        div.innerHTML = `
            <img src="${item.image}" alt="${item.prompt.substring(0, 40)}" loading="lazy">
            <div class="gallery-item-overlay"><div class="gallery-item-prompt">${item.prompt}</div></div>
            <button class="gallery-item-delete" onclick="event.stopPropagation();deleteGalleryItem(${item.id})">✕</button>
        `;
        div.addEventListener('click', () => openLightboxUrl(item.image, item.prompt));
        galleryGrid.appendChild(div);
    });
}

function deleteGalleryItem(id) {
    gallery = gallery.filter(i => i.id !== id);
    localStorage.setItem('nv_gallery', JSON.stringify(gallery));
    renderGallery();
    showToast('Imagem removida.');
}

function clearGallery() {
    if (!confirm('Apagar todas as imagens salvas?')) return;
    gallery = [];
    localStorage.setItem('nv_gallery', JSON.stringify(gallery));
    renderGallery();
    showToast('Galeria limpa.');
}

// ── Lightbox ──
function openLightboxUrl(url, prompt) {
    lightboxImage.src = url;
    lightboxInfo.textContent = prompt || '';
    lightboxModal.classList.add('active');
}
function closeLightbox() { lightboxModal.classList.remove('active'); }

// ── Settings ──
function openSettings() { settingsModal.classList.add('active'); }
function closeSettings() { settingsModal.classList.remove('active'); }
function saveSettings() {
    apiKey = apiKeyInput.value.trim();
    colabUrl = ($('colabUrlInput')?.value || '').trim().replace(/\/$/, '');
    localStorage.setItem('nv_apikey', apiKey);
    localStorage.setItem('nv_colaburl', colabUrl);
    localStorage.setItem('nv_servermode', serverMode);
    closeSettings();
    showToast('Configuracoes salvas!');
}
function toggleApiKeyVisibility() {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
}

function setServerMode(mode) {
    serverMode = mode;
    document.querySelectorAll('.server-mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    const isColab = mode === 'colab';
    if ($('apiKeyGroup')) $('apiKeyGroup').style.display = isColab ? 'none' : 'block';
    if ($('colabUrlGroup')) $('colabUrlGroup').style.display = isColab ? 'block' : 'none';
}

async function testColabConnection() {
    const url = ($('colabUrlInput')?.value || '').trim().replace(/\/$/, '');
    if (!url) { showToast('Cole a URL do Colab primeiro.'); return; }
    try {
        const r = await fetch(url + '/api/health', {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await r.json();
        if (data.status === 'ok') {
            showToast('Conectado! Modelo: ' + (data.model || 'OK'));
        } else {
            showToast('Servidor respondeu mas status nao e OK.');
        }
    } catch (e) {
        showToast('Erro ao conectar: ' + e.message);
    }
}

// ── Toast ──
function showToast(msg) {
    toastMessage.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('visible'), 3000);
}