import { useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Alert, Button, Loading } from '../../components/ui';
import { errorMessageKey, useI18n, type TranslationKey } from '../../i18n';
import { areaLabel, roleLabel } from '../users/format';
import { ASSIGNMENTS_PAGE_SIZE, useAssignmentList, type AssignmentListParams } from './api';
import { AssignmentActions } from './AssignmentActions';
import { AssignmentPeriod, AssignmentStatus } from './AssignmentStatus';

const STATUSES = ['ACTIVE', 'SUSPENDED', 'REVOKED'] as const;
type Status = (typeof STATUSES)[number];
const isStatus = (v: string | null): v is Status => v !== null && (STATUSES as readonly string[]).includes(v);

/**
 * Assignments in the administrator's areas (GET /assignments). The main page for supervisors,
 * who manage assignments but not accounts. Filters live in the address.
 */
export function AssignmentsPage({ canManageUsers }: { canManageUsers: boolean }) {
  const { t, language } = useI18n();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const status = params.get('status');
  const include = params.get('include') === 'all' ? 'all' : 'current';
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const [draft, setDraft] = useState(search);
  const location = useLocation();
  const [done, setDone] = useState<TranslationKey | null>(() =>
    (location.state as { added?: boolean } | null)?.added ? 'assignment.added' : null,
  );

  const query: AssignmentListParams = {
    search: search.length >= 2 ? search : undefined,
    status: isStatus(status) ? status : undefined,
    include,
    page,
  };
  const list = useAssignmentList(query);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    update({ q: text.length >= 2 ? text : null, page: null });
  };
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / ASSIGNMENTS_PAGE_SIZE)) : 1;

  return (
    <>
      <h1>{t('assignments.title')}</h1>
      <p className="muted">{t('assignments.intro')}</p>
      {done && <Alert tone="success">{t(done)}</Alert>}

      <form className="filters" onSubmit={submitSearch} role="search">
        <div className="field">
          <label htmlFor="assignment-search">{t('users.searchLabel')}</label>
          <input
            id="assignment-search"
            type="search"
            value={draft}
            maxLength={64}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="assignment-status">{t('users.statusFilter')}</label>
          <select
            id="assignment-status"
            value={isStatus(status) ? status : ''}
            onChange={(event) => update({ status: event.target.value || null, page: null })}
          >
            <option value="">{t('users.statusAll')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="assignment-include">{t('assignments.include')}</label>
          <select
            id="assignment-include"
            value={include}
            onChange={(event) => update({ include: event.target.value === 'all' ? 'all' : null, page: null })}
          >
            <option value="current">{t('assignments.include.current')}</option>
            <option value="all">{t('assignments.include.all')}</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          {t('users.searchSubmit')}
        </Button>
      </form>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Alert tone="error">{t(errorMessageKey(list.error))}</Alert>
      ) : list.data.items.length === 0 ? (
        <p className="muted">{t('assignments.empty')}</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('assignments.col.person')}</th>
                  <th scope="col">{t('detail.col.role')}</th>
                  <th scope="col">{t('detail.col.area')}</th>
                  <th scope="col">{t('detail.col.status')}</th>
                  <th scope="col">{t('detail.col.period')}</th>
                  <th scope="col">{t('assignments.col.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((a) => {
                  const area = areaLabel(language, a.areaName, a.areaNameHi);
                  const role = roleLabel(t, a.roleCode);
                  return (
                    <tr key={a.id}>
                      <td>
                        {canManageUsers ? (
                          <Link to={`/users/${a.user.id}`}>{a.user.displayName}</Link>
                        ) : (
                          a.user.displayName
                        )}
                        <div className="muted small">
                          <code>{a.user.loginId}</code>
                        </div>
                      </td>
                      <td>{role}</td>
                      <td>
                        {area}
                        <div className="muted small">{t(`scope.${a.scope}`)}</div>
                      </td>
                      <td>
                        <AssignmentStatus assignment={a} />
                      </td>
                      <td>
                        <AssignmentPeriod assignment={a} />
                      </td>
                      <td>
                        <AssignmentActions
                          assignment={a}
                          label={t('assignment.actionsFor', { role, area })}
                          onDone={setDone}
                        />
                        {a.user.status !== 'DEACTIVATED' && (
                          <Link
                            className="small"
                            to={`/assignments/new?userId=${encodeURIComponent(a.user.id)}&name=${encodeURIComponent(a.user.displayName)}`}
                          >
                            {t('assignments.addForPerson', { name: a.user.displayName })}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span>{t('assignments.page', { page, pages, total: list.data.total })}</span>
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() => update({ page: String(page - 1) })}
            >
              {t('users.previous')}
            </Button>
            <Button
              variant="secondary"
              disabled={page >= pages}
              onClick={() => update({ page: String(page + 1) })}
            >
              {t('users.next')}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
