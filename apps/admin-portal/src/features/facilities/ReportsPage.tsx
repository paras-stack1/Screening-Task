import type { AggregateReportQuery, AreaNode } from '@balswasthya/shared-contracts';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Loading, TextField } from '../../components/ui';
import { errorMessageKey, useI18n, type TranslationKey } from '../../i18n';
import { AreaPicker } from '../users/AreaPicker';
import { useAggregateReport } from './api';

type Count = { value: number | null; suppressed: boolean };
const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const monthAgo = () => new Date(Date.now() + 5.5 * 3_600_000 - 30 * 86_400_000).toISOString().slice(0, 10);

/**
 * Aggregate referral and screening counts for an area in the administrator's scope
 * (report.aggregate). No child is listed. Counts from 1 to 4 are hidden ("fewer than 5").
 * Every number is defined in docs/step-7/api-documentation.md; issued, acknowledged, visited and
 * closed are separate counts.
 */
export function ReportsPage() {
  const { t } = useI18n();
  const [area, setArea] = useState<AreaNode | null>(null);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState<AggregateReportQuery | null>(null);
  const report = useAggregateReport(query);
  const show = (c: Count) => (c.suppressed ? t('report.fewerThan', { n: 5 }) : String(c.value));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (area) setQuery({ areaId: area.id, from, to });
  };
  const r = report.data?.report;
  const rows: Array<[TranslationKey, Count]> = r
    ? [
        ['report.screeningsCompleted', r.screeningsCompleted],
        ['report.referralsCreated', r.referralsCreated],
        ['report.referralsIssued', r.referralsIssued],
        ['report.referralsAcknowledged', r.referralsAcknowledged],
        ['report.visitsRecorded', r.visitsRecorded],
        ['report.referralsClosed', r.referralsClosed],
        ['report.followUpsOverdue', r.followUpsOverdue],
      ]
    : [];
  return (
    <>
      <h1>{t('report.title')}</h1>
      <p className="muted">{t('report.intro')}</p>
      <form className="form" onSubmit={submit}>
        <AreaPicker label={t('report.area')} value={area} onChange={setArea} />
        <TextField
          label={t('report.from')}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField label={t('report.to')} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button type="submit" disabled={!area}>
          {t('report.show')}
        </Button>
      </form>
      {query === null ? null : report.isPending ? (
        <Loading />
      ) : report.isError ? (
        <Alert tone="error">{t(errorMessageKey(report.error))}</Alert>
      ) : r ? (
        <>
          <h2>{t('report.heading', { area: r.areaName, from: r.from, to: r.to })}</h2>
          <table aria-label={t('report.title')}>
            <tbody>
              {rows.map(([key, count]) => (
                <tr key={key}>
                  <th scope="row">{t(key)}</th>
                  <td>{show(count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>{t('report.byCategory')}</h2>
          <table>
            <tbody>
              {r.byCategory.map((c) => (
                <tr key={c.category}>
                  <th scope="row">{t(`report.category.${c.category}` as TranslationKey)}</th>
                  <td>{show(c.referralsCreated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.bySubArea.length > 0 ? (
            <>
              <h2>{t('report.bySubArea')}</h2>
              <table>
                <thead>
                  <tr>
                    <th>{t('report.area')}</th>
                    <th>{t('report.referralsCreated')}</th>
                    <th>{t('report.referralsIssued')}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.bySubArea.map((s) => (
                    <tr key={s.areaId}>
                      <td>{s.areaName}</td>
                      <td>{show(s.referralsCreated)}</td>
                      <td>{show(s.referralsIssued)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          <p className="muted">{t('report.suppressionNote', { n: r.suppressionThreshold })}</p>
        </>
      ) : null}
    </>
  );
}
