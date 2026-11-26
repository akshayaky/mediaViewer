import React, { useEffect, useState } from 'react';
import {
  Laptop,
  RefreshCw,
  Server,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { syncEngine } from '../../sync/syncEngine';
import { SyncDeviceRecord, SyncStateSnapshot } from '../../sync/types';
import { QrPairView } from './QrPairView';
import { SyncStatusBadge } from './SyncStatusBadge';

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({ isOpen, onClose }) => {
  const [snapshot, setSnapshot] = useState<SyncStateSnapshot>(() => syncEngine.getState());
  const [pairedDevices, setPairedDevices] = useState<SyncDeviceRecord[]>([]);
  const [deviceNameInput, setDeviceNameInput] = useState('');
  const [activeSection, setActiveSection] = useState<'devices' | 'pair'>('devices');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);

  const refreshDevices = async () => {
    const [info, devices] = await Promise.all([
      syncEngine.getLocalDeviceInfo(),
      syncEngine.getPairedDevices(),
    ]);
    setDeviceNameInput(info.deviceName);
    setPairedDevices(devices);
  };

  useEffect(() => {
    const unsub = syncEngine.subscribe(next => {
      setSnapshot(next);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setActionMessage(null);
    void refreshDevices();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleRenameDevice = async () => {
    if (!deviceNameInput.trim()) return;
    await syncEngine.renameLocalDevice(deviceNameInput);
    setActionMessage('Device name saved.');
  };

  const handleToggleHost = async () => {
    setActionMessage(null);
    try {
      if (snapshot.hostingPort) {
        await syncEngine.stopHosting();
        setActionMessage('LAN sync listener stopped.');
      } else {
        const hosted = await syncEngine.startHosting();
        setActionMessage(
          `Listening on ${hosted.ips.join(', ') || '0.0.0.0'}:${hosted.port}`
        );
      }
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Unable to toggle LAN listener.');
    }
  };

  const handleSyncOne = async (deviceId: string) => {
    setBusyDeviceId(deviceId);
    setActionMessage(null);
    try {
      const stats = await syncEngine.syncWithDevice(deviceId);
      await refreshDevices();
      setActionMessage(
        `Synced: +${stats.inserted} added, ${stats.updated} updated, ${stats.deleted} deleted.`
      );
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setBusyDeviceId(null);
    }
  };

  const handleSyncAll = async () => {
    setBusyDeviceId('__all__');
    setActionMessage(null);
    try {
      const results = await syncEngine.syncAllPairedDevices();
      await refreshDevices();
      const count = Object.keys(results).length;
      setActionMessage(`Completed sync attempt across ${count} paired device(s).`);
    } finally {
      setBusyDeviceId(null);
    }
  };

  const handleUnpair = async (deviceId: string) => {
    await syncEngine.unpairDevice(deviceId);
    await refreshDevices();
    setActionMessage('Device unpaired.');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Local Wi-Fi Sync & Device Pairing"
    >
      <div className="w-full max-w-2xl bg-[#141722] border border-[#262b3d] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#232736] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#E27D12]/15 border border-[#E27D12]/30 flex items-center justify-center">
              <Wifi className="w-4.5 h-4.5 text-[#E27D12]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Local Wi-Fi Sync</h2>
              <p className="text-xs text-gray-400">
                Serverless peer-to-peer SQLite delta sync over your LAN
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <SyncStatusBadge snapshot={snapshot} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sync modal"
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#1e2231] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Local Device Identity & Host Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-[#10131c] border border-[#232736] rounded-xl p-3.5 space-y-2">
              <div className="text-[11px] font-mono uppercase tracking-wider text-gray-400">
                This Device
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={deviceNameInput}
                  onChange={e => setDeviceNameInput(e.target.value)}
                  className="flex-1 min-w-0 bg-[#0c0e15] border border-[#262b3d] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#E27D12]/60"
                />
                <button
                  type="button"
                  onClick={handleRenameDevice}
                  className="px-2.5 py-1.5 rounded-lg bg-[#1e2231] hover:bg-[#272c3f] border border-[#2e344b] text-xs text-gray-200 cursor-pointer"
                >
                  Save
                </button>
              </div>
              {snapshot.localDevice && (
                <div className="text-[11px] font-mono text-gray-500 truncate">
                  ID: {snapshot.localDevice.deviceId}
                </div>
              )}
            </div>

            <div className="bg-[#10131c] border border-[#232736] rounded-xl p-3.5 flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider text-gray-400">
                  LAN Listener
                </span>
                <span className="text-[11px] font-mono text-gray-300">
                  {snapshot.hostingPort ? `Port ${snapshot.hostingPort}` : 'Stopped'}
                </span>
              </div>
              <div className="text-[11px] text-gray-400 truncate">
                {snapshot.hostingIps.length > 0
                  ? `IPs: ${snapshot.hostingIps.join(', ')}`
                  : 'Start listener to receive sync requests'}
              </div>
              <button
                type="button"
                onClick={handleToggleHost}
                className="w-full px-3 py-1.5 rounded-lg bg-[#1e2231] hover:bg-[#272c3f] border border-[#2e344b] text-xs font-medium text-gray-200 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Server className="w-3.5 h-3.5 text-[#E27D12]" />
                <span>{snapshot.hostingPort ? 'Stop Host Listener' : 'Start Host Listener'}</span>
              </button>
            </div>
          </div>

          {/* Section Switcher */}
          <div className="flex items-center justify-between border-b border-[#232736] pb-3">
            <div className="inline-flex rounded-xl bg-[#0e1017] p-1 border border-[#232736]">
              <button
                type="button"
                onClick={() => setActiveSection('devices')}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                  activeSection === 'devices'
                    ? 'bg-[#1e2231] text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                Paired Devices ({pairedDevices.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveSection('pair')}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                  activeSection === 'pair'
                    ? 'bg-[#1e2231] text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                Pair New Device
              </button>
            </div>

            {activeSection === 'devices' && pairedDevices.length > 0 && (
              <button
                type="button"
                disabled={busyDeviceId !== null}
                onClick={handleSyncAll}
                className="px-3 py-1.5 rounded-lg bg-[#E27D12] hover:bg-[#f08b22] disabled:opacity-50 text-black font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${busyDeviceId === '__all__' ? 'animate-spin' : ''}`}
                />
                <span>Sync All</span>
              </button>
            )}
          </div>

          {/* Status / Error Feedback */}
          {(actionMessage || snapshot.error) && (
            <div
              className={`text-xs rounded-xl px-3.5 py-2.5 border ${
                snapshot.error
                  ? 'bg-amber-950/40 border-amber-500/30 text-amber-200'
                  : 'bg-[#10131c] border-[#262b3d] text-gray-300'
              }`}
            >
              {snapshot.error?.message || actionMessage}
            </div>
          )}

          {/* Content */}
          {activeSection === 'devices' ? (
            pairedDevices.length === 0 ? (
              <div className="bg-[#10131c] border border-[#232736] rounded-2xl p-6 text-center space-y-3">
                <Laptop className="w-8 h-8 text-gray-500 mx-auto" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-gray-200">No paired devices yet</p>
                  <p className="text-xs text-gray-400">
                    Pair another Veyview device on the same Wi-Fi network using a temporary QR code.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSection('pair')}
                  className="px-4 py-2 rounded-lg bg-[#E27D12] hover:bg-[#f08b22] text-black font-semibold text-xs cursor-pointer"
                >
                  Pair a Device
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {pairedDevices.map(device => (
                  <div
                    key={device.device_id}
                    className="bg-[#10131c] border border-[#232736] rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">
                        {device.device_name}
                      </div>
                      <div className="text-[11px] font-mono text-gray-400">
                        {device.last_ip
                          ? `${device.last_ip}:${device.last_port ?? 47890}`
                          : 'No cached IP'}
                        {' · '}
                        {device.last_synced_at
                          ? `Last synced ${new Date(device.last_synced_at).toLocaleString()}`
                          : 'Never synced'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busyDeviceId !== null}
                        onClick={() => handleSyncOne(device.device_id)}
                        className="px-3 py-1.5 rounded-lg bg-[#1e2231] hover:bg-[#272c3f] border border-[#2e344b] disabled:opacity-50 text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 text-[#E27D12] ${
                            busyDeviceId === device.device_id ? 'animate-spin' : ''
                          }`}
                        />
                        <span>Sync Now</span>
                      </button>
                      <button
                        type="button"
                        disabled={busyDeviceId !== null}
                        onClick={() => handleUnpair(device.device_id)}
                        aria-label={`Unpair ${device.device_name}`}
                        className="p-1.5 rounded-lg bg-transparent hover:bg-rose-950/50 border border-[#262b3d] hover:border-rose-500/40 text-gray-400 hover:text-rose-300 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <QrPairView
              activeSession={snapshot.activePairingSession}
              onPaired={async device => {
                await refreshDevices();
                setActionMessage(`Paired with ${device.device_name}.`);
                setActiveSection('devices');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
