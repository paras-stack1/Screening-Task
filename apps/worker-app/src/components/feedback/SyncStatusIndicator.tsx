import { useTranslation, type TranslationKey } from '../../localization';
import type { IconName } from '../common/AppIcon';
import { StatusBadge, type StatusTone } from './StatusBadge';

/**
 * Connection / synchronisation status. Only `online` and `offline` are used in this phase; the
 * sync states exist for the future offline module and must only be shown once a real sync
 * operation reports them (never claim "synced" without one).
 */
export type SyncStatus = 'online' | 'offline' | 'syncPending' | 'syncing' | 'syncFailed';

const STATUS: Record<SyncStatus, { label: TranslationKey; tone: StatusTone; icon: IconName }> = {
  online: { label: 'connectivity.online', tone: 'success', icon: 'cloud-check-outline' },
  offline: { label: 'connectivity.offline', tone: 'warning', icon: 'wifi-off' },
  syncPending: { label: 'connectivity.syncPending', tone: 'info', icon: 'cloud-sync-outline' },
  syncing: { label: 'connectivity.syncing', tone: 'info', icon: 'sync' },
  syncFailed: { label: 'connectivity.syncFailed', tone: 'danger', icon: 'cloud-alert-outline' },
};

export function SyncStatusIndicator({ status }: { status: SyncStatus }) {
  const { t } = useTranslation();
  const config = STATUS[status];
  return <StatusBadge label={t(config.label)} tone={config.tone} icon={config.icon} />;
}
