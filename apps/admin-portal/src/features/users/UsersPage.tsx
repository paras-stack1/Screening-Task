import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Button, Loading, StatusBadge } from '../../components/ui';
import { errorMessageKey, useI18n } from '../../i18n';
import { USERS_PAGE_SIZE, useUserList, type UserListParams } from './api';
import { areaLabel, formatDateTime, roleLabel } from './format';

const STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
type Status = (typeof STATUSES)[number];

function isStatus(value: string | null): value is Status {
  return value !== null && (STATUSES as readonly string[]).includes(value);
}

/** Search, filter and page state live in the URL, so "back" and reload keep them. */
export function UsersPage({ canManageUsers }: { canManageUsers: boolean }) {
  const { t, language } = useI18n();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const status = params.get('status');
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const [draft, setDraft] = useState(search);

  const query: UserListParams = {
    search: search.length >= 2 ? search : undefined,
    status: isStatus(status) ? status : undefined,
    page,
  };
  // Accounts without user.manage would only get a refused (and audited) request.
  const users = useUserList(query, canManageUsers);

  if (!canManageUsers) {
    return (
      <>
        <h1>{t('users.title')}</h1>
        <Alert tone="info">{t('users.noUserManage')}</Alert>
      </>
    );
  }

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

  const pages = users.data ? Math.max(1, Math.ceil(users.data.total / USERS_PAGE_SIZE)) : 1;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('users.title')}</h1>
          <p className="muted">{t('users.intro')}</p>
        </div>
        <Link className="btn btn-primary" to="/users/new">
          {t('users.create')}
        </Link>
      </div>

      <form className="filters" onSubmit={submitSearch} role="search">
        <div className="field">
          <label htmlFor="user-search">{t('users.searchLabel')}</label>
          <input
            id="user-search"
            type="search"
            value={draft}
            minLength={2}
            maxLength={64}
            aria-describedby="user-search-hint"
            onChange={(event) => setDraft(event.target.value)}
          />
          <p className="field-hint" id="user-search-hint">
            {t('users.searchHint')}
          </p>
        </div>
        <div className="field">
          <label htmlFor="user-status">{t('users.statusFilter')}</label>
          <select
            id="user-status"
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
        <div className="button-row">
          <Button type="submit" variant="secondary">
            {t('users.searchSubmit')}
          </Button>
          {(search || status) && (
            <Button
              variant="link"
              onClick={() => {
                setDraft('');
                update({ q: null, status: null, page: null });
              }}
            >
              {t('users.searchClear')}
            </Button>
          )}
        </div>
      </form>

      {users.isPending ? (
        <Loading />
      ) : users.isError ? (
        <Alert tone="error">{t(errorMessageKey(users.error))}</Alert>
      ) : users.data.items.length === 0 ? (
        <p className="muted">{t('users.empty')}</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('users.col.name')}</th>
                  <th scope="col">{t('users.col.loginId')}</th>
                  <th scope="col">{t('users.col.roles')}</th>
                  <th scope="col">{t('users.col.status')}</th>
                  <th scope="col">{t('users.col.lastLogin')}</th>
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <Link to={`/users/${user.id}`}>{user.displayName}</Link>
                    </td>
                    <td>
                      <code>{user.loginId}</code>
                    </td>
                    <td>
                      <ul className="plain-list">
                        {user.currentAssignments.map((a, index) => (
                          <li key={index}>
                            {roleLabel(t, a.roleCode)} · {areaLabel(language, a.areaName, a.areaNameHi)}
                            {a.status === 'SUSPENDED' && (
                              <>
                                {' '}
                                <StatusBadge status="SUSPENDED" />
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      <StatusBadge status={user.status} />
                      {user.mustChangePassword && <div className="muted small">{t('users.mustChange')}</div>}
                    </td>
                    <td>
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt, language) : t('users.never')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span>{t('users.page', { page, pages, total: users.data.total })}</span>
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
