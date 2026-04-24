# =============================================================
# NeuraVision - Servidor de IA no Google Colab
# Modelo: SDXL 1.0 Base + Refiner (qualidade maxima)
#
# 1. Colab > Runtime > Change runtime type > T4 GPU
# 2. Cole este codigo em uma celula e execute
# 3. Copie a URL e cole no NeuraVision > Config > Colab
# =============================================================

# --- Instalar ---
print("Instalando dependencias...")
import subprocess, sys
for pkg in ["diffusers", "transformers", "accelerate", "safetensors",
            "flask", "flask-cors", "pyngrok", "Pillow"]:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", pkg])
print("OK!\n")

# =============================================================
# CONFIGURACOES
# =============================================================
BLOCKED_WORDS = [
    # "violencia",
    # "sangue",
]
BLOCK_MESSAGE = "Conteudo nao permitido."
NGROK_TOKEN = ""  # Cole seu token do ngrok aqui

# Qualidade padrao
NUM_STEPS = 35
GUIDANCE_SCALE = 8.5

# Refiner: porcentagem do denoising feito pelo base (resto pelo refiner)
# 0.8 = base faz 80%, refiner refina os 20% finais (detalhes finos)
HIGH_NOISE_FRAC = 0.8
# =============================================================

import torch, io, time, gc, traceback, os
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

def check_prompt(prompt):
    for word in BLOCKED_WORDS:
        if word.lower() in prompt.lower():
            return False, f"Bloqueado: '{word}'. {BLOCK_MESSAGE}"
    return True, ""

# --- Login HF ---
print("Login no Hugging Face...")
try:
    from google.colab import userdata
    HF_TOKEN = userdata.get('HF_TOKEN')
except:
    HF_TOKEN = os.environ.get("HF_TOKEN", "")

if not HF_TOKEN:
    print("ERRO: Adicione HF_TOKEN nos Colab Secrets (icone de chave)")
    raise Exception("HF_TOKEN nao encontrado")

HF_TOKEN = HF_TOKEN.strip().split('\n')[0].strip()
from huggingface_hub import login
login(token=HF_TOKEN)
print("Login OK!\n")

# --- Carregar modelos ---
from diffusers import DiffusionPipeline, DPMSolverMultistepScheduler

# =========================================
# MODELO BASE - SDXL 1.0
# =========================================
print("=" * 50)
print("  [1/2] Carregando SDXL 1.0 Base...")
print("  ~6.5GB - Aguarde 2-3 minutos...")
print("=" * 50)

pipe = DiffusionPipeline.from_pretrained(
    "stabilityai/stable-diffusion-xl-base-1.0",
    torch_dtype=torch.float16,
    variant="fp16",
    use_safetensors=True,
)

# Scheduler otimizado
pipe.scheduler = DPMSolverMultistepScheduler.from_config(
    pipe.scheduler.config,
    use_karras_sigmas=True,
    algorithm_type="sde-dpmsolver++"
)

pipe = pipe.to("cuda")
pipe.enable_attention_slicing()
pipe.enable_vae_slicing()

# FreeU: melhora qualidade GRATIS (modifica skip connections do UNet)
# Valores otimizados para SDXL
pipe.enable_freeu(b1=1.3, b2=1.4, s1=0.9, s2=0.2)

gc.collect()
torch.cuda.empty_cache()
vram_base = torch.cuda.memory_allocated() / 1024**3
print(f"  Base carregado! VRAM: {vram_base:.1f} GB")

# =========================================
# MODELO REFINER - SDXL Refiner
# =========================================
print("\n" + "=" * 50)
print("  [2/2] Carregando SDXL Refiner...")
print("  Adiciona detalhes finos (rostos, texturas)")
print("  ~6GB - Aguarde 2-3 minutos...")
print("=" * 50)

refiner_loaded = False
try:
    refiner = DiffusionPipeline.from_pretrained(
        "stabilityai/stable-diffusion-xl-refiner-1.0",
        torch_dtype=torch.float16,
        variant="fp16",
        use_safetensors=True,
        text_encoder_2=pipe.text_encoder_2,
        vae=pipe.vae,
    )
    refiner = refiner.to("cuda")
    refiner.enable_attention_slicing()
    refiner.enable_vae_slicing()

    gc.collect()
    torch.cuda.empty_cache()
    vram_total = torch.cuda.memory_allocated() / 1024**3
    print(f"  Refiner carregado! VRAM total: {vram_total:.1f} GB")
    refiner_loaded = True
except Exception as e:
    print(f"\n  [!] Refiner nao coube na memoria: {e}")
    print("  Continuando apenas com o modelo base (ainda muito bom!)")
    gc.collect()
    torch.cuda.empty_cache()

# --- Resumo ---
print("\n" + "=" * 50)
print(f"  Modelos prontos!")
print(f"  Base: SDXL 1.0 + FreeU")
print(f"  Refiner: {'Ativo' if refiner_loaded else 'Indisponivel (pouca VRAM)'}")
print(f"  Steps: {NUM_STEPS} | Guidance: {GUIDANCE_SCALE}")
print(f"  VRAM usada: {torch.cuda.memory_allocated()/1024**3:.1f} GB")
print("=" * 50)

# --- Servidor ---
app = Flask(__name__)
CORS(app)

@app.route("/api/generate", methods=["POST", "OPTIONS"])
def generate():
    if request.method == "OPTIONS":
        return "", 200
    try:
        data = request.get_json()
        prompt = data.get("inputs", "")
        width = min(data.get("width", 1024), 1024)
        height = min(data.get("height", 1024), 1024)
        params = data.get("parameters", {})
        negative = params.get("negative_prompt", "") or ""
        seed_val = params.get("seed", -1)
        steps = data.get("steps", NUM_STEPS)
        guidance = data.get("guidance_scale", GUIDANCE_SCALE)
        quality = data.get("quality", "max")  # normal, high, max

        if not prompt:
            return jsonify({"error": "Prompt vazio."}), 400

        ok, reason = check_prompt(prompt)
        if not ok:
            return jsonify({"error": reason}), 403

        # Multiplo de 8
        width = (width // 8) * 8
        height = (height // 8) * 8

        # Ajustar steps por qualidade
        if quality == "normal":
            steps = min(steps, 25)
        elif quality == "max":
            steps = max(steps, 40)

        use_refiner = quality == "max" and refiner_loaded

        print(f"\n[Gerando] {prompt[:70]}...")
        print(f"  Tamanho: {width}x{height} | Steps: {steps} | Guidance: {guidance}")
        print(f"  Qualidade: {quality} | Refiner: {'Sim' if use_refiner else 'Nao'}")
        start = time.time()

        gen = torch.Generator("cuda").manual_seed(
            seed_val if seed_val >= 0 else int(time.time()) % 2147483647
        )

        # Prompt de qualidade automatico
        quality_suffix = ", masterpiece, best quality, highly detailed, sharp focus, professional, 8k uhd, high resolution, intricate details"
        full_prompt = prompt + quality_suffix

        # Negative prompt padrao
        default_negative = "worst quality, low quality, blurry, distorted, deformed, ugly, bad anatomy, bad hands, extra fingers, mutated hands, poorly drawn face, out of focus, watermark, signature, text, jpeg artifacts, lowres, cropped"
        full_negative = f"{negative}, {default_negative}" if negative else default_negative

        if use_refiner:
            # === MODO MAXIMO: Base + Refiner ===
            # Base gera 80% do denoising, refiner faz os 20% finais
            latent = pipe(
                prompt=full_prompt,
                negative_prompt=full_negative,
                width=width,
                height=height,
                num_inference_steps=steps,
                guidance_scale=guidance,
                generator=gen,
                denoising_end=HIGH_NOISE_FRAC,
                output_type="latent",
            ).images

            # Refiner refina detalhes finos
            image = refiner(
                prompt=full_prompt,
                negative_prompt=full_negative,
                image=latent,
                num_inference_steps=steps,
                guidance_scale=guidance,
                denoising_start=HIGH_NOISE_FRAC,
            ).images[0]

            elapsed = time.time() - start
            print(f"[OK] Gerado em {elapsed:.1f}s (base + refiner)")
        else:
            # === MODO NORMAL/ALTO: Apenas Base ===
            image = pipe(
                prompt=full_prompt,
                negative_prompt=full_negative,
                width=width,
                height=height,
                num_inference_steps=steps,
                guidance_scale=guidance,
                generator=gen,
            ).images[0]

            elapsed = time.time() - start
            print(f"[OK] Gerado em {elapsed:.1f}s (base)")

        buf = io.BytesIO()
        image.save(buf, format="PNG", optimize=True)
        buf.seek(0)

        torch.cuda.empty_cache()
        return send_file(buf, mimetype="image/png")

    except torch.cuda.OutOfMemoryError:
        torch.cuda.empty_cache()
        gc.collect()
        return jsonify({"error": "Sem memoria GPU. Tente qualidade 'normal' ou tamanho menor."}), 500

    except Exception as e:
        print(f"[Erro] {e}")
        traceback.print_exc()
        torch.cuda.empty_cache()
        return jsonify({"error": str(e)}), 500

@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "model": "SDXL 1.0 Base + Refiner" if refiner_loaded else "SDXL 1.0 Base",
        "refiner": refiner_loaded,
        "freeu": True,
        "steps": NUM_STEPS,
        "vram_gb": round(torch.cuda.memory_allocated()/1024**3, 1)
    })

@app.route("/api/enhance-prompt", methods=["POST", "OPTIONS"])
def enhance_prompt():
    if request.method == "OPTIONS":
        return "", 200
    try:
        data = request.get_json()
        prompt = data.get("prompt", "")
        
        if not prompt:
            return jsonify({"error": "Prompt vazio."}), 400

        from huggingface_hub import InferenceClient
        client = InferenceClient() # Uses the token from huggingface_hub.login
        
        system_prompt = "You are an expert AI image prompt engineer. Your task is to take the user's simple concept and expand it into a highly detailed, descriptive, and visually rich prompt in English, optimized for image generation models. Focus on lighting, camera details, atmosphere, and textures. Keep the final prompt under 60 words. Only output the enhanced prompt, nothing else."
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Enhance this prompt: {prompt}"}
        ]
        
        response = client.chat_completion(
            model="Qwen/Qwen2.5-72B-Instruct",
            messages=messages,
            max_tokens=150,
            temperature=0.7
        )
        
        
        enhanced_prompt = response.choices[0].message.content.strip()
        return jsonify({"enhanced_prompt": enhanced_prompt})

    except Exception as e:
        print(f"[Erro Enhance] {e}")
        traceback.print_exc()
        return jsonify({"error": "Erro ao melhorar prompt: " + str(e)}), 500

# --- Ngrok ---
from pyngrok import ngrok
if NGROK_TOKEN:
    ngrok.set_auth_token(NGROK_TOKEN)
else:
    print("\nSem NGROK_TOKEN! Pegue em: https://dashboard.ngrok.com/signup")

url = ngrok.connect(5000)
print("\n" + "=" * 50)
print("  SERVIDOR PRONTO!")
print(f"  URL: {url}")
print(f"  Modelo: SDXL 1.0 {'+ Refiner' if refiner_loaded else '(Base)'}")
print(f"  FreeU: Ativo")
print(f"  Cole no NeuraVision > Config > Colab")
print("=" * 50)

app.run(port=5000)
