import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MessageSquare, Send, Check, Loader2, Reply, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export default function CaseNoteThread({
  threads = [],
  onAddNote,
  onAddReply,
  onDeleteNote,
  saving = false,
  currentUserName = 'You',
}) {
  const [newNote, setNewNote] = useState('');
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyText, setReplyText] = useState('');

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    await onAddNote(newNote);
    setNewNote('');
  };

  const handleAddReply = async (parentId) => {
    if (!replyText.trim()) return;
    await onAddReply(parentId, replyText);
    setReplyText('');
    setReplyingToId(null);
  };

  return (
    <div className="border-t border-border p-4 flex-shrink-0 flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 sticky top-0 bg-card/95 backdrop-blur py-2">
        <MessageSquare className="w-4 h-4 text-muted-foreground" />
        <div className="text-xs font-semibold text-muted-foreground">Case Notes</div>
        <span className="text-xs text-muted-foreground/60 ml-auto">{threads.length} note(s)</span>
      </div>

      {/* Thread History */}
      <div className="space-y-3">
        {threads.map((note) => (
          <div key={note.id} className="space-y-1">
            {/* Main note */}
            <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-foreground">{note.author}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(note.timestamp), 'd MMM HH:mm')}
                  </div>
                </div>
                {note.author === currentUserName && (
                  <button
                    onClick={() => onDeleteNote(note.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors p-1"
                    title="Delete note"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
                {note.text}
              </p>
              <button
                onClick={() => setReplyingToId(replyingToId === note.id ? null : note.id)}
                className="text-xs text-primary hover:text-primary/80 mt-2 flex items-center gap-1"
              >
                <Reply className="w-3 h-3" /> Reply
              </button>
            </div>

            {/* Replies */}
            {note.replies && note.replies.length > 0 && (
              <div className="ml-4 space-y-2 border-l-2 border-primary/20 pl-3">
                {note.replies.map((reply) => (
                  <div key={reply.id} className="bg-primary/5 rounded-lg p-2.5 border border-primary/10">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div>
                        <div className="text-xs font-medium text-foreground">{reply.author}</div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(reply.timestamp), 'd MMM HH:mm')}
                        </div>
                      </div>
                      {reply.author === currentUserName && (
                        <button
                          onClick={() => onDeleteNote(reply.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1"
                          title="Delete reply"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
                      {reply.text}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Reply input */}
            {replyingToId === note.id && (
              <div className="ml-4 space-y-2 border-l-2 border-primary/20 pl-3">
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply…"
                  className="text-xs min-h-12 resize-none"
                />
                <div className="flex gap-2 items-center">
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => handleAddReply(note.id)}
                    disabled={!replyText.trim() || saving}
                  >
                    {saving ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Send className="w-3 h-3" />
                    )}
                    Send
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setReplyingToId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New note input */}
      <div className="space-y-2 border-t border-border pt-3">
        <Textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a new case note…"
          className="text-xs min-h-14 resize-none"
        />
        <Button
          size="sm"
          className="w-full gap-2 text-xs"
          onClick={handleAddNote}
          disabled={!newNote.trim() || saving}
        >
          {saving ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Send className="w-3 h-3" />
          )}
          Post Note
        </Button>
      </div>
    </div>
  );
}