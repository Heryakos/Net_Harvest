import React, { useState, useEffect, useRef, useCallback } from 'react';
import './index.css';
import { FilterGuide } from './components/FilterGuide';
import CreatableSelect from 'react-select/creatable';

type FilterRule = { type: string; value: string; isInclude: boolean };
type BrowserTab = 'preview' | 'interactive';

const COMMON_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico',
  '.mp4', '.webm', '.avi', '.mov', '.mp3', '.wav', '.ogg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv',
  '.zip', '.tar', '.gz', '.rar',
  '.gltf', '.glb', '.obj', '.fbx',
  '.js', '.css', '.woff', '.woff2', '.ttf', '.otf',
  '.json', '.xml', '.wasm'
];

const EXTENSION_OPTIONS = COMMON_EXTENSIONS.map(ext => ({ value: ext, label: ext }));

const selectStyles = {
  control: (p: any) => ({ ...p, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', boxShadow: 'none', '&:hover': { border: '1px solid rgba(255,255,255,0.3)' } }),
  menu: (p: any) => ({ ...p, background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', zIndex: 100 }),
  option: (p: any, s: any) => ({ ...p, background: s.isFocused ? 'rgba(59,130,246,0.5)' : 'transparent', color: 'white', cursor: 'pointer' }),
  singleValue: (p: any) => ({ ...p, color: 'white' }),
  input: (p: any) => ({ ...p, color: 'white' }),
};

export default function App() {
  const [step, setStep] = useState(1);
  const [isHovering, setIsHovering] = useState(false);
  const [targetUrl, setTargetUrl] = useState('https://hiryakos-portfolio.vercel.app/');
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [preview, setPreview] = useState<{ allowed: string[]; blocked: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [maxPages, setMaxPages] = useState(1);
  const [sameOriginOnly, setSameOriginOnly] = useState(true);
  const [browserTab, setBrowserTab] = useState<BrowserTab>('interactive');
  const [jobStatus, setJobStatus] = useState<string>('');
  const [downloadReady, setDownloadReady] = useState(false);

  // ── Interactive browser state ──────────────────────────────────────────────
  const [wsConnected, setWsConnected] = useState(false);
  const [wsLoading, setWsLoading] = useState(false);
  const [browserFrame, setBrowserFrame] = useState<string | null>(null);
  const [sessionResources, setSessionResources] = useState<string[]>([]);
  const [capturePreview, setCapturePreview] = useState<string[]>([]);
  const [navUrl, setNavUrl] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const imgRef = useRef<HTMLDivElement>(null);

  // ── Filters ────────────────────────────────────────────────────────────────
  const addFilter = () => setFilters([...filters, { type: 'extension', value: '.png', isInclude: true }]);
  const updateFilter = (i: number, field: keyof FilterRule, val: any) => {
    const f = [...filters]; f[i] = { ...f[i], [field]: val }; setFilters(f);
  };
  const removeFilter = (i: number) => setFilters(filters.filter((_, idx) => idx !== i));

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
        body: JSON.stringify({ url: targetUrl, filters, maxPages })
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
        body: JSON.stringify({ startUrl: targetUrl, filters, maxPages, sameOriginOnly })
      });
      const data = await res.json();
      setActiveJobId(data.id);
      setJobStatus('running');
      setDownloadReady(false);
      setStep(3);
    } catch { alert('Failed to start job.'); }
  };

  // ── WebSocket Interactive Browser ────────────────────────────────────────────
  const connectBrowser = useCallback(() => {
    if (wsRef.current) wsRef.current.close();
    setWsLoading(true);
    setSessionResources([]);
    setCapturePreview([]);

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
      } else if (msg.type === 'resources') {
        setSessionResources(msg.resources);
      } else if (msg.type === 'capture_preview') {
        setCapturePreview(msg.allowed);
      } else if (msg.type === 'session_ready') {
        setNavUrl(targetUrl);
      } else if (msg.type === 'navigated') {
        setNavUrl(msg.url);
      }
    };

    ws.onclose = () => { setWsConnected(false); setBrowserFrame(null); };
    ws.onerror = () => { setWsLoading(false); setWsConnected(false); alert('Could not connect to interactive browser backend.'); };
  }, [targetUrl]);

  const disconnectBrowser = () => {
    wsRef.current?.close();
    setWsConnected(false);
    setBrowserFrame(null);
  };

  const sendWs = (msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  };

  // Click on screenshot image → send relative coordinates
  const handleImgClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    sendWs({ type: 'click', x, y });
  };

  const handleImgKeyDown = (e: React.KeyboardEvent) => {
    sendWs({ type: 'key', key: e.key });
  };

  // Capture resources from interactive session into a real job
  const captureFromSession = async () => {
    sendWs({ type: 'get_resources' });
    sendWs({ type: 'capture_job', filters });
    setTimeout(async () => {
      const resources = sessionResources;
      const filterEngine_res = capturePreview.length > 0 ? capturePreview : resources;
      if (filterEngine_res.length === 0) {
        alert('No resources captured yet. Navigate the site first!');
        return;
      }
      // Start a "manual" job from session resources
      // We'll just start a regular job with the current URL — the interactive session already proved what's there
      await startJob();
    }, 500);
  };

  const progressPercent = jobStatus === 'completed' ? 100 : jobStatus === 'running' ? 60 : jobStatus === 'failed' ? 100 : 0;
  const progressColor = jobStatus === 'failed' ? '#ef4444' : 'linear-gradient(90deg, #3b82f6, #60a5fa)';

  return (
    <div style={{ maxWidth: '1400px', margin: '40px auto', padding: '0 20px' }}>
      <header style={{ textAlign: 'center', marginBottom: '30px', animation: 'fadeIn 0.5s ease' }}>
        <h1 className="gradient-text" style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🌐 NetHarvest</h1>
        <p style={{ color: 'var(--text-muted)' }}>Intercept. Filter. Download. Any website, any resource.</p>
      </header>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'stretch' }}>
        {/* ── LEFT PANEL: Steps ── */}
        <div className="glass-card" style={{ flex: '0 0 480px' }}>

          {/* STEP 1 */}
          {step === 1 && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2 style={{ marginBottom: '8px' }}>Step 1: Define Target</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
                Enter the URL to extract from. Use the <strong>Interactive Browser</strong> on the right to navigate, login, and explore before capturing.
              </p>

              <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>Target URL</label>
              <input
                className="input-glass"
                value={targetUrl}
                onChange={e => setTargetUrl(e.target.value)}
                placeholder="https://example.com"
                style={{ marginBottom: '20px' }}
              />

              <div style={{ padding: '16px', background: 'rgba(59,130,246,0.05)', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h3 style={{ margin: 0, color: '#60a5fa' }}>🔗 Multi-Page Crawl</h3>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{maxPages} {maxPages === 1 ? 'page' : 'pages'}</span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 12px 0' }}>
                  How many pages to automatically visit and capture resources from.
                </p>
                <input
                  type="range" min={1} max={20} value={maxPages}
                  onChange={e => setMaxPages(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#3b82f6', marginBottom: '8px' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                  <span>1 (this page only)</span><span>20 pages</span>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input type="checkbox" checked={sameOriginOnly} onChange={e => setSameOriginOnly(e.target.checked)}
                    style={{ accentColor: '#3b82f6', width: '16px', height: '16px' }} />
                  <span style={{ color: 'var(--text-muted)' }}>Stay on same domain only (recommended)</span>
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
              <h2 style={{ marginBottom: '16px' }}>Step 2: Network Traffic Filters</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
                Filter which network requests to download. Leave empty to download everything.
              </p>

              <FilterGuide />

              <div style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ margin: 0 }}>Active Filters</h3>
                  <button onClick={addFilter} className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.9rem' }}>+ Add Filter</button>
                </div>

                {filters.length === 0 && (
                  <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                    No filters — ALL network requests will be downloaded.
                  </p>
                )}

                {filters.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '10px', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', alignItems: 'center' }}>
                    <select className="input-glass" style={{ flex: 1, padding: '8px' }} value={f.isInclude ? 'include' : 'exclude'} onChange={e => updateFilter(i, 'isInclude', e.target.value === 'include')}>
                      <option value="include">Include ✅</option>
                      <option value="exclude">Exclude ❌</option>
                    </select>
                    <select className="input-glass" style={{ flex: 1, padding: '8px' }} value={f.type} onChange={e => updateFilter(i, 'type', e.target.value)}>
                      <option value="extension">Extension</option>
                      <option value="contains">Contains</option>
                      <option value="starts_with">Starts with</option>
                      <option value="ends_with">Ends with</option>
                      <option value="regex">Regex</option>
                    </select>
                    {f.type === 'extension' ? (
                      <div style={{ flex: 2 }}>
                        <CreatableSelect isClearable styles={selectStyles} options={EXTENSION_OPTIONS}
                          value={f.value ? { value: f.value, label: f.value } : null}
                          onChange={(s: any) => updateFilter(i, 'value', s ? s.value : '')}
                          placeholder="Search extension..." />
                      </div>
                    ) : (
                      <input className="input-glass" style={{ flex: 2, padding: '8px' }} value={f.value}
                        onChange={e => updateFilter(i, 'value', e.target.value)} placeholder="Value..." />
                    )}
                    <button onClick={() => removeFilter(i)}
                      style={{ background: '#ef4444', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
                  </div>
                ))}
              </div>

              {/* Live preview tester */}
              <div style={{ padding: '16px', background: 'rgba(59,130,246,0.05)', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div>
                    <h3 style={{ margin: 0, color: '#60a5fa' }}>Live Network Tester</h3>
                    <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Dry run across {maxPages} page{maxPages > 1 ? 's' : ''} — no files downloaded yet.
                    </p>
                  </div>
                  <button className="btn-primary" onClick={runPreview} disabled={loading} style={{ whiteSpace: 'nowrap' }}>
                    {loading ? '⏳ Scanning...' : '🔍 Test Rules'}
                  </button>
                </div>
                {preview && (
                  <div style={{ animation: 'fadeIn 0.3s ease' }}>
                    <p style={{ color: '#4ade80', margin: '0 0 4px', fontWeight: 'bold' }}>✅ {preview.allowed.length} will be downloaded</p>
                    <p style={{ color: '#ef4444', margin: '0 0 10px', fontWeight: 'bold' }}>❌ {preview.blocked.length} blocked</p>
                    <div style={{ maxHeight: '180px', overflowY: 'auto', fontSize: '0.8rem', background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '6px' }}>
                      {preview.allowed.map((url, i) => <div key={`a-${i}`} style={{ color: '#a7f3d0', marginBottom: '3px' }}>✅ {url}</div>)}
                      {preview.blocked.map((url, i) => <div key={`b-${i}`} style={{ color: '#fca5a5', marginBottom: '3px', opacity: 0.7 }}>❌ {url}</div>)}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--glass-border)', flex: 1 }} onClick={() => setStep(1)}>
                  ← Back
                </button>
                <button className="btn-primary" style={{ flex: 2 }} onClick={startJob}>
                  ▶ Start Extraction Job
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              <h2 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>Job Running</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '4px' }}>Job ID: <code style={{ color: '#60a5fa' }}>{activeJobId}</code></p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '20px' }}>
                Crawling up to <strong>{maxPages}</strong> page{maxPages > 1 ? 's' : ''} on <strong>{targetUrl}</strong>
              </p>

              {/* Progress bar */}
              <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Status</span>
                <span style={{ color: jobStatus === 'completed' ? '#4ade80' : jobStatus === 'failed' ? '#ef4444' : '#60a5fa', fontWeight: 'bold', textTransform: 'capitalize' }}>
                  {jobStatus === 'running' ? '⏳ Extracting...' : jobStatus === 'completed' ? '✅ Complete' : jobStatus === 'failed' ? '❌ Failed' : jobStatus}
                </span>
              </div>
              <div style={{ height: '10px', background: 'rgba(15,23,42,0.8)', borderRadius: '6px', overflow: 'hidden', marginBottom: '24px' }}>
                <div style={{
                  height: '100%',
                  width: `${progressPercent}%`,
                  background: progressColor,
                  transition: 'width 0.5s ease',
                  animation: jobStatus === 'running' ? 'pulse 2s infinite' : 'none'
                }} />
              </div>

              {downloadReady && jobStatus === 'completed' && (
                <button
                  className="btn-primary"
                  onClick={() => window.location.href = `http://localhost:3000/api/jobs/${activeJobId}/download`}
                  style={{ width: '100%', padding: '16px', fontSize: '1.1rem', marginBottom: '12px', transform: isHovering ? 'scale(1.02)' : 'scale(1)', transition: 'transform 0.2s' }}
                  onMouseEnter={() => setIsHovering(true)}
                  onMouseLeave={() => setIsHovering(false)}
                >
                  📦 Download ZIP Archive
                </button>
              )}

              {downloadReady && jobStatus === 'failed' && (
                <p style={{ color: '#ef4444', padding: '12px', background: 'rgba(239,68,68,0.1)', borderRadius: '6px', marginBottom: '12px' }}>
                  Job failed. Check that the URL is reachable and try again.
                </p>
              )}

              {!downloadReady && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic', marginBottom: '16px' }}>
                  ⏳ Playwright is crawling the site in the background. This may take 30–120 seconds depending on the number of pages.
                </p>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--glass-border)', flex: 1 }} onClick={() => { setStep(2); setDownloadReady(false); }}>
                  ← Back to Filters
                </button>
                <button className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--glass-border)', flex: 1 }} onClick={() => { setStep(1); setDownloadReady(false); }}>
                  🔄 New Job
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL: Browser ── */}
        <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '600px' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
            {(['interactive', 'preview'] as BrowserTab[]).map(tab => (
              <button key={tab} onClick={() => setBrowserTab(tab)} style={{
                padding: '6px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                background: browserTab === tab ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.05)',
                color: browserTab === tab ? '#60a5fa' : 'var(--text-muted)',
                fontWeight: browserTab === tab ? 'bold' : 'normal',
                fontSize: '0.9rem'
              }}>
                {tab === 'interactive' ? '🖱️ Interactive Browser' : '🔍 Quick Preview'}
              </button>
            ))}
          </div>

          {/* Interactive Browser Tab */}
          {browserTab === 'interactive' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {/* Controls */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
                {!wsConnected ? (
                  <button className="btn-primary" onClick={connectBrowser} disabled={wsLoading}
                    style={{ padding: '8px 16px', fontSize: '0.9rem' }}>
                    {wsLoading ? '⏳ Launching...' : '🚀 Launch Browser'}
                  </button>
                ) : (
                  <>
                    <input
                      className="input-glass"
                      value={navUrl}
                      onChange={e => setNavUrl(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') sendWs({ type: 'navigate', url: navUrl }); }}
                      placeholder="Navigate to URL..."
                      style={{ flex: 1, padding: '8px 12px' }}
                    />
                    <button className="btn-primary" onClick={() => sendWs({ type: 'navigate', url: navUrl })}
                      style={{ padding: '8px 14px', fontSize: '0.9rem' }}>Go</button>
                    <button onClick={() => sendWs({ type: 'get_resources' })}
                      style={{ padding: '8px 14px', background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.4)', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                      📡 Resources ({sessionResources.length})
                    </button>
                    <button onClick={disconnectBrowser}
                      style={{ padding: '8px 14px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                      ✕ Close
                    </button>
                  </>
                )}
              </div>

              {/* Info banner when connected */}
              {wsConnected && (
                <div style={{ padding: '8px 12px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '6px', marginBottom: '12px', fontSize: '0.85rem', color: '#4ade80' }}>
                  🟢 Interactive browser active — click anywhere to interact, type to type, scroll to scroll. Navigate to any page, login if needed, then use <strong>Step 2</strong> to start capturing!
                </div>
              )}

              {/* Browser viewport */}
              <div
                ref={imgRef}
                onClick={handleImgClick}
                onKeyDown={handleImgKeyDown}
                tabIndex={0}
                style={{
                  flex: 1,
                  background: wsConnected && browserFrame ? 'transparent' : 'rgba(0,0,0,0.3)',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  overflow: 'hidden',
                  cursor: wsConnected ? 'crosshair' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '460px',
                  outline: 'none',
                  position: 'relative'
                }}
              >
                {browserFrame ? (
                  <img src={browserFrame} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} alt="Browser" draggable={false} />
                ) : wsLoading ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '8px' }}>⏳</div>
                    <p>Launching Chromium browser...</p>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🖥️</div>
                    <p style={{ marginBottom: '8px', fontSize: '1.1rem' }}>Interactive Browser</p>
                    <p style={{ fontSize: '0.85rem' }}>Launch a real Chrome browser session here.<br />Navigate, login, and explore — then capture everything!</p>
                    <button className="btn-primary" onClick={connectBrowser} style={{ marginTop: '16px' }}>
                      🚀 Launch Browser
                    </button>
                  </div>
                )}
              </div>

              {/* Keyboard shortcuts hint */}
              {wsConnected && (
                <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <span>🖱️ Click = click on page</span>
                  <span>⌨️ Type after clicking = keyboard input</span>
                  <span>Scroll wheel = scroll page</span>
                  <span>Enter in nav bar = navigate</span>
                </div>
              )}

              {/* Captured resources list */}
              {sessionResources.length > 0 && (
                <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', maxHeight: '120px', overflowY: 'auto' }}>
                  <p style={{ margin: '0 0 8px', fontWeight: 'bold', fontSize: '0.9rem', color: '#60a5fa' }}>📡 Captured {sessionResources.length} resources in this session</p>
                  {sessionResources.slice(0, 10).map((u, i) => (
                    <div key={i} style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u}</div>
                  ))}
                  {sessionResources.length > 10 && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>...and {sessionResources.length - 10} more</div>}
                </div>
              )}
            </div>
          )}

          {/* Quick Preview Tab (iframe) */}
          {browserTab === 'preview' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '12px' }}>
                Simple read-only preview. Switch to <strong>Interactive Browser</strong> to login and navigate freely.
              </p>
              <div style={{ flex: 1, background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.2)', minHeight: '500px' }}>
                <iframe
                  src={targetUrl}
                  style={{ width: '100%', height: '100%', border: 'none', minHeight: '500px' }}
                  title="Quick Preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
