# Conversor ZPL para PDF

Site em React + Node.js para converter etiquetas ZPL em PDF 10x15 cm.

## Rodar no computador local

```bash
pnpm install
pnpm build
HOST=127.0.0.1 PORT=3002 pnpm start
```

Acesse:

```text
http://127.0.0.1:3002
```

## Publicar para acessar de qualquer computador

O jeito mais simples é usar Render:

1. Crie uma conta em https://render.com.
2. Envie este projeto para um repositório no GitHub.
3. No Render, escolha **New > Blueprint**.
4. Selecione o repositório.
5. O Render vai ler o arquivo `render.yaml`.
6. Depois do deploy, ele gera uma URL pública para acessar de qualquer computador.

## Observação sobre privacidade

A renderização das etiquetas usa a API externa do Labelary. Isso significa que o conteúdo ZPL enviado para conversão é encaminhado ao Labelary para virar imagem antes de ser colocado no PDF.
