import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, QrCode, AlertTriangle, WifiOff } from 'lucide-react';
import { syncEngine } from '../../sync/syncEngine';
import { SyncStateSnapshot, SyncStatus } from '../../sync/types';

interface SyncStatusBadgeProps {
  snapshot?: SyncStateSnapshot;
  onClick?: () => void;
  compact?: boolean;
}

const STATUS_CONFIG: Record<
  SyncStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  idle: {
    label: 'Sync Ready',
    badgeClass: 'bg-[#171a26] text-gray-200 border-[#262b3d] hover:border-[#E27D12]/50',
    dotClass: 'bg-emerald-400',
  },
  pairing: {
    label: 'Pairing...',
    badgeClass: 'bg-[#E27D12]/15 text-[#f6a54c] border-[#E27D12]/40',
    dotClass: 'bg-[#E27D12] animate-pulse',
  },
  syncing: {
    label: 'Syncing...',
    badgeClass: 'bg-sky-950/60 text-sky-300 border-sky-500/40',
    dotClass: 'bg-sky-400',
  },
  offline: {
    label: 'Peer Offline',
    badgeClass: 'bg-amber-950/60 text-amber-300 border-amber-500/40',
    dotClass: 'bg-amber-400',
  },
  error: {
    label: 'Sync Error',
    badgeClass: 'bg-rose-950/60 text-rose-300 border-rose-500/40',
    dotClass: 'bg-rose-400',
  },
};

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({
  snapshot: externalSnapshot,
  onClick,
  compact = false,
}) => {
  const [internalSnapshot, setInternalSnapshot] = useState<SyncStateSnapshot>(() =>
    syncEngine.getState()
  );

  useEffect(() => {
    if (externalSnapshot) return;
    return syncEngine.subscribe(setInternalSnapshot);
  }, [externalSnapshot]);

  const state = externalSnapshot ?? internalSnapshot;
  const cfg = STATUS_CONFIG[state.status];

  const renderIcon = () => {
    switch (state.status) {
      case 'syncing':
        return <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />;
      case 'pairing':
        return <QrCode className="w-3.5 h-3.5 text-[#E27D12]" />;
      case 'offline':
        return <WifiOff className="w-3.5 h-3.5 text-amber-400" />;
      case 'error':
        return <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />;
      default:
        return state.lastSyncedAt ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <span className={`w-2 h-2 rounded-full ${cfg.dotClass}`} />
        );
    }
  };

  const Tag = onClick ? 'button' : 'span';

  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
        cfg.badgeClass
      } ${onClick ? 'cursor-pointer' : ''}`}
      title={state.error?.message || cfg.label}
    >
      {renderIcon()}
      <span>{cfg.label}</span>
      {!compact && state.lastSyncedAt && state.status === 'idle' && (
        <span className="text-[11px] text-gray-400 hidden sm:inline">
          {new Date(state.lastSyncedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      )}
    </Tag>
  );
};
