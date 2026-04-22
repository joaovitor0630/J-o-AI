"""
NeuraVision - Servidor local com proxy para Hugging Face API
Usa a biblioteca oficial huggingface_hub para evitar problemas de CORS e endpoints.
Uso: python server.py
Acesse: http://localhost:8080
"""

import http.server
import json
import os
import io
import traceback

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
        else:
            self.send_error(404, 'Not Found')

    def proxy_generate(self):
        try:
            from huggingface_hub import InferenceClient

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            api_key = data.get('api_key', '')
            model = data.get('model', 'black-forest-labs/FLUX.1-schnell')
            prompt = data.get('inputs', '')
            negative = data.get('parameters', {}).get('negative_prompt', '') if data.get('parameters') else ''

            if not api_key:
                self.send_json_error(400, 'API key nao fornecida.')
                return
            if not prompt:
                self.send_json_error(400, 'Prompt nao fornecido.')
                return

            print(f'[Proxy] Modelo: {model}')
            print(f'[Proxy] Prompt: {prompt[:80]}...')

            client = InferenceClient(token=api_key)

            # Generate image using official library
            kwargs = {'prompt': prompt, 'model': model}
            if negative:
                kwargs['negative_prompt'] = negative

            image = client.text_to_image(**kwargs)

            # Convert PIL Image to bytes
            img_bytes = io.BytesIO()
            image.save(img_bytes, format='PNG')
            img_data = img_bytes.getvalue()

            print(f'[Proxy] Imagem gerada! Tamanho: {len(img_data)} bytes')

            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(img_data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(img_data)

        except Exception as e:
            error_msg = str(e)
            print(f'[Proxy] Erro: {error_msg}')
            traceback.print_exc()

            # Try to give a helpful error message
            if '401' in error_msg or 'Unauthorized' in error_msg:
                error_msg = 'API key invalida. Verifique sua chave.'
            elif '403' in error_msg:
                error_msg = 'Acesso negado a este modelo. Tente outro.'
            elif '404' in error_msg:
                error_msg = f'Modelo "{data.get("model", "")}" nao disponivel na API. Tente outro modelo.'
            elif '503' in error_msg or 'loading' in error_msg.lower():
                error_msg = 'Modelo carregando. Aguarde alguns segundos e tente novamente.'
            elif '429' in error_msg:
                error_msg = 'Limite de requisicoes atingido. Aguarde um momento.'

            self.send_json_error(500, error_msg)

    def send_json_error(self, code, message):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({'error': message}).encode('utf-8'))

    def log_message(self, format, *args):
        print(f'[Server] {args[0]}')


if __name__ == '__main__':
    print('==========================================')
    print('  NeuraVision - AI Image Generator')
    print(f'  Servidor rodando em: http://localhost:{PORT}')
    print('  Pressione Ctrl+C para parar')
    print('==========================================')

    server = http.server.HTTPServer(('', PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[Server] Servidor encerrado.')
        server.server_close()
