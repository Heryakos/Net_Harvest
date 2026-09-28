import React, { useState } from 'react';
import './index.css';
import { FilterGuide } from './components/FilterGuide';
import CreatableSelect from 'react-select/creatable';

type FilterRule = { type: string; value: string; isInclude: boolean };

// The dropdown list of predefined extensions you requested!
const COMMON_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico',
  '.mp4', '.webm', '.avi', '.mov', '.mp3', '.wav', '.ogg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv',
  '.zip', '.tar', '.gz', '.rar',
  '.gltf', '.glb', '.obj', '.fbx', // 3D files for portfolios
  '.js', '.css', '.woff', '.woff2', '.ttf' // Web assets
];

const EXTENSION_OPTIONS = COMMON_EXTENSIONS.map(ext => ({ value: ext, label: ext }));

// Custom styles for react-select to match the glassmorphism theme
const customSelectStyles = {
  control: (provided: any) => ({
    ...provided,
    background: 'rgba(0, 0, 0, 0.2)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    color: 'white',
    boxShadow: 'none',
    '&:hover': {
      border: '1px solid rgba(255, 255, 255, 0.3)'
    }
  }),
  menu: (provided: any) => ({
    ...provided,
    background: '#1e293b',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    zIndex: 100
  }),
  option: (provided: any, state: any) => ({
    ...provided,
    background: state.isFocused ? 'rgba(59, 130, 246, 0.5)' : 'transparent',
    color: 'white',
    cursor: 'pointer'
  }),
  singleValue: (provided: any) => ({
    ...provided,
    color: 'white'
  }),
  input: (provided: any) => ({
    ...provided,
    color: 'white'
  })
};

export default function App() {
  const [step, setStep] = useState(1);
  const [isHovering, setIsHovering] = useState(false);
  
  const [targetUrl, setTargetUrl] = useState('https://hiryakos-portfolio.vercel.app/');
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [preview, setPreview] = useState<{allowed: string[], blocked: string[]} | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const addFilter = () => setFilters([...filters, { type: 'extension', value: '.png', isInclude: true }]);
  const updateFilter = (index: number, field: keyof FilterRule, val: any) => {
    const newFilters = [...filters];
    newFilters[index] = { ...newFilters[index], [field]: val };
    setFilters(newFilters);
  };
  const removeFilter = (index: number) => setFilters(filters.filter((_, i) => i !== index));

  const runPreview = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:3000/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, filters })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else setPreview(data);
    } catch (err) {
      alert("Failed to fetch preview. Make sure backend is running.");
    }
    setLoading(false);
  };

  const startJob = async () => {
    try {
      const res = await fetch('http://localhost:3000/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startUrl: targetUrl, filters })
      });
      const data = await res.json();
      setActiveJobId(data.id);
      setStep(3);
    } catch (err) {
      alert("Failed to start job.");
    }
  };

  return (
    <div style={{ maxWidth: '900px', margin: '40px auto', padding: '0 20px' }}>
      <header style={{ textAlign: 'center', marginBottom: '30px', animation: 'fadeIn 0.5s ease' }}>
        <h1 className="gradient-text" style={{ fontSize: '2.5rem', marginBottom: '8px' }}>Rule-Based Extractor</h1>
        <p style={{ color: 'var(--text-muted)' }}>Automate content extraction and downloading with precision.</p>
      </header>

      <div style={{ display: 'flex', gap: '24px', flexDirection: 'row', alignItems: 'stretch' }}>
        <div className="glass-card" style={{ flex: '1 1 50%' }}>
        {step === 1 && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <h2 style={{ marginBottom: '8px' }}>Step 1: Define Target</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>Enter the URL. You can see it live right here in the app!</p>
            
            <input 
              className="input-glass" 
              value={targetUrl}
              onChange={e => setTargetUrl(e.target.value)}
              style={{ marginBottom: '24px' }} 
            />
            
            <button className="btn-primary" style={{ width: '100%' }} onClick={() => setStep(2)}>Next: Configure Filters ➔</button>
          </div>
        )}
        
        {step === 2 && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <h2 style={{ marginBottom: '16px' }}>Step 2: Network Traffic Filters</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
              The engine will intercept ALL network traffic (just like Chrome DevTools). Filter what you want to download.
            </p>
            
            <FilterGuide />

            <div style={{ marginBottom: '32px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0 }}>Active Filters</h3>
                <button onClick={addFilter} className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.9rem' }}>+ Add Filter</button>
              </div>

              {filters.length === 0 && <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', padding: '16px', background: 'rgba(0,0,0,0.2)' }}>No filters added. ALL network requests will be downloaded.</p>}

              {filters.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: '12px', marginBottom: '12px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', alignItems: 'center' }}>
                  <select className="input-glass" style={{ flex: 1, padding: '10px' }} value={f.isInclude ? 'include' : 'exclude'} onChange={e => updateFilter(i, 'isInclude', e.target.value === 'include')}>
                    <option value="include">Include (ALL)</option>
                    <option value="exclude">Exclude (ANY)</option>
                  </select>
                  
                  <select className="input-glass" style={{ flex: 1, padding: '10px' }} value={f.type} onChange={e => updateFilter(i, 'type', e.target.value)}>
                    <option value="extension">File Extension</option>
                    <option value="contains">Contains text</option>
                    <option value="starts_with">Starts with</option>
                    <option value="ends_with">Ends with</option>
                    <option value="regex">Regex</option>
                  </select>

                  {/* 🔥 SEARCHABLE DROPDOWN FOR FILE EXTENSIONS 🔥 */}
                  {f.type === 'extension' ? (
                    <div style={{ flex: 2 }}>
                      <CreatableSelect
                        isClearable
                        styles={customSelectStyles}
                        options={EXTENSION_OPTIONS}
                        value={f.value ? { value: f.value, label: f.value } : null}
                        onChange={(selected: any) => updateFilter(i, 'value', selected ? selected.value : '')}
                        placeholder="Search or type extension..."
                      />
                    </div>
                  ) : (
                    <input className="input-glass" style={{ flex: 2, padding: '10px' }} value={f.value} onChange={e => updateFilter(i, 'value', e.target.value)} placeholder="Type value to match..." />
                  )}
                  
                  <button onClick={() => removeFilter(i)} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>X</button>
                </div>
              ))}
            </div>

            <div style={{ padding: '24px', background: 'rgba(59, 130, 246, 0.05)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)', marginBottom: '32px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, color: '#60a5fa' }}>Live Network Tester</h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>We will launch a hidden browser to scan all network traffic on {targetUrl}. Takes ~10s.</p>
                </div>
                <button className="btn-primary" onClick={runPreview} disabled={loading}>{loading ? 'Scanning Browser...' : 'Test Rules Live'}</button>
              </div>
              
              {preview && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  <p style={{ color: '#4ade80', margin: '0 0 8px 0', fontWeight: 'bold' }}>✅ {preview.allowed.length} Allowed files found</p>
                  <p style={{ color: '#ef4444', margin: '0 0 16px 0', fontWeight: 'bold' }}>❌ {preview.blocked.length} files Blocked</p>
                  <div style={{ maxHeight: '250px', overflowY: 'auto', fontSize: '0.85rem', background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '6px' }}>
                    {preview.allowed.map((url, i) => <div key={`a-${i}`} style={{ color: '#a7f3d0', marginBottom: '4px' }}>[ALLOWED] {url}</div>)}
                    {preview.blocked.map((url, i) => <div key={`b-${i}`} style={{ color: '#fca5a5', marginBottom: '4px', opacity: 0.7 }}>[BLOCKED] {url}</div>)}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '16px' }}>
              <button className="btn-primary" style={{ background: 'transparent', border: '1px solid var(--glass-border)', flex: '1' }} onClick={() => setStep(1)}>Back</button>
              <button className="btn-primary" style={{ flex: '2' }} onClick={startJob}>▶ Start Extraction Job</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>Job Progress</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>Job ID: {activeJobId}</p>
            <div style={{ height: '12px', background: 'rgba(15, 23, 42, 0.8)', borderRadius: '6px', overflow: 'hidden', marginBottom: '24px' }}>
              <div style={{ width: '100%', height: '100%', background: 'linear-gradient(90deg, #3b82f6, #60a5fa)' }}></div>
            </div>
            <button 
              className="btn-primary" 
              onClick={() => window.location.href = `http://localhost:3000/api/jobs/${activeJobId}/download`}
              style={{ width: '100%', padding: '16px', fontSize: '1.2rem', transform: isHovering ? 'scale(1.02)' : 'scale(1)' }}
              onMouseEnter={() => setIsHovering(true)}
              onMouseLeave={() => setIsHovering(false)}
            >
              📦 Download ZIP Archive
            </button>
          </div>
        )}
        </div>

        {/* Browser Preview Side */}
        <div className="glass-card" style={{ flex: '1 1 50%', display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ marginBottom: '16px' }}>Live Browser View</h2>
          <div style={{ flex: 1, minHeight: '500px', background: '#fff', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.2)' }}>
            {targetUrl ? (
              <iframe 
                src={targetUrl} 
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="Browser Preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
                Enter a URL to preview
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
