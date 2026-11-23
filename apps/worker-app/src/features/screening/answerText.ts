import type { ScreeningQuestion, ScreeningResponse } from '@balswasthya/shared-contracts';
import type { TranslateFn, TranslationKey } from '../../localization';
import { localized } from './labels';

/** The recorded answer in plain words. Unknown / not assessed are shown as such, never as "No". */
export function answerText(
  t: TranslateFn,
  language: string,
  question: ScreeningQuestion,
  response: Pick<ScreeningResponse, 'status' | 'value' | 'notAssessedReason'>,
): string {
  if (response.status !== 'ANSWERED') {
    const state = t(`screening.question.state.${response.status}` as TranslationKey);
    return response.notAssessedReason ? `${state} – ${response.notAssessedReason}` : state;
  }
  const value = response.value;
  const option = (code: string) => {
    const found = question.options?.find((o) => o.code === code);
    return found ? localized(found.label, language) : code;
  };
  switch (question.answerType) {
    case 'YES_NO':
      return t(value ? 'screening.question.yes' : 'screening.question.no');
    case 'NUMBER':
      return question.validation?.unit ? `${String(value)} ${question.validation.unit}` : String(value);
    case 'SINGLE_CHOICE':
      return option(String(value));
    case 'MULTI_CHOICE':
      return (Array.isArray(value) ? value : []).map(option).join(', ');
    case 'TEXT':
      return String(value);
  }
}
