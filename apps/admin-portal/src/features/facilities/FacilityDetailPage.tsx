import type { FacilityDetail } from '@balswasthya/shared-contracts';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { Alert, Button, Loading, TextField } from '../../components/ui';
import { errorMessageKey, useI18n } from '../../i18n';
import { useFacility, useFacilityAction, type FacilityAction } from './api';
import { facilityTypeKey, statusLine } from './FacilitiesPage';

/**
 * One facility: details, change history and the administrator's actions. Every action carries
 * the version shown (409 = changed elsewhere, the page reloads) and a reason where required.
 */
export function FacilityDetailPage() {
  const { t } = useI18n();
  const { facilityId = '' } = useParams();
  const facility = useFacility(facilityId);
  if (facility.isPending) return <Loading />;
  if (facility.isError) return <Alert tone="error">{t(errorMessageKey(facility.error))}</Alert>;
  return <FacilityView f={facility.data.facility} />;
}

function FacilityView({ f }: { f: FacilityDetail }) {
  const { t } = useI18n();
  const action = useFacilityAction(f.id);
  const [done, setDone] = useState(false);
  const run = (a: FacilityAction) => {
    setDone(false);
    action.mutate(a, { onSuccess: () => setDone(true) });
  };
  return (
    <>
      <h1>{f.name}</h1>
      <p className="muted">
        {t(facilityTypeKey(f.type))} · {f.areaPath.join(' / ')}
        {f.officialCode ? ` · ${f.officialCode}` : ''}
      </p>
      <p data-testid="facility-status">{statusLine(t, f)}</p>
      {f.verificationStatus === 'VERIFIED' ? (
        <p className="muted">
          {t('facility.verifiedBy', {
            name: f.verifiedByName ?? '-',
            reference: f.verificationReference ?? '-',
          })}
        </p>
      ) : null}
      {f.services.length > 0 ? (
        <p>{t('facility.servicesLine', { services: f.services.join(', ') })}</p>
      ) : null}
      {f.address ? <p>{f.address}</p> : null}
      {f.contactPhone ? <p>{t('facility.phoneLine', { phone: f.contactPhone })}</p> : null}
      {done ? <Alert tone="success">{t('facility.saved')}</Alert> : null}
      {action.error ? <Alert tone="error">{t(errorMessageKey(action.error))}</Alert> : null}

      {f.canManage ? (
        <>
          <EditForm f={f} busy={action.isPending} onSubmit={run} />
          <VerifyForm f={f} busy={action.isPending} onSubmit={run} />
          {f.verificationStatus === 'VERIFIED' ? (
            <ReasonForm
              title={t('facility.unverify')}
              busy={action.isPending}
              onSubmit={(reason) => run({ kind: 'unverify', body: { expectedVersion: f.version, reason } })}
            />
          ) : null}
          {f.isActive ? (
            <ReasonForm
              title={t('facility.deactivate')}
              busy={action.isPending}
              onSubmit={(reason) => run({ kind: 'deactivate', body: { expectedVersion: f.version, reason } })}
            />
          ) : (
            <ReasonForm
              title={t('facility.reactivate')}
              busy={action.isPending}
              onSubmit={(reason) => run({ kind: 'reactivate', body: { expectedVersion: f.version, reason } })}
            />
          )}
        </>
      ) : (
        <Alert tone="info">{t('facility.readOnly')}</Alert>
      )}

      <h2>{t('facility.history')}</h2>
      <table>
        <thead>
          <tr>
            <th>{t('facility.when')}</th>
            <th>{t('facility.what')}</th>
            <th>{t('facility.who')}</th>
            <th>{t('facility.reason')}</th>
          </tr>
        </thead>
        <tbody>
          {f.history.map((h, i) => (
            <tr key={`${h.occurredAt}-${i}`}>
              <td>{new Date(h.occurredAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
              <td>
                {t(`facility.action.${h.action}` as Parameters<typeof t>[0])}
                <div className="muted">{JSON.stringify(h.changes)}</div>
              </td>
              <td>{h.actorName}</td>
              <td>{h.reason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function EditForm({
  f,
  busy,
  onSubmit,
}: {
  f: FacilityDetail;
  busy: boolean;
  onSubmit: (a: FacilityAction) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(f.name);
  const [address, setAddress] = useState(f.address ?? '');
  const [phone, setPhone] = useState(f.contactPhone ?? '');
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      kind: 'update',
      body: {
        expectedVersion: f.version,
        ...(name.trim() !== f.name ? { name: name.trim() } : {}),
        ...(address.trim() !== (f.address ?? '') ? { address: address.trim() || null } : {}),
        ...(phone.trim() !== (f.contactPhone ?? '') ? { contactPhone: phone.trim() || null } : {}),
        reason: reason.trim(),
      },
    });
  };
  return (
    <form className="form" onSubmit={submit} aria-label={t('facility.edit')}>
      <h2>{t('facility.edit')}</h2>
      <TextField label={t('facility.name')} value={name} onChange={(e) => setName(e.target.value)} />
      <TextField label={t('facility.address')} value={address} onChange={(e) => setAddress(e.target.value)} />
      <TextField label={t('facility.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <TextField
        label={t('facility.reason')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
      />
      <Button type="submit" busy={busy}>
        {t('facility.saveEdit')}
      </Button>
    </form>
  );
}

function VerifyForm({
  f,
  busy,
  onSubmit,
}: {
  f: FacilityDetail;
  busy: boolean;
  onSubmit: (a: FacilityAction) => void;
}) {
  const { t } = useI18n();
  const [reference, setReference] = useState('');
  const [services, setServices] = useState(f.services.join(', '));
  const [accepts, setAccepts] = useState(f.acceptsReferrals);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      kind: 'verify',
      body: {
        expectedVersion: f.version,
        verificationReference: reference.trim(),
        services: services
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
        acceptsReferrals: accepts,
      },
    });
  };
  return (
    <form className="form" onSubmit={submit} aria-label={t('facility.verify')}>
      <h2>{t('facility.verify')}</h2>
      <p className="muted">{t('facility.verifyNote')}</p>
      <TextField
        label={t('facility.verificationReference')}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        required
      />
      <TextField
        label={t('facility.services')}
        hint={t('facility.servicesHint')}
        value={services}
        onChange={(e) => setServices(e.target.value)}
      />
      <label className="checkbox">
        <input type="checkbox" checked={accepts} onChange={(e) => setAccepts(e.target.checked)} />{' '}
        {t('facility.acceptsLabel')}
      </label>
      <Button type="submit" busy={busy}>
        {t('facility.verify')}
      </Button>
    </form>
  );
}

function ReasonForm({
  title,
  busy,
  onSubmit,
}: {
  title: string;
  busy: boolean;
  onSubmit: (reason: string) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  return (
    <form
      className="form"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(reason.trim());
      }}
    >
      <h2>{title}</h2>
      <TextField
        label={t('facility.reason')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
      />
      <Button type="submit" variant="secondary" busy={busy}>
        {title}
      </Button>
    </form>
  );
}
