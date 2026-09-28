import React, { useState, useEffect, useRef, useCallback } from 'react';
import './index.css';
import { FilterGuide } from './components/FilterGuide';
import CreatableSelect from 'react-select/creatable';

type FilterRule = { type: string; value: string; isInclude: boolean };
type BrowserTab = 'interactive' | 'preview';
type DetectedCategories = Record<string, string[]>;

const COMMON_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico', '.avif', '.tiff',
  '.mp4', '.webm', '.avi', '.mov', '.mkv', '.m4v',
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.rar',
  '.gltf', '.glb', '.obj', '.fbx', '.stl', '.ply',
  '.js', '.css', '.woff', '.woff2', '.ttf', '.otf',
  '.json', '.xml', '.wasm', '.yaml', '.html', '.xhtml'
];

const EXTENSION_OPTIONS = COMMON_EXTENSIONS.map(ext => ({ value: ext, label: ext }));

const CAT_ICONS: Record<string, string> = {
  'Images': '🖼️', '3D Models': '🎮', 'Video': '🎬', 'Audio': '🎵',
  'Documents': '📄', 'Fonts': '🔤', 'Web Assets': '⚙️', 'Data': '📊', 'Other': '📦'
};

const selectStyles = {
  control: (p: any) => ({ ...p, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', boxShadow: 'none', minHeight: '40px', '&:hover': { border: '1px solid rgba(255,255,255,0.3)' } }),
  menu: (p: any) => ({ ...p, background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', zIndex: 200 }),
  option: (p: any, s: any) => ({ ...p, background: s.isFocused ? 'rgba(59,130,246,0.5)' : 'transparent', color: 'white', cursor: 'pointer' }),
  singleValue: (p: any) => ({ ...p, color: 'white' }),
  input: (p: any) => ({ ...p, color: 'white' }),
};

export default function App() {
  const [step, setStep] = useState(1);
  const [targetUrl, setTargetUrl] = useState('https://hiryakos-portfolio.vercel.app/');
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [preview, setPreview] = useState<{ allowed: string[]; blocked: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DetectedCategories | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [maxPages, setMaxPages] = useState(1);
  const [sameOriginOnly, setSameOriginOnly] = useState(true);
  const [targetSelector, setTargetSelector] = useState('');
  const [isPicking, setIsPicking] = useState(false);
  const [browserTab, setBrowserTab] = useState<BrowserTab>('interactive');
  const [jobStatus, setJobStatus] = useState('');
  const [downloadReady, setDownloadReady] = useState(false);
  const [jobStats, setJobStats] = useState<{ resources?: number } | null>(null);
  const [isHovering, setIsHovering] = useState(false);

  // WS Interactive browser
  const [wsConnected, setWsConnected] = useState(false);
  const [wsLoading, setWsLoading] = useState(false);
  const [browserFrame, setBrowserFrame] = useState<string | null>(null);
  const [sessionResourceCount, setSessionResourceCount] = useState<number>(0);
  const [navUrl, setNavUrl] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const imgRef = useRef<HTMLDivElement>(null);
  const lastMouseMoveRef = useRef<number>(0);

  // ── Filters ────────────────────────────────────────────────────────────────
  const addFilter = () => setFilters(f => [...f, { type: 'extension', value: '.png', isInclude: true }]);
  const updateFilter = (i: number, field: keyof FilterRule, val: any) =>
    setFilters(f => { const n = [...f]; n[i] = { ...n[i], [field]: val }; return n; });
  const removeFilter = (i: number) => setFilters(f => f.filter((_, idx) => idx !== i));

  // ── Auto-detect file types ─────────────────────────────────────────────────
  const runAutoDetect = async () => {
    setDetecting(true);
    setDetected(null);
    try {
      const res = await fetch('http://localhost:3000/api/detect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else setDetected(data.detected);
    } catch { alert('Could not reach backend.'); }
    setDetecting(false);
  };

  // Add all extensions from a detected category as include filters
  const addCategoryFilters = (exts: string[]) => {
    const newFilters: FilterRule[] = exts
      .filter(ext => !filters.some(f => f.type === 'extension' && f.value === ext))
      .map(ext => ({ type: 'extension', value: ext, isInclude: true }));
    setFilters(f => [...f, ...newFilters]);
  };

  // Add ALL detected types at once
  const addAllDetected = () => {
    if (!detected) return;
    const allExts = Object.values(detected).flat();
    addCategoryFilters(allExts);
  };

  // ── Poll job status ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeJobId || downloadReady) return;
    const interval = setInterval(async () => {
      try {
        const jobs = await fetch('http://localhost:3000/api/jobs').then(r => r.json());
        const job = jobs.find((j: any) => j.id === activeJobId);
        if (job) {
          setJobStatus(job.status);
          if (job.status === 'completed' || job.status === 'failed') {
            setDownloadReady(true);
            clearInterval(interval);
          }
        }
      } catch {}
    }, 2000);
    return () => clearInterval(interval);
  }, [activeJobId, downloadReady]);

  // ── Live preview ────────────────────────────────────────────────────────────
  const runPreview = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, filters, maxPages: Math.min(maxPages, 5), targetSelector: targetSelector.trim() || undefined })
      });
      const data = await res.json();
      if (data.error) alert(data.error); else setPreview(data);
    } catch { alert('Backend not reachable.'); }
    setLoading(false);
  };

  // ── Start job ───────────────────────────────────────────────────────────────
  const startJob = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startUrl: targetUrl, filters, maxPages, sameOriginOnly, targetSelector: targetSelector.trim() || undefined })
      });
      const data = await res.json();
      setActiveJobId(data.id);
      setJobStatus('running');
      setDownloadReady(false);
      setJobStats(null);
      setStep(3);
    } catch { alert('Failed to start job.'); }
  };

  // ── WebSocket Browser ────────────────────────────────────────────────────────
  const connectBrowser = useCallback(() => {
    wsRef.current?.close();
    setWsLoading(true);
    setSessionResources([]);
    setBrowserFrame(null);
    setNavUrl(targetUrl);

    const ws = new WebSocket('ws://localhost:3000/api/browser/session');
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      setWsLoading(false);
      ws.send(JSON.stringify({ type: 'start', url: targetUrl }));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'screenshot') {
        setBrowserFrame(`data:image/jpeg;base64,${msg.data}`);
        if (msg.resourceCount !== undefined) setSessionResourceCount(msg.resourceCount);
      }
      else if (msg.type === 'navigated') setNavUrl(msg.url);
      else if (msg.type === 'loading') setBrowserFrame(null);
      else if (msg.type === 'picked_selector') {
        setTargetSelector(msg.selector);
        setIsPicking(false);
      }
    };
    ws.onclose = () => { setWsConnected(false); setBrowserFrame(null); setWsLoading(false); setIsPicking(false); };
    ws.onerror = () => { setWsLoading(false); setWsConnected(false); setIsPicking(false); alert('Interactive browser failed to connect. Make sure the backend (npm run dev) is running.'); };
  }, [targetUrl]);

  const disconnectBrowser = () => { wsRef.current?.close(); setWsConnected(false); setBrowserFrame(null); };

  const sendWs = (msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  };

  const handleImgClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    
    // Playwright viewport is 1280x720
    const imgRatio = 1280 / 720;
    const containerRatio = rect.width / rect.height;

    let renderWidth = rect.width;
    let renderHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (containerRatio > imgRatio) {
      // Container is wider than the image (pillarboxing - black bars on left/right)
      renderWidth = rect.height * imgRatio;
      offsetX = (rect.width - renderWidth) / 2;
    } else {
      // Container is taller than the image (letterboxing - black bars on top/bottom)
      renderHeight = rect.width / imgRatio;
      offsetY = (rect.height - renderHeight) / 2;
    }

    const clickX = e.clientX - rect.left - offsetX;
    const clickY = e.clientY - rect.top - offsetY;

    // Ignore clicks outside the actual image area (on the black bars)
    if (clickX < 0 || clickX > renderWidth || clickY < 0 || clickY > renderHeight) {
      return;
    }

    const xPct = (clickX / renderWidth) * 100;
    const yPct = (clickY / renderHeight) * 100;

    if (isPicking) {
      sendWs({ type: 'pick_element', x: xPct, y: yPct });
    } else {
      sendWs({ type: 'click', x: xPct, y: yPct });
    }
  };

  const handleImgMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPicking) return; // Only forward mouse moves when picking
    const now = Date.now();
    if (now - lastMouseMoveRef.current < 100) return; // Throttle to 10fps
    lastMouseMoveRef.current = now;

    const rect = e.currentTarget.getBoundingClientRect();
    
    const imgRatio = 1280 / 720;
    const containerRatio = rect.width / rect.height;

    let renderWidth = rect.width;
    let renderHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (containerRatio > imgRatio) {
      renderWidth = rect.height * imgRatio;
      offsetX = (rect.width - renderWidth) / 2;
    } else {
      renderHeight = rect.width / imgRatio;
      offsetY = (rect.height - renderHeight) / 2;
    }

    const moveX = e.clientX - rect.left - offsetX;
    const moveY = e.clientY - rect.top - offsetY;

    if (moveX < 0 || moveX > renderWidth || moveY < 0 || moveY > renderHeight) return;

    const xPct = (moveX / renderWidth) * 100;
    const yPct = (moveY / renderHeight) * 100;

    sendWs({ type: 'highlight_element', x: xPct, y: yPct });
  };

  const handleScroll = (e: React.WheelEvent) => {
    sendWs({ type: 'scroll', deltaY: e.deltaY });
  };

  const maxPagesDisplay = maxPages >= 1000 ? '1000+ (Full Site)' : `${maxPages} page${maxPages > 1 ? 's' : ''}`;
  const progressPct = jobStatus === 'completed' ? 100 : jobStatus === 'running' ? 60 : jobStatus === 'failed' ? 100 : 10;
  const progressColor = jobStatus === 'failed' ? '#ef4444' : 'linear-gradient(90deg, #3b82f6, #60a5fa)';

  return (
    <div style={{ maxWidth: '1400px', margin: '40px auto', padding: '0 20px' }}>
      <header style={{ textAlign: 'center', marginBottom: '30px' }}>
        <h1 className="gradient-text" style={{ fontSize: '2.8rem', marginBottom: '6px' }}>🌐 NetHarvest</h1>
        <p style={{ color: 'var(--text-muted)' }}>Intercept. Filter. Download. Any website, any resource.</p>
        {/* Step progress dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '16px' }}>
          {[1, 2, 3].map(s => (
            <div key={s} onClick={() => s < step && setStep(s)} style={{
              width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: step === s ? '#3b82f6' : step > s ? '#4ade80' : 'rgba(255,255,255,0.1)',
              color: 'white', fontWeight: 'bold', fontSize: '0.85rem',
              cursor: s < step ? 'pointer' : 'default',
              border: step === s ? '2px solid #60a5fa' : '2px solid transparent',
              transition: 'all 0.3s'
            }}>{step > s ? '✓' : s}</div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '32px', marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span style={{ color: step >= 1 ? '#60a5fa' : undefined }}>Target</span>
          <span style={{ color: step >= 2 ? '#60a5fa' : undefined }}>Filters</span>
          <span style={{ color: step >= 3 ? '#60a5fa' : undefined }}>Download</span>
        </div>
      </header>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>

        {/* ── LEFT PANEL ── */}
        <div className="glass-card" style={{ flex: '1', minWidth: '400px', maxWidth: '600px', display: 'flex', flexDirection: 'column' }}>

          {/* STEP 1 */}
          {step === 1 && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2>⚙️ Step 1: Define Target</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: '16px', fontSize: '0.9rem' }}>
                Enter your URL. Use the interactive browser on the right to login or navigate before starting.
              </p>

              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>🌐 Target URL</label>
              <input className="input-glass" value={targetUrl} onChange={e => { setTargetUrl(e.target.value); setDetected(null); }}
                placeholder="https://example.com" style={{ marginBottom: '16px' }} />

              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span>🎯 Target Specific Section (Optional)</span>
                {wsConnected && (
                  <button onClick={() => { 
                    if (isPicking) {
                      setIsPicking(false);
                      sendWs({ type: 'clear_highlight' });
                    } else {
                      setIsPicking(true);
                    }
                  }} style={{
                    background: isPicking ? 'rgba(239,68,68,0.3)' : 'rgba(59,130,246,0.2)', color: 'white', border: isPicking ? '1px solid rgba(239,68,68,0.5)' : 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.75rem', cursor: 'pointer'
                  }}>
                    {isPicking ? 'Cancel Picking' : '🎯 Pick from Browser'}
                  </button>
                )}
              </label>
              <input className="input-glass" value={targetSelector} onChange={e => setTargetSelector(e.target.value)}
                placeholder="e.g. .card-container or #gallery" style={{ marginBottom: '20px' }} />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '-12px', marginBottom: '20px' }}>
                {isPicking ? <span style={{ color: '#60a5fa' }}>Hover over the interactive browser on the right and click the container you want.</span> : 'Only scroll and extract images/media from this specific CSS selector instead of the whole page.'}
              </p>

              {/* Multi-page crawl */}
              <div style={{ padding: '16px', background: 'rgba(59,130,246,0.06)', borderRadius: '10px', border: '1px solid rgba(59,130,246,0.2)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <h3 style={{ margin: 0, color: '#60a5fa', fontSize: '0.95rem' }}>🔗 Multi-Page Crawl</h3>
                  <span style={{ color: '#60a5fa', fontWeight: 'bold', fontSize: '0.9rem' }}>{maxPagesDisplay}</span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 10px 0' }}>
                  How many pages to crawl. 3 concurrent browser tabs run in parallel for speed.
                </p>
                <input type="range" min={1} max={1000} value={maxPages} onChange={e => setMaxPages(Number(e.target.value))} style={{ width: '100%', marginBottom: '6px' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
                  <span>1</span><span>100</span><span>500</span><span>1000</span>
                </div>
                {maxPages > 50 && (
                  <div style={{ padding: '8px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '6px', fontSize: '0.8rem', color: '#fbbf24', marginBottom: '10px' }}>
                    ⚠️ {maxPages > 200 ? 'Very large crawl — may take 10–60 minutes.' : 'Large crawl — may take several minutes.'}
                  </div>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={sameOriginOnly} onChange={e => setSameOriginOnly(e.target.checked)} style={{ accentColor: '#3b82f6' }} />
                  <span style={{ color: 'var(--text-muted)' }}>Stay on same domain only</span>
                </label>
              </div>

              <button className="btn-primary" style={{ width: '100%' }} onClick={() => setStep(2)}>
                Next: Configure Filters ➔
              </button>
            </div>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2>🎛️ Step 2: Filters</h2>

              {/* ✨ AUTO-DETECT PANEL ✨ */}
              <div style={{ padding: '16px', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: '10px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <h3 style={{ margin: 0, color: '#a78bfa', fontSize: '0.95rem' }}>✨ Smart Auto-Detect</h3>
                    <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Scans the page and finds ALL file types automatically.
                    </p>
                  </div>
                  <button onClick={runAutoDetect} disabled={detecting} style={{
                    padding: '8px 14px', background: detecting ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.4)',
                    border: '1px solid rgba(139,92,246,0.5)', color: 'white', borderRadius: '8px',
                    cursor: detecting ? 'not-allowed' : 'pointer', fontSize: '0.85rem', whiteSpace: 'nowrap'
                  }}>
                    {detecting ? '🔍 Scanning...' : '🔍 Auto-Detect'}
                  </button>
                </div>

                {detected && (
                  <div style={{ animation: 'fadeIn 0.3s ease' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '0.85rem', color: '#4ade80' }}>Found {Object.keys(detected).length} categories:</span>
                      <button onClick={addAllDetected} style={{
                        padding: '4px 10px', background: 'rgba(74,222,128,0.2)', border: '1px solid rgba(74,222,128,0.4)',
                        color: '#4ade80', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem'
                      }}>+ Add All</button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {Object.entries(detected).map(([cat, exts]) => (
                        <button key={cat} onClick={() => addCategoryFilters(exts)} style={{
                          padding: '5px 10px', background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)',
                          color: 'white', borderRadius: '20px', cursor: 'pointer', fontSize: '0.8rem',
                          display: 'flex', alignItems: 'center', gap: '4px'
                        }}>
                          {CAT_ICONS[cat] ?? '📦'} {cat} ({exts.length})
                        </button>
                      ))}
                    </div>
                    <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Click a category to add those filters, or "Add All" to select everything.
                    </p>
                  </div>
                )}
              </div>

              {/* Manual filters */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Active Filters</h3>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {filters.length > 0 && (
                      <button onClick={() => setFilters([])} style={{
                        padding: '5px 10px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
                        color: '#ef4444', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem'
                      }}>Clear All</button>
                    )}
                    <button onClick={addFilter} className="btn-primary" style={{ padding: '5px 12px', fontSize: '0.85rem' }}>+ Add</button>
                  </div>
                </div>

                {filters.length === 0 ? (
                  <div style={{ padding: '12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '8px', fontSize: '0.85rem', color: '#fbbf24' }}>
                    ⚠️ No filters — all network requests will be downloaded. Use Auto-Detect or add filters to be selective.
                  </div>
                ) : (
                  filters.map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '8px', background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '8px', alignItems: 'center' }}>
                      <select className="input-glass" style={{ flex: 1, padding: '7px', fontSize: '0.8rem' }} value={f.isInclude ? 'include' : 'exclude'} onChange={e => updateFilter(i, 'isInclude', e.target.value === 'include')}>
                        <option value="include">✅ Include</option>
                        <option value="exclude">❌ Exclude</option>
                      </select>
                      <select className="input-glass" style={{ flex: 1, padding: '7px', fontSize: '0.8rem' }} value={f.type} onChange={e => updateFilter(i, 'type', e.target.value)}>
                        <option value="extension">Extension</option>
                        <option value="contains">Contains</option>
                        <option value="starts_with">Starts with</option>
                        <option value="ends_with">Ends with</option>
                        <option value="regex">Regex</option>
                      </select>
                      {f.type === 'extension' ? (
                        <div style={{ flex: 2, minWidth: 0 }}>
                          <CreatableSelect isClearable styles={selectStyles} options={EXTENSION_OPTIONS}
                            value={f.value ? { value: f.value, label: f.value } : null}
                            onChange={(s: any) => updateFilter(i, 'value', s ? s.value : '')}
                            placeholder="Search..." />
                        </div>
                      ) : (
                        <input className="input-glass" style={{ flex: 2, padding: '7px', fontSize: '0.85rem' }} value={f.value}
                          onChange={e => updateFilter(i, 'value', e.target.value)} placeholder="Value..." />
                      )}
                      <button onClick={() => removeFilter(i)}
                        style={{ background: 'rgba(239,68,68,0.3)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)', padding: '7px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>✕</button>
                    </div>
                  ))
                )}
              </div>

              {/* Filter Guide */}
              <FilterGuide />

              {/* Live tester */}
              <div style={{ padding: '14px', background: 'rgba(59,130,246,0.05)', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)', marginBottom: '16px', marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ margin: 0, fontWeight: 'bold', color: '#60a5fa', fontSize: '0.9rem' }}>🔍 Live Network Tester</p>
                    <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>Dry-run (no download). Max 5 pages for preview.</p>
                  </div>
                  <button className="btn-primary" onClick={runPreview} disabled={loading} style={{ padding: '7px 14px', fontSize: '0.85rem' }}>
                    {loading ? '⏳ Scanning...' : 'Test Rules'}
                  </button>
                </div>
                {preview && (
                  <div style={{ marginTop: '10px', animation: 'fadeIn 0.3s ease' }}>
                    <p style={{ color: '#4ade80', margin: '0 0 4px', fontSize: '0.85rem', fontWeight: 'bold' }}>✅ {preview.allowed.length} will download</p>
                    <p style={{ color: '#ef4444', margin: '0 0 8px', fontSize: '0.85rem', fontWeight: 'bold' }}>❌ {preview.blocked.length} blocked</p>
                    <div style={{ maxHeight: '150px', overflowY: 'auto', fontSize: '0.75rem', background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '6px' }}>
                      {preview.allowed.slice(0, 50).map((url, i) => <div key={`a-${i}`} style={{ color: '#a7f3d0', marginBottom: '2px' }}>✅ {url}</div>)}
                      {preview.blocked.slice(0, 20).map((url, i) => <div key={`b-${i}`} style={{ color: '#fca5a5', marginBottom: '2px', opacity: 0.7 }}>❌ {url}</div>)}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--glass-border)', flex: 1 }} onClick={() => setStep(1)}>← Back</button>
                <button className="btn-primary" style={{ flex: 2 }} onClick={startJob}>▶ Start Extraction</button>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2>📦 Extraction Job</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '4px' }}>ID: <code style={{ color: '#60a5fa', fontSize: '0.75rem' }}>{activeJobId}</code></p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '20px' }}>
                Crawling <strong style={{ color: 'white' }}>{maxPagesDisplay}</strong> on <strong style={{ color: '#60a5fa' }}>{targetUrl}</strong>
              </p>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Status</span>
                <span style={{ fontWeight: 'bold', color: jobStatus === 'completed' ? '#4ade80' : jobStatus === 'failed' ? '#ef4444' : '#60a5fa', textTransform: 'capitalize' }}>
                  {jobStatus === 'running' ? '⏳ Crawling...' : jobStatus === 'completed' ? '✅ Complete' : jobStatus === 'failed' ? '❌ Failed' : jobStatus}
                </span>
              </div>
              <div style={{ height: '10px', background: 'rgba(15,23,42,0.8)', borderRadius: '6px', overflow: 'hidden', marginBottom: '20px' }}>
                <div style={{ height: '100%', width: `${progressPct}%`, background: progressColor, transition: 'width 0.5s ease', animation: jobStatus === 'running' ? 'pulse 1.5s infinite' : 'none' }} />
              </div>

              {!downloadReady && jobStatus === 'running' && (
                <div style={{ padding: '12px', background: 'rgba(59,130,246,0.08)', borderRadius: '8px', marginBottom: '16px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  ⏳ Playwright is crawling the site in the background using 3 concurrent tabs.
                  {maxPages > 10 && ` Expect ${Math.round(maxPages * 0.3 / 3)} – ${Math.round(maxPages * 0.8 / 3)} minutes for ${maxPages} pages.`}
                </div>
              )}

              {downloadReady && jobStatus === 'completed' && (
                <button className="btn-primary"
                  onClick={() => window.location.href = `http://localhost:3000/api/jobs/${activeJobId}/download`}
                  style={{ width: '100%', padding: '16px', fontSize: '1.1rem', marginBottom: '12px', transform: isHovering ? 'scale(1.02)' : 'scale(1)', transition: 'transform 0.2s' }}
                  onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)}>
                  📦 Download ZIP Archive
                </button>
              )}

              {jobStatus === 'failed' && (
                <div style={{ padding: '12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', marginBottom: '12px', color: '#ef4444', fontSize: '0.85rem' }}>
                  ❌ Job failed. Check the URL is reachable and try again.
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--glass-border)', flex: 1 }} onClick={() => { setStep(2); setDownloadReady(false); }}>← Filters</button>
                <button className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--glass-border)', flex: 1 }} onClick={() => { setStep(1); setDownloadReady(false); }}>🔄 New Job</button>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL: Browser ── */}
        <div className="glass-card" style={{ flex: 1.2, display: 'flex', flexDirection: 'column', minHeight: '640px', minWidth: 0 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
            {(['interactive', 'preview'] as BrowserTab[]).map(tab => (
              <button key={tab} onClick={() => setBrowserTab(tab)} style={{
                padding: '7px 16px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                background: browserTab === tab ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.05)',
                color: browserTab === tab ? '#60a5fa' : 'var(--text-muted)',
                fontWeight: browserTab === tab ? '600' : '400', fontSize: '0.875rem',
                borderBottom: browserTab === tab ? '2px solid #3b82f6' : '2px solid transparent'
              }}>
                {tab === 'interactive' ? '🖱️ Interactive Browser' : '🔍 Quick Preview'}
              </button>
            ))}
          </div>

          {/* INTERACTIVE TAB */}
          {browserTab === 'interactive' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                {!wsConnected ? (
                  <button className="btn-primary" onClick={connectBrowser} disabled={wsLoading} style={{ padding: '9px 18px' }}>
                    {wsLoading ? '⏳ Launching Chromium...' : '🚀 Launch Interactive Browser'}
                  </button>
                ) : (
                  <>
                    <input className="input-glass" value={navUrl} onChange={e => setNavUrl(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendWs({ type: 'navigate', url: navUrl })}
                      placeholder="Navigate to URL..." style={{ flex: 1, padding: '8px 12px', minWidth: '200px' }} />
                    <button className="btn-primary" onClick={() => sendWs({ type: 'navigate', url: navUrl })} style={{ padding: '8px 14px', fontSize: '0.85rem' }}>Go →</button>
                    <div style={{ padding: '8px 12px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', borderRadius: '6px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="pulse-dot" style={{ width: '8px', height: '8px', background: '#10b981', borderRadius: '50%', display: 'inline-block' }}></span>
                      📡 {sessionResourceCount} Files Captured
                    </div>
                    <button onClick={disconnectBrowser} style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
                  </>
                )}
              </div>

              {wsConnected && (
                <div style={{ padding: '7px 12px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '6px', marginBottom: '10px', fontSize: '0.8rem', color: '#4ade80' }}>
                  🟢 Live — Click to click · Type to type · Scroll to scroll · Login freely · Press Enter in nav bar to navigate
                </div>
              )}

              {/* Viewport */}
              <div ref={imgRef} onClick={handleImgClick} onMouseMove={handleImgMouseMove} onWheel={handleScroll}
                tabIndex={0} onKeyDown={e => { e.preventDefault(); sendWs({ type: 'key', key: e.key }); }}
                style={{
                  flex: 1, background: 'rgba(0,0,0,0.3)', borderRadius: '10px',
                  border: wsConnected ? (isPicking ? '2px solid #4ade80' : '2px solid rgba(59,130,246,0.4)') : '1px solid rgba(255,255,255,0.08)',
                  overflow: 'hidden', cursor: wsConnected ? (isPicking ? 'crosshair' : 'default') : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  minHeight: '480px', outline: 'none', position: 'relative'
                }}>
                {browserFrame ? (
                  <img src={browserFrame} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} alt="Live browser" draggable={false} />
                ) : wsLoading ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '10px', animation: 'pulse 1.5s infinite' }}>⏳</div>
                    <p>Launching Chromium browser...</p>
                    <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>This takes ~5 seconds</p>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                    <div style={{ fontSize: '4rem', marginBottom: '14px' }}>🖥️</div>
                    <p style={{ fontSize: '1.1rem', marginBottom: '6px', color: 'white' }}>Interactive Browser</p>
                    <p style={{ fontSize: '0.85rem', marginBottom: '20px' }}>
                      Real Chromium browser — navigate anywhere, login to protected sites, scroll to load lazy content.
                      Everything you see is tracked and captured.
                    </p>
                    <button className="btn-primary" onClick={connectBrowser}>🚀 Launch Browser</button>
                  </div>
                )}
              </div>

              </div>
          )}

          {/* PREVIEW TAB */}
          {browserTab === 'preview' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '8px 12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '6px', marginBottom: '12px', fontSize: '0.8rem', color: '#fbbf24' }}>
                ⚠️ Read-only iframe — some sites block embedding. Switch to <strong>Interactive Browser</strong> to login, navigate, and interact fully.
              </div>
              <div style={{ flex: 1, background: '#fff', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.2)', minHeight: '520px' }}>
                <iframe src={targetUrl} style={{ width: '100%', height: '100%', border: 'none', minHeight: '520px' }}
                  title="Quick Preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
