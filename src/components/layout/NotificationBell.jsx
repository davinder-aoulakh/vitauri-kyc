import React, { useState, useEffect, useCallback } from 'react';
import { Bell, X, Check, CheckCheck } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';

const TYPE_LABELS = {
  case_assigned:        { label: 'Case assigned', color: 'bg-blue-100 text-blue-700' },
  sign_off_request:     { label: 'Sign-off request', color: 'bg-amber-100 text-amber-700' },
  sign_off_decision:    { label: 'Sign-off decision', color: 'bg-purple-100 text-purple-700' },
  outreach_response:    { label: 'Client response', color: 'bg-emerald-100 text-emerald-700' },
  monitoring_alert:     { label: 'Monitoring alert', color: 'bg-red-100 text-red-700' },
  control_measure_due:  { label: 'Control measure due', color: 'bg-orange-100 text-orange-700' },
  periodic_review_created: { label: 'Periodic review', color: 'bg-teal-100 text-teal-700' },
};

export default function NotificationBell({ userId, tenantId }) {
  const [notifications, setNotifications] = useState([]);
  const [allNotifications, setAllNotifications] = useState([]); // includes read, for the "all" tab
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('unread'); // 'unread' | 'all'
  const navigate = useNavigate();

  const load = useCallback(async () => {
    if (!userId) return;
    const [unread, all] = await Promise.all([
      base44.entities.Notification.filter({ user_id: userId, is_read: false }, '-created_date', 20),
      base44.entities.Notification.filter({ user_id: userId }, '-created_date', 40),
    ]);
    setNotifications(unread || []);
    setAllNotifications(all || []);
  }, [userId]);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // Poll every 30s for new notifications
  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [userId, load]);

  // Load again when popover opens
  useEffect(() => { if (open) load(); }, [open]);

  async function markRead(notif) {
    await base44.entities.Notification.update(notif.id, { is_read: true });
    setNotifications(prev => prev.filter(n => n.id !== notif.id));
    setAllNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
  }

  async function markAllRead() {
    const unread = notifications;
    for (const n of unread) {
      await base44.entities.Notification.update(n.id, { is_read: true });
    }
    setNotifications([]);
    setAllNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  }

  function handleClick(n) {
    if (!n.is_read) markRead(n);
    setOpen(false);
    if (n.link_case_id) navigate(`/case/${n.link_case_id}`);
    else if (n.link_client_id) navigate(`/client/${n.link_client_id}`);
  }

  const unreadCount = notifications.length;
  const displayList = tab === 'unread' ? notifications : allNotifications;
  const typeMeta = (type) => TYPE_LABELS[type] || { label: type, color: 'bg-slate-100 text-slate-600' };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors">
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-semibold px-0.5">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0 shadow-xl" sideOffset={8}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-1">
            <span className="font-semibold text-sm">Notifications</span>
            {unreadCount > 0 && (
              <span className="ml-1.5 bg-primary text-primary-foreground text-xs rounded-full px-1.5 py-0.5 font-semibold">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                <CheckCheck className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {[['unread', `Unread (${unreadCount})`], ['all', 'All']].map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)}
              className={cn('flex-1 text-xs font-medium py-2 transition-colors',
                tab === v ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground')}>
              {l}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
          {displayList.length === 0 ? (
            <div className="py-10 text-center">
              <Bell className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <div className="text-sm text-muted-foreground">
                {tab === 'unread' ? 'All caught up!' : 'No notifications yet'}
              </div>
            </div>
          ) : (
            displayList.map(n => {
              const meta = typeMeta(n.type);
              const isUnread = !n.is_read;
              return (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={cn(
                    'px-4 py-3 cursor-pointer transition-colors group',
                    isUnread ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/50'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', meta.color)}>
                          {meta.label}
                        </span>
                        {isUnread && (
                          <span className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0" />
                        )}
                      </div>
                      <div className={cn('text-xs font-medium leading-snug', isUnread ? 'text-foreground' : 'text-muted-foreground')}>
                        {n.title}
                      </div>
                      {n.body && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</div>
                      )}
                      <div className="text-[10px] text-muted-foreground/60 mt-1">
                        {n.created_date ? formatDistanceToNow(new Date(n.created_date), { addSuffix: true }) : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                      {(n.link_case_id || n.link_client_id) && (
                        <span className="text-[10px] text-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          View →
                        </span>
                      )}
                      {isUnread && (
                        <button
                          onClick={e => { e.stopPropagation(); markRead(n); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded"
                          title="Mark as read"
                        >
                          <Check className="w-3 h-3 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {allNotifications.length > 0 && (
          <div className="px-4 py-2 border-t border-border bg-muted/20 text-center">
            <span className="text-xs text-muted-foreground">Showing last {displayList.length} notifications</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}