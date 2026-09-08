import { Button, Field, Icon, IconButton, Input, StatusPill } from '@openbitfun/ui';
import { useEffect, useState, type ReactNode } from 'react';
import type { ConnectionResult, RemoteConnectStatus } from '@/infrastructure/api/service-api/RemoteConnectAPI';
import { useI18n } from '@/infrastructure/i18n';
import { normalizeRelayUrl, selectRemoteNetworkConnection } from '@/infrastructure/remote-connect/remoteConnectionState';
import { copyTextToClipboard } from '@/shared/utils/textSelection';
import { useNotification } from '@/shared/notification-system';
import { RemotePairingCard } from './RemotePairingCard';

interface RemoteNetworkConnectionsProps {
  status: RemoteConnectStatus | null;
  method: 'openbitfun_server' | 'custom_server';
  title: string;
  relayUrl: string;
  onRelayUrlChange: (url: string) => void;
  invitation: ConnectionResult | null;
  statusState: 'loading' | 'ready' | 'unavailable';
  loading: boolean;
  pairingUrlCopied: boolean;
  error: ReactNode;
  onCopyPairingUrl: () => Promise<void>;
  onConnect: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
  onDeploy: () => void;
}

/** Preset and custom relays share one card; only the address source differs. */
export function RemoteNetworkConnections({
  status, method, title, relayUrl, onRelayUrlChange, invitation, statusState,
  loading, pairingUrlCopied, error, onCopyPairingUrl, onConnect, onCancel,
  onDisconnect, onDeploy,
}: RemoteNetworkConnectionsProps) {
  const { t, formatNumber } = useI18n('common');
  const { error: notifyError } = useNotification();
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!copiedUrl) return;
    const timeout = window.setTimeout(() => setCopiedUrl(null), 2000);
    return () => window.clearTimeout(timeout);
  }, [copiedUrl]);
  const connection = selectRemoteNetworkConnection(status, invitation);
  const account = connection.accountConnected && connection.accountMethod === method
    && connection.accountRelayUrl === normalizeRelayUrl(relayUrl);
  const room = connection.roomConnected && connection.roomMethod === method;
  const clients = account ? status?.account_control_clients ?? [] : [];
  const unknown = account && (status?.account_control_clients === undefined || status.account_control_has_unidentified_clients !== false);
  const count = clients.length + (room ? 1 : 0);
  const connected = account || room;
  const copied = copiedUrl !== null && copiedUrl === normalizeRelayUrl(relayUrl);
  const copyUrl = async () => {
    const url = normalizeRelayUrl(relayUrl);
    if (!url) return;
    if (await copyTextToClipboard(url)) setCopiedUrl(url);
    else notifyError(t('remoteConnect.copyServerUrlFailed'));
  };

  return <div className="openbitfun-remote-connect__body openbitfun-remote-connect__body--network">
    <section
      className="openbitfun-remote-connect__network-card openbitfun-remote-connect__relay-card"
      data-openbitfun-component="remote-connect-dialog"
      data-openbitfun-part="connections"
      aria-label={title}
    >
      <div className="openbitfun-remote-connect__network-heading">
        <Icon name="browser" size="lg" aria-hidden="true" />
        <h3>{title}</h3>
      </div>
      <div className="openbitfun-remote-connect__relay-address">
        <Field controlWidth="fill" label={t('remoteConnect.serverUrl')}>
          <Input
            type="url"
            value={relayUrl}
            onValueChange={onRelayUrlChange}
            readOnly={method === 'openbitfun_server' || !!invitation || room || loading}
            placeholder="https://relay.example.com:9700"
            size="sm"
            trailing={<IconButton
              variant="quiet"
              size="sm"
              aria-label={copied ? t('remoteConnect.serverUrlCopied') : t('remoteConnect.copyServerUrl')}
              title={copied ? t('remoteConnect.serverUrlCopied') : t('remoteConnect.copyServerUrl')}
              disabled={!normalizeRelayUrl(relayUrl)}
              icon={<Icon name={copied ? 'check-line' : 'duplicate'} size="sm" />}
              onClick={() => void copyUrl()}
            />}
          />
        </Field>
      </div>
      <div className="openbitfun-remote-connect__connections-content">
        <div className="openbitfun-remote-connect__connections-heading">
          <h4 title={t('remoteConnect.clientCountHint')}>{t('remoteConnect.connectedClients')}</h4>
          <span role="status">
            <StatusPill tone={connected ? 'success' : 'neutral'}>{unknown
              ? count ? t('remoteConnect.clientCountAtLeast', { count, formattedCount: formatNumber(count) }) : t('remoteConnect.stateConnected')
              : t('remoteConnect.clientCount', { count, formattedCount: formatNumber(count) })}</StatusPill>
          </span>
        </div>
        {count > 0 && <ul className="openbitfun-remote-connect__connections-list" tabIndex={count > 3 ? 0 : undefined}>
          {clients.map((client, index) => <li key={client.id}>
            <Icon name="browser" size="sm" aria-hidden="true" />
            <strong>{client.name || t('remoteConnect.mobileBrowserTitle')}</strong>
            <span>{t('remoteConnect.clientNumber', { number: formatNumber(index + 1) })}</span>
          </li>)}
          {room && <li>
            <Icon name="browser" size="sm" aria-hidden="true" />
            <strong>{status?.peer_device_name || t('remoteConnect.mobileBrowserTitle')}</strong>
            <span>{t('remoteConnect.pairedClient')}</span>
          </li>}
        </ul>}
        {unknown && <p className="openbitfun-remote-connect__connections-note">{t('remoteConnect.clientDetailsUnavailable')}</p>}
        {!connected && <p className="openbitfun-remote-connect__connections-note">{t('remoteConnect.noConnectedClients')}</p>}
      </div>
      {invitation && <div className="openbitfun-remote-connect__relay-invitation">
        <RemotePairingCard
          owner="network"
          qrUrl={invitation.qr_url}
          connected={connection.invitationAccountConnected}
          copied={pairingUrlCopied}
          statusState={statusState}
          onCopyUrl={onCopyPairingUrl}
        />
      </div>}
      <div className="openbitfun-remote-connect__relay-actions">
        {error}
        <div className="openbitfun-remote-connect__relay-action-row">
          <Button variant="text" size="sm" onClick={onDeploy}>{t('remoteConnect.desc_custom_server_link')}</Button>
          {room ? <Button variant="outline" size="sm" onClick={onDisconnect}>{t('remoteConnect.disconnect')}</Button>
            : invitation ? <Button variant="outline" size="sm" onClick={onCancel}>{t('remoteConnect.cancelInvitation')}</Button>
              : <Button variant="fill" size="sm" loading={loading} onClick={onConnect}>
                {loading ? t('remoteConnect.connecting') : t('remoteConnect.showConnectionCode')}
              </Button>}
        </div>
        {account && invitation && <p className="openbitfun-remote-connect__connections-note">{t('remoteConnect.accountConnectedHint')}</p>}
      </div>
    </section>
  </div>;
}
