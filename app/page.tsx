'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Upload, Image as ImageIcon, Check, Copy, Folder, Trash2, Clock, X, Plus } from 'lucide-react';

// ============================================
// CONFIG HARDCODED
// ============================================
const CLOUDINARY_CLOUD_NAME = 'dzygfrpb6';
const CLOUDINARY_UPLOAD_PRESET = 'krr_suplementos';
const FOLDER_TEMPLATE = 'suplementos/{marca}/{categoria}';
const PUBLIC_ID_TEMPLATE = '{codigo}-{nome}-{variante}';
const CARD_VARIANT = 'f_auto,q_auto,c_fill,ar_1:1,w_600';

// ============================================
// STORAGE KEYS
// ============================================
const STORAGE_KEYS = {
  history: 'krr:history',
  marcas: 'krr:marcas',
  categorias: 'krr:categorias',
};

const HISTORY_LIMIT = 30;

// Categorias sugeridas já pré-populadas (baseadas no catálogo da KRR)
const DEFAULT_CATEGORIAS = [
  'amino', 'creatina', 'pretreino', 'hiper', 'whey', 'barras',
  'pasta', 'termo', 'vitaminas', 'bebidas', 'alimentos', 'acessorios',
];

// ============================================
// UTILS
// ============================================
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

function buildCardUrl(publicId: string, folder: string): string {
  const fullPath = folder ? `${folder}/${publicId}` : publicId;
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${CARD_VARIANT}/${fullPath}`;
}

// ============================================
// TYPES
// ============================================
interface FormState {
  codigo: string;
  nome: string;
  marca: string;
  categoria: string;
  peso: string;
  variante: string;
}

interface HistoryItem {
  id: string;
  timestamp: number;
  codigo: string;
  nome: string;
  marca: string;
  categoria: string;
  peso: string;
  variante: string;
  cardUrl: string;
  publicId: string;
}

const emptyForm: FormState = {
  codigo: '',
  nome: '',
  marca: '',
  categoria: '',
  peso: '',
  variante: '',
};

// ============================================
// AUTOCOMPLETE INPUT
// ============================================
function AutocompleteInput({
  label,
  value,
  onChange,
  suggestions,
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  required?: boolean;
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    if (!value.trim()) return suggestions.slice(0, 8);
    const v = value.toLowerCase();
    return suggestions.filter(s => s.toLowerCase().includes(v)).slice(0, 8);
  }, [value, suggestions]);

  return (
    <div ref={wrapperRef} className="relative">
      <label className="text-sm font-medium text-slate-700 block mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setShowSuggestions(true); }}
        onFocus={() => { setFocused(true); setShowSuggestions(true); }}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 border rounded-lg text-sm transition-colors ${
          focused ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-300'
        }`}
        autoComplete="off"
      />
      {showSuggestions && filtered.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {filtered.map(s => (
            <button
              key={s}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange(s); setShowSuggestions(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 border-b border-slate-100 last:border-0"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================
export default function CatalogImageManager() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastUpload, setLastUpload] = useState<HistoryItem | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [marcas, setMarcas] = useState<string[]>([]);
  const [categorias, setCategorias] = useState<string[]>(DEFAULT_CATEGORIAS);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // Carrega dados do localStorage
  useEffect(() => {
    try {
      const h = localStorage.getItem(STORAGE_KEYS.history);
      const m = localStorage.getItem(STORAGE_KEYS.marcas);
      const c = localStorage.getItem(STORAGE_KEYS.categorias);
      if (h) setHistory(JSON.parse(h));
      if (m) setMarcas(JSON.parse(m));
      if (c) {
        const parsed = JSON.parse(c);
        // Merge com defaults e dedup
        const merged = Array.from(new Set([...DEFAULT_CATEGORIAS, ...parsed])).sort();
        setCategorias(merged);
      }
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const showToast = (msg: string, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const previewPath = useMemo(() => {
    const folder = renderTemplate(FOLDER_TEMPLATE, {
      marca: form.marca,
      categoria: form.categoria,
    });
    const publicId = renderTemplate(PUBLIC_ID_TEMPLATE, {
      codigo: form.codigo,
      nome: form.nome,
      variante: form.variante,
    });
    return { folder, publicId, full: folder ? `${folder}/${publicId}` : publicId };
  }, [form]);

  const canUpload = form.codigo && form.nome && form.marca && form.categoria && file;

  const handleFileSelect = (f: File) => {
    if (!f.type.startsWith('image/')) {
      showToast('Selecione uma imagem válida', 'error');
      return;
    }
    setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelect(f);
  };

  const handleUpload = async () => {
    if (!canUpload) {
      showToast('Preencha todos os campos obrigatórios e selecione uma imagem', 'error');
      return;
    }
    setUploading(true);
    try {
      const { folder, publicId } = previewPath;
      const formData = new FormData();
      formData.append('file', file!);
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
      if (publicId) formData.append('public_id', publicId);
      if (folder) formData.append('folder', folder);

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
        { method: 'POST', body: formData }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      const realPublicId = data.public_id;
      const parts = realPublicId.split('/');
      const realFileName = parts.pop() as string;
      const realFolder = parts.join('/');
      const cardUrl = buildCardUrl(realFileName, realFolder);

      const item: HistoryItem = {
        id: `${Date.now()}-${realPublicId}`,
        timestamp: Date.now(),
        codigo: form.codigo,
        nome: form.nome,
        marca: form.marca,
        categoria: form.categoria,
        peso: form.peso,
        variante: form.variante,
        cardUrl,
        publicId: realPublicId,
      };

      // Atualiza histórico
      const newHistory = [item, ...history].slice(0, HISTORY_LIMIT);
      setHistory(newHistory);
      localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(newHistory));

      // Aprende marca e categoria
      if (form.marca && !marcas.includes(form.marca)) {
        const newMarcas = [...marcas, form.marca].sort();
        setMarcas(newMarcas);
        localStorage.setItem(STORAGE_KEYS.marcas, JSON.stringify(newMarcas));
      }
      if (form.categoria && !categorias.includes(form.categoria)) {
        const newCategorias = [...categorias, form.categoria].sort();
        setCategorias(newCategorias);
        localStorage.setItem(STORAGE_KEYS.categorias, JSON.stringify(newCategorias));
      }

      setLastUpload(item);
      setFile(null);
      // Mantém marca/categoria preenchidos pra agilizar próximo cadastro da mesma linha
      setForm(f => ({ ...emptyForm, marca: f.marca, categoria: f.categoria }));

      // Copia URL automaticamente
      try {
        await navigator.clipboard.writeText(cardUrl);
        showToast('Upload concluído — URL copiada!', 'success');
      } catch {
        showToast('Upload concluído', 'success');
      }
    } catch (err) {
      showToast('Erro: ' + (err as Error).message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast('URL copiada!', 'success');
    } catch {
      showToast('Erro ao copiar', 'error');
    }
  };

  const removeFromHistory = (id: string) => {
    const updated = history.filter(h => h.id !== id);
    setHistory(updated);
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(updated));
  };

  const clearHistory = () => {
    if (!window.confirm('Limpar todo o histórico?')) return;
    setHistory([]);
    localStorage.removeItem(STORAGE_KEYS.history);
    showToast('Histórico limpo', 'success');
  };

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'agora';
    if (mins < 60) return `${mins}min atrás`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h atrás`;
    const days = Math.floor(hours / 24);
    return `${days}d atrás`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-500">Carregando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white text-sm ${
          toast.type === 'error' ? 'bg-red-600' : toast.type === 'success' ? 'bg-emerald-600' : 'bg-slate-800'
        }`}>
          {toast.msg}
        </div>
      )}

      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
              <ImageIcon size={18} className="text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-lg">Catálogo KRR — Imagens</h1>
              <p className="text-xs text-slate-500">Cadastrar → Upload → Copiar URL → Colar na planilha</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COLUNA PRINCIPAL - FORMULÁRIO */}
        <div className="lg:col-span-2 space-y-6">
          {/* Último upload - destaque */}
          {lastUpload && (
            <div className="bg-white border-2 border-emerald-300 rounded-2xl p-5 shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center">
                    <Check size={16} className="text-emerald-700" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Último upload</h3>
                    <p className="text-xs text-slate-500">{lastUpload.codigo} — {lastUpload.nome}</p>
                  </div>
                </div>
                <button onClick={() => setLastUpload(null)} className="text-slate-400 hover:text-slate-600">
                  <X size={16} />
                </button>
              </div>
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={lastUpload.cardUrl} alt="" className="w-16 h-16 rounded-lg object-cover border border-slate-200" />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono text-slate-500 truncate mb-1">{lastUpload.cardUrl}</div>
                  <button
                    onClick={() => copyUrl(lastUpload.cardUrl)}
                    className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 flex items-center justify-center gap-2"
                  >
                    <Copy size={14} /> Copiar URL
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Formulário de cadastro */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="font-semibold text-lg mb-1">Cadastrar produto</h2>
            <p className="text-sm text-slate-500 mb-5">Preencha os dados e suba a imagem. Campos com * são obrigatórios.</p>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">
                  Código<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  type="text"
                  value={form.codigo}
                  onChange={e => setForm({ ...form, codigo: e.target.value })}
                  placeholder="Ex: 8988"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">
                  Nome<span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  type="text"
                  value={form.nome}
                  onChange={e => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex: Glutamine Platinum Series"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <AutocompleteInput
                label="Marca"
                required
                value={form.marca}
                onChange={v => setForm({ ...form, marca: v })}
                suggestions={marcas}
                placeholder="Ex: Adaptogen"
              />
              <AutocompleteInput
                label="Categoria"
                required
                value={form.categoria}
                onChange={v => setForm({ ...form, categoria: v })}
                suggestions={categorias}
                placeholder="Ex: amino"
              />
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Peso / Tamanho</label>
                <input
                  type="text"
                  value={form.peso}
                  onChange={e => setForm({ ...form, peso: e.target.value })}
                  placeholder="Ex: 300g"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Sabor (opcional)</label>
                <input
                  type="text"
                  value={form.variante}
                  onChange={e => setForm({ ...form, variante: e.target.value })}
                  placeholder="Ex: Tangerine"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
            </div>

            {/* Preview do path */}
            {previewPath.full && (
              <div className="bg-slate-50 rounded-lg p-3 mb-4 flex items-center gap-2">
                <Folder size={14} className="text-slate-400 flex-shrink-0" />
                <div className="text-xs font-mono text-slate-700 break-all">{previewPath.full}</div>
              </div>
            )}

            {/* Upload area */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                dragOver ? 'border-indigo-500 bg-indigo-50' : file ? 'border-emerald-400 bg-emerald-50' : 'border-slate-300'
              }`}
            >
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={URL.createObjectURL(file)} alt="" className="w-16 h-16 rounded object-cover" />
                  <div className="text-left flex-1">
                    <div className="text-sm font-medium text-slate-900 truncate max-w-xs">{file.name}</div>
                    <div className="text-xs text-slate-500">{(file.size / 1024).toFixed(0)} KB</div>
                  </div>
                  <button onClick={() => setFile(null)} className="p-2 text-slate-400 hover:text-red-500">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <label className="cursor-pointer block">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                    className="hidden"
                  />
                  <Upload size={24} className="mx-auto mb-2 text-slate-400" />
                  <div className="text-sm font-medium text-slate-700 mb-1">Arraste uma imagem ou clique para selecionar</div>
                  <div className="text-xs text-slate-500">JPG, PNG, WebP</div>
                </label>
              )}
            </div>

            <button
              onClick={handleUpload}
              disabled={!canUpload || uploading}
              className="w-full mt-4 px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {uploading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Enviando...</> : <><Plus size={16} /> Enviar para Cloudinary</>}
            </button>
          </div>
        </div>

        {/* COLUNA LATERAL - HISTÓRICO */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-slate-200 sticky top-24">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-slate-500" />
                <h3 className="font-semibold text-sm">Histórico ({history.length})</h3>
              </div>
              {history.length > 0 && (
                <button onClick={clearHistory} className="text-xs text-red-500 hover:text-red-700">
                  Limpar
                </button>
              )}
            </div>
            <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-100">
              {history.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">
                  Nenhum produto ainda.<br />Faça seu primeiro upload.
                </div>
              ) : (
                history.map(item => (
                  <div key={item.id} className="p-3 hover:bg-slate-50 group">
                    <div className="flex items-start gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.cardUrl} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0 border border-slate-200" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-slate-400">{item.codigo}</div>
                        <div className="text-sm font-medium truncate">{item.nome}</div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {item.marca} • {item.categoria}
                          {item.variante && ` • ${item.variante}`}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{formatTime(item.timestamp)}</div>
                      </div>
                      <button
                        onClick={() => removeFromHistory(item.id)}
                        className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="mt-2 flex gap-1">
                      <button
                        onClick={() => copyUrl(item.cardUrl)}
                        className="flex-1 px-2 py-1.5 bg-slate-100 text-slate-700 rounded text-xs hover:bg-slate-200 flex items-center justify-center gap-1"
                      >
                        <Copy size={10} /> Copiar URL
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}