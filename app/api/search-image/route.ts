import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60; // máximo 60s (limite Vercel Hobby)

interface SearchRequest {
  descricao: string;
  fabricante?: string;
  sabor?: string;
  peso?: string;
  siteFornecedor?: string;
  urlProduto?: string;
}

interface ImageResult {
  url: string;
  source: string;
  oficial: boolean;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 });
  }

  let body: SearchRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { descricao, fabricante, sabor, peso, siteFornecedor, urlProduto } = body;

  if (!descricao) {
    return NextResponse.json({ error: 'descricao é obrigatório' }, { status: 400 });
  }

  // Extrai domínio limpo do site fornecedor
  let siteDominio = '';
  if (siteFornecedor && siteFornecedor.startsWith('http')) {
    try {
      siteDominio = new URL(siteFornecedor).hostname.replace(/^www\./, '');
    } catch {
      // ignora URL inválida
    }
  }

  const descricaoCompleta = [descricao, fabricante, sabor, peso].filter(Boolean).join(' ');

  // Monta prompt baseado no que temos
  let prompt: string;
  if (urlProduto && urlProduto.startsWith('http')) {
    prompt = `Produto de suplemento: "${descricaoCompleta}"

URL oficial do produto: ${urlProduto}

Acesse a URL acima usando a ferramenta web e extraia a imagem principal do produto (geralmente em meta tags og:image ou a primeira imagem grande da página). Se não conseguir acessar, faça busca web priorizando o fabricante.

Retorne MÍNIMO 6 URLs de imagens. Prefira embalagem frontal, fundo branco/neutro, alta resolução.

Retorne APENAS JSON array (sem markdown, sem prefixos):
[{"url":"URL_DIRETA_DA_IMAGEM_jpg_ou_png","source":"dominio.com","oficial":true}]`;
  } else if (siteDominio) {
    prompt = `Produto de suplemento: "${descricaoCompleta}"

ESTRATÉGIA:
1) Busque com filtro "site:${siteDominio}" para imagens oficiais do fabricante
2) Complete com busca aberta na web até ter pelo menos 6 resultados

Prefira embalagem frontal, fundo branco/neutro, alta resolução. Marque oficial:true apenas para imagens vindas do domínio ${siteDominio}.

Retorne APENAS JSON array (sem markdown, sem prefixos):
[{"url":"URL_DIRETA_DA_IMAGEM","source":"dominio.com","oficial":true}]`;
  } else {
    prompt = `Produto: "${descricaoCompleta}"

Busque na web 6 imagens do produto. Prefira embalagem frontal, fundo branco/neutro, alta resolução. Use Mercado Livre, Amazon, lojas de suplementos.

Retorne APENAS JSON array (sem markdown, sem prefixos):
[{"url":"URL_DIRETA_DA_IMAGEM","source":"dominio.com","oficial":false}]`;
  }

  try {
    // Retry com backoff exponencial em caso de 429 (rate limit)
    const maxAttempts = 3;
    let lastError = '';
    let response: Response | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        }),
      });

      if (response.ok) break;

      if (response.status === 429 && attempt < maxAttempts) {
        // Espera progressiva: 5s, 15s
        const waitMs = attempt === 1 ? 5000 : 15000;
        console.log(`Rate limit (tentativa ${attempt}). Aguardando ${waitMs}ms...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      const errText = await response.text().catch(() => '');
      lastError = errText.slice(0, 300);
      console.error('Anthropic API error:', response.status, lastError);
      break;
    }

    if (!response || !response.ok) {
      if (response?.status === 429) {
        return NextResponse.json({
          error: 'Rate limit persistente. Aguarde 1-2 minutos antes de tentar novamente.',
        }, { status: 429 });
      }
      return NextResponse.json({
        error: `API Claude retornou ${response?.status || 'sem resposta'}: ${lastError}`,
      }, { status: 500 });
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.content)) {
      return NextResponse.json({ error: 'Resposta inválida da API' }, { status: 500 });
    }

    const textBlocks = data.content
      .filter((b: { type?: string }) => b && b.type === 'text')
      .map((b: { text?: string }) => b.text || '')
      .join('\n');

    const jsonMatch = textBlocks.match(/\[[\s\S]*\]/);
    let results: ImageResult[] = [];
    if (jsonMatch) {
      try {
        results = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error('Parse JSON error:', e);
      }
    }

    // Valida resultados
    results = results.filter(r => r && typeof r.url === 'string' && r.url.startsWith('http'));
    results.sort((a, b) => (b.oficial ? 1 : 0) - (a.oficial ? 1 : 0));

    return NextResponse.json({ results });
  } catch (err) {
    console.error('Search error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}