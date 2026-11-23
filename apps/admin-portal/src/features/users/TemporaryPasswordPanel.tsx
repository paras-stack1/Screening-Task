import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui';
import { useI18n } from '../../i18n';

/**
 * Shows a one-time password exactly once (account creation or password reset). The value lives
 * only in the calling page's state: leaving the page loses it, by design. It is never logged,
 * cached or stored by the portal.
 */
export function TemporaryPasswordPanel({
  loginId,
  name,
  password,
  onDone,
}: {
  loginId: string;
  name: string;
  password: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      // Clipboard unavailable (permissions, insecure context): the password stays visible to copy by hand.
    }
  };

  return (
    <section className="card temp-password" role="region" aria-labelledby="temp-password-title">
      <h2 id="temp-password-title" ref={heading} tabIndex={-1}>
        {t('tempPassword.title', { loginId })}
      </h2>
      <p>{t('tempPassword.body', { name })}</p>
      <p className="password-value" data-testid="temporary-password" translate="no">
        {password}
      </p>
      <div className="button-row">
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? t('tempPassword.copied') : t('tempPassword.copy')}
        </Button>
        <Button onClick={onDone}>{t('tempPassword.done')}</Button>
      </div>
    </section>
  );
}
