import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { useI18n, type TranslationKey } from '../i18n';

/** Small accessible building blocks. Styling lives in src/styles.css. */

export function Button({
  variant = 'primary',
  busy = false,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'link'; busy?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`btn btn-${variant}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {children}
    </button>
  );
}

export function Alert({
  tone,
  children,
  testId,
}: {
  tone: 'error' | 'info' | 'success' | 'warning';
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'} data-testid={testId}>
      {children}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label ?? t('common.loading')}</span>
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  /** Translation key of the validation message, as produced by the zod schemas. */
  errorKey?: string;
};

/** Labelled input with hint and error wired to aria-describedby / aria-invalid. */
export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField(
  { label, hint, errorKey, id, ...rest },
  ref,
) {
  const { t } = useI18n();
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = errorKey ? `${inputId}-error` : undefined;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={errorKey ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
      {errorKey && (
        <p className="field-error" id={errorId}>
          {t(errorKey as TranslationKey)}
        </p>
      )}
    </div>
  );
});
