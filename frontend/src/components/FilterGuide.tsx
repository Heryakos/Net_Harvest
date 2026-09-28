import React from 'react';

export const FilterGuide: React.FC = () => {
  return (
    <div style={{
      padding: '16px',
      backgroundColor: '#1E293B',
      borderLeft: '4px solid #3B82F6',
      borderRadius: '6px',
      color: '#E2E8F0',
      marginBottom: '20px',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <h4 style={{ margin: '0 0 8px 0', color: '#60A5FA', fontSize: '16px' }}>
        💡 How Filters Work
      </h4>
      <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', lineHeight: '1.5' }}>
        <li>
          <strong>Include Rules:</strong> If you define include rules, a URL must match <em>every single one</em> (ALL) to be downloaded.
        </li>
        <li>
          <strong>Exclude Rules:</strong> If a URL matches <em>even one</em> exclude rule (ANY), it is instantly rejected and skipped.
        </li>
      </ul>
    </div>
  );
};
