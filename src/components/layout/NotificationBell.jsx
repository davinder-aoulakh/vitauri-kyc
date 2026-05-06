import React, { useState, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';

export default function NotificationBell({ userId, tenantId }) {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;
    loadNotifications();
  }, [userId]);

  async function loadNotifications() {
    const data = await base44.entities.Notification.filter(
      { user_id: userId, is_read: false },
      '-created_date',
      20
    );
    setNotifications(data || []);
  }

  async function markAllRead() {
    for (const n of notifications) {
      await base44.entities.Notification.update(n.id, { is_read: true });
    }
    setNotifications([]);
  }

  const unreadCount = notifications.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors">
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-medium">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm">Notifications</span>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-xs text-primary hover:underline">
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto divide-y divide-border">
          {notifications.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No new notifications
            </div>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className="px-4 py-3 hover:bg-muted/50 transition-colors">
                <div className="text-xs font-medium text-foreground">{n.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}