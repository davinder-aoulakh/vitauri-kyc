import React from 'react';
import { Button } from '@/components/ui/button';
import { X, Download, FileText } from 'lucide-react';

// ── Type detection ────────────────────────────────────────────────────────────

function detectFileType(url, fileName) {
  if (!url) return 'unknown';

  // data: URLs — check MIME type
  if (url.startsWith('data:')) {
    if (url.startsWith('data:image/'))          return 'image';
    if (url.startsWith('data:text/html'))       return 'html';
    if (url.startsWith('data:text/plain'))      return 'text';
    if (url.startsWith('data:application/pdf')) return 'pdf';
    return 'data';
  }

  // Regular URLs — check extension
  const lower = (fileName || url).toLowerCase().split('?')[0];
  if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff?)$/.test(lower)) return 'image';
  if (/\.html?$/.test(lower))                                   return 'html';
  if (/\.pdf$/.test(lower))                                     return 'pdf';
  if (/\.txt$/.test(lower))                                     return 'text';
  return 'other';
}

function decodeDataHtml(dataUrl) {
  try {
    const base64 = dataUrl.split(',')[1];
    return atob(base64);
  } catch { return ''; }
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function DocumentViewer({ fileUrl, fileName, onClose }) {
  if (!fileUrl) return null;

  const fileType = detectFileType(fileUrl, fileName);

  function renderContent() {
    switch (fileType) {

      case 'image':
        return (
          <div className="flex items-center justify-center min-h-full p-6">
            <img
              src={fileUrl}
              alt={fileName}
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              style={{ maxHeight: 'calc(100vh - 120px)' }}
            />
          </div>
        );

      case 'html': {
        const htmlContent = fileUrl.startsWith('data:') ? decodeDataHtml(fileUrl) : null;
        return htmlContent ? (
          <iframe
            srcDoc={htmlContent}
            title={fileName}
            className="w-full border-0"
            style={{ height: 'calc(100vh - 80px)' }}
            sandbox="allow-same-origin"
          />
        ) : (
          <iframe
            src={fileUrl}
            title={fileName}
            className="w-full border-0"
            style={{ height: 'calc(100vh - 80px)' }}
          />
        );
      }

      case 'pdf':
        return (
          <iframe
            src={fileUrl}
            title={fileName}
            className="w-full border-0"
            style={{ height: 'calc(100vh - 80px)' }}
          />
        );

      case 'text': {
        const text = fileUrl.startsWith('data:text/plain;base64,')
          ? atob(fileUrl.split(',')[1])
          : null;
        return text ? (
          <pre className="p-6 text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed max-w-3xl mx-auto">
            {text}
          </pre>
        ) : (
          <iframe src={fileUrl} title={fileName} className="w-full border-0" style={{ height: 'calc(100vh - 80px)' }} />
        );
      }

      default:
        if (fileUrl.startsWith('data:')) {
          return (
            <div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
              <FileText className="w-12 h-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">This file type cannot be previewed. Please download it.</p>
              <a href={fileUrl} download={fileName}>
                <Button size="sm" className="gap-2">
                  <Download className="w-4 h-4" /> Download File
                </Button>
              </a>
            </div>
          );
        }
        return (
          <iframe
            src={`https://docs.google.com/viewer?url=${encodeURIComponent(fileUrl)}&embedded=true`}
            title={fileName}
            className="w-full border-0"
            style={{ height: 'calc(100vh - 80px)' }}
          />
        );
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 z-50 flex flex-col bg-card border-l border-border shadow-2xl w-full md:w-[80%] animate-slide-in-right">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm font-medium text-foreground truncate">{fileName || 'Document'}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            <a href={fileUrl} download={fileName}
               target={fileUrl.startsWith('data:') ? undefined : '_blank'}
               rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8">
                <Download className="w-3.5 h-3.5" /> Download
              </Button>
            </a>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-muted/10">
          {renderContent()}
        </div>
      </div>
    </>
  );
}