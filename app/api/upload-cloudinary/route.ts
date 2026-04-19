import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

interface UploadRequest {
  imageUrl: string;
  publicId: string;
  folder: string;
  cloudName: string;
  uploadPreset: string;
}

export async function POST(req: NextRequest) {
  let body: UploadRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { imageUrl, publicId, folder, cloudName, uploadPreset } = body;

  if (!imageUrl || !cloudName || !uploadPreset) {
    return NextResponse.json({ error: 'Campos obrigatórios: imageUrl, cloudName, uploadPreset' }, { status: 400 });
  }

  try {
    // Passo 1: Backend baixa a imagem (sem CORS, sem hotlink bloqueando)
    const imageResponse = await fetch(imageUrl, {
      headers: {
        // User-Agent de browser comum — evita bloqueio por bot detection
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/jpeg,image/png,image/*,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Referer': new URL(imageUrl).origin,
      },
      redirect: 'follow',
    });

    if (!imageResponse.ok) {
      return NextResponse.json({
        error: `Não consegui baixar a imagem (${imageResponse.status}). Tente outra URL ou upload manual.`,
      }, { status: 400 });
    }

    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({
        error: 'A URL não retornou uma imagem válida',
      }, { status: 400 });
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBlob = new Blob([imageBuffer], { type: contentType });

    // Passo 2: Upload pro Cloudinary (unsigned, como já estava funcionando)
    const formData = new FormData();
    formData.append('file', imageBlob);
    formData.append('upload_preset', uploadPreset);
    if (publicId) formData.append('public_id', publicId);
    if (folder) formData.append('folder', folder);

    const uploadResponse = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: formData,
    });

    const uploadData = await uploadResponse.json();

    if (uploadData.error) {
      return NextResponse.json({
        error: `Cloudinary: ${uploadData.error.message}`,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      public_id: uploadData.public_id,
      secure_url: uploadData.secure_url,
      width: uploadData.width,
      height: uploadData.height,
    });
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}