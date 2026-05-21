import React from 'react';
import { Button } from '@/components/ui/button';
import { X, Download, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff', '.tif'];

function isImage(url) {
  if (!url) return false;
  const lower = url.toLowerCase().split('?')[0];
  return IMAGE_EXTS.some(ext => lower.endsWith(ext));
}

export default function DocumentViewer({ fileUrl, fileName, onClose }) {
  if (!fileUrl) return null;

  const img = isImage(fileUrl);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex flex-col bg-card border-l border-border shadow-2xl w-full md:w-[80%] animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm font-medium text-foreground truncate">{fileName || 'Document'}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            <a href={fileUrl} download target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8">
                <Download className="w-3.5 h-3.5" /> Download
              </Button>
            </a>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto bg-muted/10">
          {img ? (
            <div className="flex items-center justify-center min-h-full p-6">
              <img
                src={fileUrl}
                alt={fileName}
                className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              />
            </div>
          ) : (
            <iframe
              src={fileUrl}
              title={fileName}
              sandbox="allow-same-origin allow-scripts"
              className="w-full h-full border-0 min-h-screen"
              style={{ minHeight: '100%' }}
            />
          )}
        </div>
      </div>
    </>
  );
}