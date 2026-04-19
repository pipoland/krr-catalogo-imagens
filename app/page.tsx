'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Upload, Search, Image as ImageIcon, Check, X, Download, Settings, Folder, RefreshCw, Trash2, Eye, Copy } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

const STORAGE_KEYS = {
  config: 'catalog:config',
  products: 'catalog:products',
  mapping: 'catalog:mapping',
  templates: 'catalog:templates',
};

const DEFAULT_TEMPLATES = {
  folder: 'suplementos/{fabricante}/{categoria}',
  publicId: '{codigo}-{nome}-{variante}',
};

const DEFAULT_MAPPING = {
  codigo: 'CÓD.',
  fabricante: 'MARCA',
  categoria: 'CATEGORIA',
  nome: 'DESCRIÇÃO',
  variante: 'SABOR',
  peso: 'PESO',
  siteFornecedor: 'SITE DO FORNECEDOR',
  urlProduto: 'URL DO PRODUTO',
};

const VARIANTS = {
  thumb: 'f_auto,q_auto,c_fill,ar_1:1,w_200',
  card: 'f_auto,q_auto,c_fill,ar_1:1,w_600',
  full: 'f_auto,q_auto,w_1200',
};

function slugify(str: string): string {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function renderTemplate(template: string, data: Record<string, string>): string {
  if (!template) return '';
  let result = template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = data[key];
    return v ? slugify(v) : '';
  });
  result = result.replace(/\/+/g, '/').replace(/-+/g, '-');
  result = result.replace(/\/-|-\//g, '/').replace(/^-|-$/g, '');
  result = result.replace(/^\/|\/$/g, '');
  return result;
}

function buildOptimizedUrl(cloudName: string, publicId: string, folder: string, transform: string): string {
  const fullPath = folder ? `${folder}/${publicId}` : publicId;
  return `https://res.cloudinary.com/${cloudName}/image/upload/${transform}/${fullPath}`;
}

type Product = Record<string, string | undefined> & {
  _id: string;
  _status: 'pending' | 'done';
};

interface SearchResult {
  url: string;
  source: string;
  oficial: boolean;
}

export default function CatalogImageManager() {
  const [config, setConfig] = useState({ cloudName: '', uploadPreset: '' });
  const [mapping, setMapping] = useState(DEFAULT_MAPPING);
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [products, setProducts] = useState<Product[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<'upload' | 'config' | 'review'>('upload');
  const [uploadMode, setUploadMode] = useState<'file' | 'paste'>('file');
  const [pastedContent, setPastedContent] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Record<string, SearchResult[]>>({});
  const [batchSearch, setBatchSearch] = useState<{ running: boolean; current: number; total: number; cancel: boolean }>({ running: false, current: 0, total: 0, cancel: false });
  const [manualUrl, setManualUrl] = useState('');
  const [filter, setFilter] = useState({ search: '', status: 'all', fabricante: 'all' });
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

  useEffect(() => {
    try {
      const c = localStorage.getItem(STORAGE_KEYS.config);
      const p = localStorage.getItem(STORAGE_KEYS.products);
      const m = localStorage.getItem(STORAGE_KEYS.mapping);
      const t = localStorage.getItem(STORAGE_KEYS.templates);
      if (c) setConfig(JSON.parse(c));
      if (p) {
        const parsed = JSON.parse(p);
        setProducts(parsed.products || []);
        setColumns(parsed.columns || []);
        if (parsed.products?.length) setCurrentStep('review');
      }
      if (m) setMapping(JSON.parse(m));
      if (t) setTemplates(JSON.parse(t));
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const showToast = (msg: string, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const persist = useCallback((key: string, value: unknown) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Persist error:', e);
    }
  }, []);

  const handlePastedContent = () => {
    if (!pastedContent.trim()) {
      showToast('Cole o conteúdo primeiro', 'error');
      return;
    }
    try {
      const firstLine = pastedContent.split('\n')[0];
      const hasTab = firstLine.includes('\t');
      const delimiter = hasTab ? '\t' : ',';
      const parsed = Papa.parse(pastedContent.trim(), {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        delimiter,
      });
      if (!parsed.data.length) throw new Error('Nenhuma linha encontrada');
      const headers = (parsed.meta.fields || []).map(h => h.trim());
      const rows: Product[] = (parsed.data as Record<string, unknown>[]).map((row, idx) => {
        const clean: Product = { _id: `row_${idx}`, _status: 'pending' };
        Object.keys(row).forEach(k => {
          const val = row[k];
          clean[k.trim()] = typeof val === 'string' ? val.trim() : String(val ?? '');
        });
        return clean;
      });
      setColumns(headers);
      setProducts(rows);
      persist(STORAGE_KEYS.products, { products: rows, columns: headers });
      setCurrentStep('config');
      setPastedContent('');
      showToast(`${rows.length} produtos carregados (${hasTab ? 'TSV' : 'CSV'})`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Erro ao processar: ' + (err as Error).message, 'error');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      let rows: Record<string, unknown>[] = [];
      let headers: string[] = [];
      if (file.name.endsWith('.csv')) {
        const text = new TextDecoder().decode(buf);
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: false });
        rows = parsed.data as Record<string, unknown>[];
        headers = (parsed.meta.fields || []).map(h => h.trim());
      } else {
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        headers = rows.length ? Object.keys(rows[0]).map(h => h.trim()) : [];
      }
      const cleanRows: Product[] = rows.map((row, idx) => {
        const clean: Product = { _id: `row_${idx}`, _status: 'pending' };
        Object.keys(row).forEach(k => {
          const val = row[k];
          clean[k.trim()] = typeof val === 'string' ? val.trim() : String(val ?? '');
        });
        return clean;
      });
      setColumns(headers);
      setProducts(cleanRows);
      persist(STORAGE_KEYS.products, { products: cleanRows, columns: headers });
      setCurrentStep('config');
      showToast(`${cleanRows.length} produtos carregados`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Erro ao ler arquivo: ' + (err as Error).message, 'error');
    }
  };

  const handleConfigSave = () => {
    if (!config.cloudName || !config.uploadPreset) {
      showToast('Preencha cloud name e upload preset', 'error');
      return;
    }
    if (!mapping.codigo || !mapping.nome) {
      showToast('Mapeie ao menos "código" e "nome"', 'error');
      return;
    }
    persist(STORAGE_KEYS.config, config);
    persist(STORAGE_KEYS.mapping, mapping);
    persist(STORAGE_KEYS.templates, templates);
    setCurrentStep('review');
    showToast('Configuração salva', 'success');
  };

  const computePaths = (product: Product) => {
    const data: Record<string, string> = {
      codigo: product[mapping.codigo] as string || '',
      fabricante: mapping.fabricante ? (product[mapping.fabricante] as string || '') : '',
      categoria: mapping.categoria ? (product[mapping.categoria] as string || '') : '',
      nome: product[mapping.nome] as string || '',
      variante: mapping.variante ? (product[mapping.variante] as string || '') : '',
    };
    const folder = renderTemplate(templates.folder, data);
    const publicId = renderTemplate(templates.publicId, data);
    return { folder, publicId };
  };

  // Busca em lote — processa todos pendentes em background
  const batchSearchPending = async () => {
    const pending = products.filter(p => p._status === 'pending' && !searchResults[p._id]);
    if (!pending.length) {
      showToast('Nenhum produto pendente sem busca', 'info');
      return;
    }
    setBatchSearch({ running: true, current: 0, total: pending.length, cancel: false });
    for (let i = 0; i < pending.length; i++) {
      // Lê flag de cancelamento via state atualizado
      const shouldCancel = await new Promise<boolean>(resolve => {
        setBatchSearch(s => { resolve(s.cancel); return s; });
      });
      if (shouldCancel) break;

      const product = pending[i];
      setBatchSearch(s => ({ ...s, current: i + 1 }));
      try {
        const body = {
          descricao: product[mapping.nome] as string || '',
          fabricante: mapping.fabricante ? (product[mapping.fabricante] as string || '') : '',
          sabor: mapping.variante ? (product[mapping.variante] as string || '') : '',
          peso: mapping.peso ? (product[mapping.peso] as string || '') : '',
          siteFornecedor: mapping.siteFornecedor ? (product[mapping.siteFornecedor] as string || '') : '',
          urlProduto: mapping.urlProduto ? (product[mapping.urlProduto] as string || '') : '',
        };
        const res = await fetch('/api/search-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data.results)) {
          setSearchResults(r => ({ ...r, [product._id]: data.results }));
        }
      } catch (err) {
        console.error('Batch error:', err);
      }
      // Delay de 8s entre chamadas pra respeitar rate limit
      if (i < pending.length - 1) {
        await new Promise(r => setTimeout(r, 8000));
      }
    }
    setBatchSearch({ running: false, current: 0, total: 0, cancel: false });
    showToast('Busca em lote concluída', 'success');
  };

  const cancelBatchSearch = () => {
    setBatchSearch(s => ({ ...s, cancel: true }));
    showToast('Cancelando...', 'info');
  };

  // Buscar imagens via backend (individual)
  const searchImages = async (product: Product) => {
    const id = product._id;
    setSearchingId(id);
    try {
      const body = {
        descricao: product[mapping.nome] as string || '',
        fabricante: mapping.fabricante ? (product[mapping.fabricante] as string || '') : '',
        sabor: mapping.variante ? (product[mapping.variante] as string || '') : '',
        peso: mapping.peso ? (product[mapping.peso] as string || '') : '',
        siteFornecedor: mapping.siteFornecedor ? (product[mapping.siteFornecedor] as string || '') : '',
        urlProduto: mapping.urlProduto ? (product[mapping.urlProduto] as string || '') : '',
      };
      const res = await fetch('/api/search-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const results: SearchResult[] = data.results || [];
      setSearchResults(r => ({ ...r, [id]: results }));
      if (!results.length) showToast('Nenhuma imagem encontrada', 'error');
    } catch (err) {
      console.error(err);
      showToast('Erro na busca: ' + (err as Error).message, 'error');
    } finally {
      setSearchingId(null);
    }
  };

  // Upload via backend (URL remota)
  const uploadToCloudinary = async (product: Product, imageUrl: string) => {
    const id = product._id;
    setUploadingId(id);
    try {
      const { folder, publicId } = computePaths(product);
      const res = await fetch('/api/upload-cloudinary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          publicId,
          folder,
          cloudName: config.cloudName,
          uploadPreset: config.uploadPreset,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);

      const realPublicId = data.public_id;
      const parts = realPublicId.split('/');
      const realFileName = parts.pop() as string;
      const realFolder = parts.join('/');
      const urls = {
        imagem_url_base: data.secure_url,
        imagem_public_id: realPublicId,
        imagem_folder: realFolder,
        imagem_thumb: buildOptimizedUrl(config.cloudName, realFileName, realFolder, VARIANTS.thumb),
        imagem_card: buildOptimizedUrl(config.cloudName, realFileName, realFolder, VARIANTS.card),
        imagem_full: buildOptimizedUrl(config.cloudName, realFileName, realFolder, VARIANTS.full),
      };
      const updated = products.map(p => p._id === id ? { ...p, ...urls, _status: 'done' as const } : p);
      setProducts(updated);
      persist(STORAGE_KEYS.products, { products: updated, columns });
      setSelectedProduct(null);
      setManualUrl('');
      setSearchResults(r => { const n = { ...r }; delete n[id]; return n; });
      showToast('Imagem enviada com sucesso', 'success');
    } catch (err) {
      console.error(err);
      showToast('Erro no upload: ' + (err as Error).message, 'error');
    } finally {
      setUploadingId(null);
    }
  };

  // Upload de arquivo local (direto pro Cloudinary, unsigned)
  const uploadLocalFile = async (product: Product, file: File) => {
    const id = product._id;
    setUploadingId(id);
    try {
      const { folder, publicId } = computePaths(product);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', config.uploadPreset);
      formData.append('public_id', publicId);
      if (folder) formData.append('folder', folder);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const realPublicId = data.public_id;
      const parts = realPublicId.split('/');
      const realFileName = parts.pop() as string;
      const realFolder = parts.join('/');
      const urls = {
        imagem_url_base: data.secure_url,
        imagem_public_id: realPublicId,
        imagem_folder: realFolder,
        imagem_thumb: buildOptimizedUrl(config.cloudName, realFileName, realFolder, VARIANTS.thumb),
        imagem_card: buildOptimizedUrl(config.cloudName, realFileName, realFolder, VARIANTS.card),
        imagem_full: buildOptimizedUrl(config.cloudName, realFileName, realFolder, VARIANTS.full),
      };
      const updated = products.map(p => p._id === id ? { ...p, ...urls, _status: 'done' as const } : p);
      setProducts(updated);
      persist(STORAGE_KEYS.products, { products: updated, columns });
      setSelectedProduct(null);
      showToast('Upload local concluído', 'success');
    } catch (err) {
      showToast('Erro: ' + (err as Error).message, 'error');
    } finally {
      setUploadingId(null);
    }
  };

  const clearProductImage = (productId: string) => {
    const updated = products.map(p => {
      if (p._id !== productId) return p;
      const newP = { ...p };
      delete newP.imagem_url_base;
      delete newP.imagem_public_id;
      delete newP.imagem_folder;
      delete newP.imagem_thumb;
      delete newP.imagem_card;
      delete newP.imagem_full;
      newP._status = 'pending';
      return newP;
    });
    setProducts(updated);
    persist(STORAGE_KEYS.products, { products: updated, columns });
  };

  const exportCSV = () => {
    const exportData = products.map(p => {
      const rest: Record<string, unknown> = {};
      Object.keys(p).forEach(k => {
        if (k !== '_id' && k !== '_status') rest[k] = p[k];
      });
      return rest;
    });
    const csv = Papa.unparse(exportData);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `catalogo_com_imagens_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exportado', 'success');
  };

  const resetAll = () => {
    if (!window.confirm('Apagar TODOS os dados e recomeçar?')) return;
    localStorage.removeItem(STORAGE_KEYS.products);
    localStorage.removeItem(STORAGE_KEYS.config);
    localStorage.removeItem(STORAGE_KEYS.mapping);
    localStorage.removeItem(STORAGE_KEYS.templates);
    setProducts([]);
    setColumns([]);
    setSelectedProduct(null);
    setSearchResults({});
    setConfig({ cloudName: '', uploadPreset: '' });
    setMapping(DEFAULT_MAPPING);
    setTemplates(DEFAULT_TEMPLATES);
    setPastedContent('');
    setManualUrl('');
    setFilter({ search: '', status: 'all', fabricante: 'all' });
    setCurrentStep('upload');
    showToast('Tudo foi resetado', 'success');
  };

  const fabricantes = useMemo(() => {
    if (!mapping.fabricante) return [];
    const set = new Set(products.map(p => p[mapping.fabricante] as string).filter(Boolean));
    return Array.from(set).sort();
  }, [products, mapping.fabricante]);

  const filtered = useMemo(() => {
    return products.filter(p => {
      if (filter.status === 'pending' && p._status === 'done') return false;
      if (filter.status === 'done' && p._status !== 'done') return false;
      if (filter.fabricante !== 'all' && p[mapping.fabricante] !== filter.fabricante) return false;
      if (filter.search) {
        const s = filter.search.toLowerCase();
        const nome = String(p[mapping.nome] || '').toLowerCase();
        const codigo = String(p[mapping.codigo] || '').toLowerCase();
        if (!nome.includes(s) && !codigo.includes(s)) return false;
      }
      return true;
    });
  }, [products, filter, mapping]);

  const stats = useMemo(() => {
    const done = products.filter(p => p._status === 'done').length;
    return { total: products.length, done, pending: products.length - done };
  }, [products]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard?.writeText(text);
    showToast('Copiado', 'success');
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="text-slate-500">Carregando...</div></div>;
  }

  const currentResults = selectedProduct ? (searchResults[selectedProduct._id] || []) : [];
  const isSearching = selectedProduct ? searchingId === selectedProduct._id : false;
  const isUploading = selectedProduct ? uploadingId === selectedProduct._id : false;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm ${toast.type === 'error' ? 'bg-red-600' : toast.type === 'success' ? 'bg-emerald-600' : 'bg-slate-800'}`}>
          {toast.msg}
        </div>
      )}

      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
              <ImageIcon size={18} className="text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-lg">Catálogo KRR — Imagens</h1>
              <p className="text-xs text-slate-500">Upload planilha → Busca automática → Cloudinary → CSV</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentStep === 'review' && (
              <>
                <button onClick={() => setCurrentStep('config')} className="px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg flex items-center gap-2">
                  <Settings size={16} /> Config
                </button>
                <button onClick={exportCSV} disabled={!stats.done} className="px-3 py-2 text-sm bg-emerald-600 text-white rounded-lg flex items-center gap-2 disabled:opacity-40 hover:bg-emerald-700">
                  <Download size={16} /> Exportar CSV
                </button>
              </>
            )}
            <button onClick={resetAll} className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg">Resetar</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {currentStep === 'upload' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-10">
            <div className="max-w-2xl mx-auto">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Upload size={28} className="text-indigo-600" />
                </div>
                <h2 className="text-2xl font-semibold mb-2">Carregar produtos</h2>
                <p className="text-slate-500">Escolha uma das opções abaixo</p>
              </div>
              <div className="flex bg-slate-100 rounded-lg p-1 mb-6 max-w-md mx-auto">
                <button onClick={() => setUploadMode('file')} className={`flex-1 px-4 py-2 rounded text-sm font-medium transition-colors ${uploadMode === 'file' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Subir arquivo</button>
                <button onClick={() => setUploadMode('paste')} className={`flex-1 px-4 py-2 rounded text-sm font-medium transition-colors ${uploadMode === 'paste' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Colar conteúdo</button>
              </div>
              {uploadMode === 'file' ? (
                <div className="text-center">
                  <label className="block">
                    <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
                    <span className="inline-block px-6 py-3 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 font-medium">Selecionar arquivo</span>
                  </label>
                  <p className="text-xs text-slate-400 mt-3">Aceita .xlsx, .xls, .csv</p>
                </div>
              ) : (
                <div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 text-xs text-blue-900">
                    <strong>Dica:</strong> No Google Sheets, Ctrl+A → Ctrl+C → Ctrl+V aqui. Aceita CSV ou TSV.
                  </div>
                  <textarea value={pastedContent} onChange={e => setPastedContent(e.target.value)} placeholder="Cole aqui..." className="w-full h-64 px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-slate-400">{pastedContent.trim() ? `${pastedContent.trim().split('\n').length} linhas` : '0 linhas'}</span>
                    <button onClick={handlePastedContent} disabled={!pastedContent.trim()} className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium disabled:opacity-40">Processar</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {currentStep === 'config' && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h2 className="font-semibold text-lg mb-1">Cloudinary</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1">Cloud name</label>
                  <input type="text" value={config.cloudName} onChange={e => setConfig({ ...config, cloudName: e.target.value.trim() })} placeholder="meucloud" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1">Upload preset (unsigned)</label>
                  <input type="text" value={config.uploadPreset} onChange={e => setConfig({ ...config, uploadPreset: e.target.value.trim() })} placeholder="krr_suplementos" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h2 className="font-semibold text-lg mb-1">Mapeamento de colunas</h2>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'codigo', label: 'Código*' },
                  { key: 'nome', label: 'Descrição do produto*' },
                  { key: 'fabricante', label: 'Marca / Fabricante' },
                  { key: 'categoria', label: 'Categoria' },
                  { key: 'variante', label: 'Sabor' },
                  { key: 'peso', label: 'Peso / Tamanho' },
                  { key: 'siteFornecedor', label: 'Site do fornecedor' },
                  { key: 'urlProduto', label: 'URL do produto' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="text-sm font-medium text-slate-700 block mb-1">{f.label}</label>
                    <select value={mapping[f.key as keyof typeof mapping]} onChange={e => setMapping({ ...mapping, [f.key]: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                      <option value="">— não usar —</option>
                      {columns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h2 className="font-semibold text-lg mb-1">Templates de organização</h2>
              <p className="text-sm text-slate-500 mb-4">Placeholders: {`{codigo} {nome} {fabricante} {categoria} {variante}`}</p>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1">Pasta no Cloudinary</label>
                  <input type="text" value={templates.folder} onChange={e => setTemplates({ ...templates, folder: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono" />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1">Nome do arquivo (public_id)</label>
                  <input type="text" value={templates.publicId} onChange={e => setTemplates({ ...templates, publicId: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono" />
                </div>
                {products[0] && mapping.nome && (
                  <div className="bg-slate-50 rounded-lg p-3 text-xs">
                    <div className="text-slate-500 mb-1">Preview com primeiro produto:</div>
                    <div className="font-mono text-slate-900 break-all">
                      {(() => {
                        const { folder, publicId } = computePaths(products[0]);
                        return `${folder}/${publicId}.jpg`;
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between">
              <button onClick={() => setCurrentStep('upload')} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">← Voltar</button>
              <button onClick={handleConfigSave} className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium">Salvar e continuar →</button>
            </div>
          </div>
        )}

        {currentStep === 'review' && (
          <div className="space-y-4">
            {batchSearch.running && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 flex items-center gap-4">
                <RefreshCw size={20} className="text-indigo-600 animate-spin flex-shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-indigo-900">Buscando imagens em lote...</div>
                  <div className="text-xs text-indigo-700 mt-0.5">Processando {batchSearch.current} de {batchSearch.total} produtos (8s entre cada)</div>
                  <div className="h-1.5 bg-indigo-100 rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-indigo-600 transition-all" style={{ width: `${(batchSearch.current / batchSearch.total) * 100}%` }} />
                  </div>
                </div>
                <button onClick={cancelBatchSearch} className="px-3 py-1.5 text-xs bg-white border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-100">Cancelar</button>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center gap-6 mb-4">
                <span className="text-sm text-slate-600">Total: <b>{stats.total}</b></span>
                <span className="text-sm text-emerald-700">Prontos: <b>{stats.done}</b></span>
                <span className="text-sm text-amber-700">Pendentes: <b>{stats.pending}</b></span>
                <div className="flex-1 bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full transition-all" style={{ width: `${stats.total ? (stats.done / stats.total * 100) : 0}%` }} />
                </div>
                {!batchSearch.running && stats.pending > 0 && (
                  <button onClick={batchSearchPending} className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-1.5 flex-shrink-0">
                    <Search size={14} /> Buscar pendentes ({stats.pending})
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input type="text" placeholder="Buscar..." value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                  <option value="all">Todos</option>
                  <option value="pending">Pendentes</option>
                  <option value="done">Prontos</option>
                </select>
                {mapping.fabricante && (
                  <select value={filter.fabricante} onChange={e => setFilter({ ...filter, fabricante: e.target.value })} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                    <option value="all">Todos fabricantes</option>
                    {fabricantes.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="divide-y divide-slate-100">
                {filtered.map(product => {
                  const { folder, publicId } = computePaths(product);
                  const hasImage = product._status === 'done';
                  return (
                    <div key={product._id} className="p-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-start gap-4">
                        <div className="w-20 h-20 bg-slate-100 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                          {hasImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.imagem_thumb as string} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          ) : (
                            <ImageIcon size={24} className="text-slate-300" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {hasImage ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs font-medium">
                                <Check size={12} /> Pronto
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-xs font-medium">Pendente</span>
                            )}
                            {mapping.codigo && <span className="text-xs text-slate-400 font-mono">{product[mapping.codigo] as string}</span>}
                          </div>
                          <div className="font-medium text-sm truncate">{product[mapping.nome] as string}</div>
                          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3">
                            {mapping.fabricante && product[mapping.fabricante] && <span>{product[mapping.fabricante] as string}</span>}
                            {mapping.categoria && product[mapping.categoria] && <span>• {product[mapping.categoria] as string}</span>}
                            {mapping.variante && product[mapping.variante] && <span>• {product[mapping.variante] as string}</span>}
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1 font-mono truncate flex items-center gap-1">
                            <Folder size={10} /> {folder}/{publicId}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {hasImage && (
                            <>
                              <button onClick={() => copyToClipboard(product.imagem_card as string)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg" title="Copiar URL card">
                                <Copy size={16} />
                              </button>
                              <button onClick={() => clearProductImage(product._id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg" title="Remover imagem">
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                          <button onClick={() => { setSelectedProduct(product); if (!searchResults[product._id]) searchImages(product); }} className={`px-3 py-2 text-white rounded-lg text-sm flex items-center gap-1.5 ${searchResults[product._id]?.length ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                            <Search size={14} /> {hasImage ? 'Trocar' : searchResults[product._id]?.length ? `Revisar (${searchResults[product._id].length})` : 'Buscar'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!filtered.length && (
                  <div className="p-12 text-center text-slate-400 text-sm">Nenhum produto com esses filtros</div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {selectedProduct && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedProduct(null)}>
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 flex items-start justify-between">
              <div>
                <h3 className="font-semibold">{selectedProduct[mapping.nome] as string}</h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  {mapping.fabricante && (selectedProduct[mapping.fabricante] as string)} {mapping.variante && selectedProduct[mapping.variante] ? `• ${selectedProduct[mapping.variante] as string}` : ''}
                </p>
                <p className="text-xs text-slate-400 font-mono mt-1">
                  {(() => {
                    const { folder, publicId } = computePaths(selectedProduct);
                    return `${folder}/${publicId}`;
                  })()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => searchImages(selectedProduct)} disabled={isSearching} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg disabled:opacity-40" title="Buscar novamente">
                  <RefreshCw size={16} className={isSearching ? 'animate-spin' : ''} />
                </button>
                <button onClick={() => setSelectedProduct(null)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg"><X size={16} /></button>
              </div>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-5">
              {isSearching ? (
                <div className="py-12 text-center text-slate-400">
                  <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
                  Buscando imagens...
                </div>
              ) : currentResults.length > 0 ? (
                <div>
                  <h4 className="font-medium text-sm mb-3">Imagens encontradas ({currentResults.length})</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {currentResults.map((img, i) => (
                      <div key={i} className={`border rounded-lg overflow-hidden relative bg-white ${img.oficial ? 'border-emerald-400 ring-2 ring-emerald-200' : 'border-slate-200'}`}>
                        {img.oficial && (
                          <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-semibold rounded shadow">
                            ✓ OFICIAL
                          </div>
                        )}
                        <div className="aspect-square flex items-center justify-center bg-slate-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt="" className="max-w-full max-h-full object-contain" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.opacity = '0.2'; }} />
                        </div>
                        <div className="p-2 bg-white border-t border-slate-100">
                          <p className="text-[10px] text-slate-400 truncate mb-1.5" title={img.source}>{img.source}</p>
                          <div className="flex gap-1">
                            <a href={img.url} target="_blank" rel="noopener noreferrer" className="p-1.5 border border-slate-300 rounded hover:bg-slate-50" title="Abrir em nova aba">
                              <Eye size={12} />
                            </a>
                            <button onClick={() => uploadToCloudinary(selectedProduct, img.url)} disabled={isUploading} className={`flex-1 px-2 py-1.5 text-white text-xs rounded disabled:opacity-40 ${img.oficial ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                              {isUploading ? 'Enviando...' : 'Usar esta'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-slate-400 text-sm">
                  <p className="mb-3">Nenhuma imagem encontrada ainda</p>
                  <button onClick={() => searchImages(selectedProduct)} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700">
                    <Search size={14} className="inline mr-1" /> Buscar agora
                  </button>
                </div>
              )}

              {(mapping.urlProduto && selectedProduct[mapping.urlProduto]) || (mapping.siteFornecedor && selectedProduct[mapping.siteFornecedor]) ? (
                <div className="border-t border-slate-200 pt-5 space-y-2">
                  {mapping.urlProduto && selectedProduct[mapping.urlProduto] && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="text-xs font-medium text-blue-900 mb-1">URL do produto:</div>
                      <a href={selectedProduct[mapping.urlProduto] as string} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-700 hover:underline break-all flex items-center gap-1">
                        <Eye size={12} /> {selectedProduct[mapping.urlProduto] as string}
                      </a>
                    </div>
                  )}
                  {mapping.siteFornecedor && selectedProduct[mapping.siteFornecedor] && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <div className="text-xs font-medium text-slate-700 mb-1">Site do fornecedor:</div>
                      <a href={selectedProduct[mapping.siteFornecedor] as string} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-600 hover:underline break-all flex items-center gap-1">
                        <Eye size={12} /> {selectedProduct[mapping.siteFornecedor] as string}
                      </a>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="border-t border-slate-200 pt-5">
                <h4 className="font-medium text-sm mb-2">Subir arquivo do computador</h4>
                <label className="block">
                  <input type="file" accept="image/*" onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) uploadLocalFile(selectedProduct, f);
                  }} className="hidden" />
                  <span className="inline-block px-4 py-2 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 text-sm">
                    <Upload size={14} className="inline mr-2" />
                    Escolher imagem
                  </span>
                </label>
              </div>

              <div>
                <h4 className="font-medium text-sm mb-2">Colar URL de imagem</h4>
                <div className="flex gap-2">
                  <input type="text" value={manualUrl} onChange={e => setManualUrl(e.target.value)} placeholder="https://..." className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                  <button onClick={() => { if (manualUrl.trim()) uploadToCloudinary(selectedProduct, manualUrl.trim()); }} disabled={isUploading || !manualUrl.trim()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-40">
                    {isUploading ? 'Enviando...' : 'Enviar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}