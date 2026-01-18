'use client';

import { useState, useRef } from 'react';

export default function Home() {
  const [result, setResult] = useState<string | null>(null);
  const [format, setFormat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      setFileName(input.files[0].name);
      setResult(null);
      setFormat(null);
      setError(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      if (fileInputRef.current) {
        // Create a new DataTransfer object to set the files on the input
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(e.dataTransfer.files[0]);
        fileInputRef.current.files = dataTransfer.files;

        // Trigger change event manually if needed, or just set state
        setFileName(e.dataTransfer.files[0].name);
        setResult(null);
        setFormat(null);
        setError(null);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!fileInputRef.current?.files?.length) {
      setError("Please select a file first");
      return;
    }

    setResult(null);
    setFormat(null);
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.errorMessage || 'Failed to scan');
      }

      setResult(data.qrcode);
      setFormat(data.format);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h1>Barcode Scanner</h1>

      <form onSubmit={handleSubmit}>
        <div
          className="upload-area"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            type="file"
            name="file"
            accept="image/*"
            hidden
            ref={fileInputRef}
            onChange={handleFileChange}
          />

          <div style={{ fontSize: '3rem' }}>📷</div>
          <p style={{ margin: 0, fontWeight: 500 }}>
            {fileName ? fileName : "Click or drag image here"}
          </p>
          {!fileName && (
            <p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.6 }}>
              Supports JPG, PNG, BMP
            </p>
          )}
        </div>

        <button type="submit" className="button" disabled={loading}>
          {loading ? 'Scanning...' : 'Decode Barcode'}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {result && (
        <div className="result">
          <div style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '0.5rem' }}>RESULT {format ? `(${format})` : ''}</div>
          <code style={{ fontSize: '1.1rem', color: '#4ade80' }}>{result}</code>
        </div>
      )}
    </div>
  );
}
