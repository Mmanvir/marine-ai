import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { fmtBytes } from '../utils/format';

export const MAX_MB = 25; // keep in sync with MAX_UPLOAD_MB on the backend

/** Drag-and-drop or click-to-choose CSV picker. Validates type and size on the client (the server re-validates). */
export default function FileUploader({ file, onFile, onError }) {
  const input = useRef(null);
  const [drag, setDrag] = useState(false);

  const accept = (f) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) return onError?.('Only .csv files are supported.');
    if (f.size > MAX_MB * 1048576) return onError?.(`File is ${fmtBytes(f.size)}; the limit is ${MAX_MB} MB.`);
    if (f.size === 0) return onError?.('The file is empty.');
    onError?.(null);
    onFile(f);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); accept(e.dataTransfer.files?.[0]); }}
      className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition ${drag ? 'border-brand-500 bg-brand-500/10' : 'border-line'}`}
    >
      <UploadCloud className="text-brand-500" size={32} aria-hidden="true" />
      {file ? (
        <p className="text-sm"><span className="font-medium">{file.name}</span> <span className="text-muted">({fmtBytes(file.size)})</span></p>
      ) : (
        <p className="text-sm text-muted">Drag a CSV here, or choose a file (max {MAX_MB} MB)</p>
      )}
      <input ref={input} id="csv-file" data-testid="csv-input" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => accept(e.target.files?.[0])} />
      <button type="button" className="btn-secondary" onClick={() => input.current?.click()}>{file ? 'Choose a different file' : 'Choose CSV file'}</button>
    </div>
  );
}
