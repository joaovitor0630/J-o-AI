"""
NeuraVision - Servidor local com proxy para Hugging Face API
Suporta: text-to-image, image-to-image, seed, tamanho customizado
Uso: python server.py  |  Acesse: http://localhost:8080
"""
import http.server, json, os, io, traceback, base64

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path.startswith('/api/generate'):
            self.proxy_generate()
        elif self.path.startswith('/api/enhance-prompt'):
            self.proxy_enhance_prompt()
        else:
            self.send_error(404)

    def proxy_generate(self):
        try:
            from huggingface_hub import InferenceClient
            from PIL import Image

            length = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(length))

            api_key = data.get('api_key', '')
            model = data.get('model', 'black-forest-labs/FLUX.1-schnell')
            prompt = data.get('inputs', '')
            params = data.get('parameters', {})
            width = data.get('width', 512)
            height = data.get('height', 512)
            ref_image_b64 = data.get('ref_image')
            strength = data.get('strength', 0.7)

            if not api_key:
                return self.send_json_error(400, 'API key nao fornecida.')
            if not prompt:
                return self.send_json_error(400, 'Prompt nao fornecido.')

            print(f'[Proxy] Modelo: {model} | Tamanho: {width}x{height}')
            print(f'[Proxy] Prompt: {prompt[:80]}...')

            client = InferenceClient(token=api_key)

            # Parametros de qualidade do request
            req_steps = data.get('steps', 35)
            req_guidance = data.get('guidance_scale', 8.5)

            # Tokens de qualidade e negative prompt padrao
            quality_suffix = ', masterpiece, best quality, highly detailed, sharp focus, professional'
            default_negative = 'worst quality, low quality, blurry, distorted, deformed, ugly, bad anatomy, bad hands, watermark, text, jpeg artifacts'
            user_negative = params.get('negative_prompt', '') or ''
            full_negative = f'{user_negative}, {default_negative}' if user_negative else default_negative

            if ref_image_b64:
                # Image-to-image
                print('[Proxy] Modo: image-to-image')
                img_data = base64.b64decode(ref_image_b64.split(',')[1] if ',' in ref_image_b64 else ref_image_b64)
                ref_img = Image.open(io.BytesIO(img_data))
                image = client.image_to_image(
                    image=ref_img,
                    prompt=prompt + quality_suffix,
                    model=model,
                    strength=strength,
                    negative_prompt=full_negative,
                )
            else:
                # Text-to-image
                enhanced_prompt = prompt + quality_suffix

                kwargs = {
                    'prompt': enhanced_prompt,
                    'model': model,
                    'width': width,
                    'height': height,
                    'negative_prompt': full_negative,
                    'guidance_scale': req_guidance,
                    'num_inference_steps': req_steps,
                }
                if params.get('seed', -1) >= 0:
                    kwargs['seed'] = params['seed']
                    print(f'[Proxy] Seed: {params["seed"]}')

                image = client.text_to_image(**kwargs)

            # Convert to PNG bytes
            buf = io.BytesIO()
            image.save(buf, format='PNG')
            img_bytes = buf.getvalue()
            print(f'[Proxy] Imagem gerada! {len(img_bytes)} bytes')

            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(img_bytes)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(img_bytes)

        except Exception as e:
            msg = str(e)
            print(f'[Proxy] Erro: {msg}')
            traceback.print_exc()
            if '401' in msg or 'Unauthorized' in msg:
                msg = 'API key invalida. Verifique sua chave.'
            elif '404' in msg:
                msg = f'Modelo nao disponivel na API. Tente outro modelo.'
            elif '503' in msg or 'loading' in msg.lower():
                msg = 'Modelo carregando. Aguarde alguns segundos e tente novamente.'
            elif '429' in msg:
                msg = 'Limite de requisicoes atingido. Aguarde.'
            self.send_json_error(500, msg)

    def send_json_error(self, code, message):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({'error': message}).encode('utf-8'))

    def proxy_enhance_prompt(self):
        try:
            from huggingface_hub import InferenceClient

            length = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(length))

            api_key = data.get('api_key', '')
            prompt = data.get('prompt', '')

            if not api_key:
                return self.send_json_error(400, 'API key nao fornecida.')
            if not prompt:
                return self.send_json_error(400, 'Prompt nao fornecido.')

            print(f'[Proxy] Melhorando prompt: {prompt[:50]}...')

            client = InferenceClient(token=api_key)
            
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
            print(f'[Proxy] Prompt melhorado: {enhanced_prompt[:80]}...')

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'enhanced_prompt': enhanced_prompt}).encode('utf-8'))

        except Exception as e:
            msg = str(e)
            print(f'[Proxy] Erro (Enhance Prompt): {msg}')
            traceback.print_exc()
            self.send_json_error(500, 'Erro ao melhorar o prompt. Verifique se sua API key tem permissoes para o modelo chat.')

    def log_message(self, fmt, *args):
        print(f'[Server] {args[0]}')


if __name__ == '__main__':
    print('==========================================')
    print('  NeuraVision - AI Image Generator v2.0')
    print(f'  http://localhost:{PORT}')
    print('  Ctrl+C para parar')
    print('==========================================')
    server = http.server.HTTPServer(('', PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[Server] Encerrado.')
        server.server_close()
