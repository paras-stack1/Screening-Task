import type { AreaNode, FacilitySummary } from '@balswasthya/shared-contracts';
import { FACILITY_TYPES } from '@balswasthya/shared-contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, Button, Loading, SelectField, TextField } from '../../components/ui';
import { errorMessageKey, useI18n, type TranslationKey } from '../../i18n';
import { AreaPicker } from '../users/AreaPicker';
import { useCreateFacility, useFacilityList } from './api';

export const facilityTypeKey = (type: string) => `facility.type.${type}` as TranslationKey;

/** Facility directory in the administrator's areas (facility.manage). No child data. */
export function FacilitiesPage() {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const list = useFacilityList(search);
  // Search as you type, after a short pause; Enter applies it at once.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(draft.trim()), 300);
    return () => clearTimeout(timer);
  }, [draft]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSearch(draft.trim());
  };
  return (
    <>
      <h1>{t('facility.title')}</h1>
      <p className="muted">{t('facility.intro')}</p>
      <form className="filters" onSubmit={submit} role="search">
        <TextField label={t('facility.search')} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Link className="btn btn-primary" to="/facilities/new">
          {t('facility.add')}
        </Link>
      </form>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Alert tone="error">{t(errorMessageKey(list.error))}</Alert>
      ) : list.data.items.length === 0 ? (
        <p className="muted">{t('facility.empty')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('facility.name')}</th>
              <th>{t('facility.typeLabel')}</th>
              <th>{t('facility.area')}</th>
              <th>{t('facility.status')}</th>
            </tr>
          </thead>
          <tbody>
            {list.data.items.map((f) => (
              <tr key={f.id}>
                <td>
                  <Link to={`/facilities/${f.id}`}>{f.name}</Link>
                  {f.officialCode ? <div className="muted">{f.officialCode}</div> : null}
                </td>
                <td>{t(facilityTypeKey(f.type))}</td>
                <td>{f.areaPath.join(' / ')}</td>
                <td>{statusLine(t, f)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function statusLine(
  t: (k: TranslationKey) => string,
  f: Pick<FacilitySummary, 'isActive' | 'verificationStatus' | 'acceptsReferrals'>,
) {
  return [
    t(f.isActive ? 'facility.active' : 'facility.inactive'),
    t(f.verificationStatus === 'VERIFIED' ? 'facility.verified' : 'facility.unverified'),
    t(f.acceptsReferrals ? 'facility.accepts' : 'facility.notAccepting'),
  ].join(' · ');
}

/** New facility: always created as not verified and not accepting referrals (decision P). */
export function CreateFacilityPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const create = useCreateFacility();
  const [area, setArea] = useState<AreaNode | null>(null);
  const [form, setForm] = useState({
    name: '',
    nameHi: '',
    officialCode: '',
    type: '',
    address: '',
    contactPhone: '',
  });
  const [missing, setMissing] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.type || !area) return setMissing(true);
    setMissing(false);
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    create.mutate(
      {
        name: form.name.trim(),
        nameHi: opt(form.nameHi),
        officialCode: opt(form.officialCode),
        type: form.type as (typeof FACILITY_TYPES)[number],
        areaId: area.id,
        address: opt(form.address),
        contactPhone: opt(form.contactPhone),
      },
      { onSuccess: (res) => void navigate(`/facilities/${res.facility.id}`) },
    );
  };
  return (
    <>
      <h1>{t('facility.add')}</h1>
      <Alert tone="info">{t('facility.createNote')}</Alert>
      <form className="form" onSubmit={submit} noValidate>
        <TextField label={t('facility.name')} value={form.name} onChange={set('name')} required />
        <TextField label={t('facility.nameHi')} value={form.nameHi} onChange={set('nameHi')} />
        <TextField
          label={t('facility.officialCode')}
          hint={t('facility.officialCodeHint')}
          value={form.officialCode}
          onChange={set('officialCode')}
        />
        <SelectField label={t('facility.typeLabel')} value={form.type} onChange={set('type')} required>
          <option value="">{t('facility.chooseType')}</option>
          {FACILITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(facilityTypeKey(type))}
            </option>
          ))}
        </SelectField>
        <AreaPicker label={t('facility.area')} value={area} onChange={setArea} />
        <TextField label={t('facility.address')} value={form.address} onChange={set('address')} />
        <TextField
          label={t('facility.phone')}
          hint={t('facility.phoneHint')}
          value={form.contactPhone}
          onChange={set('contactPhone')}
        />
        {missing ? <Alert tone="error">{t('facility.required')}</Alert> : null}
        {create.error ? <Alert tone="error">{t(errorMessageKey(create.error))}</Alert> : null}
        <Button type="submit" busy={create.isPending}>
          {t('facility.create')}
        </Button>
      </form>
    </>
  );
}
