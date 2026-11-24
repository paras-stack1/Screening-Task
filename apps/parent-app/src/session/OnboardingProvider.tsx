import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Invitation flow state (link token, masked number, activation ticket). MEMORY ONLY: never
 * written to storage, the address bar or logs. Closing the app means opening the link again.
 */
interface Onboarding {
  token: string | null;
  maskedPhone: string | null;
  ticket: string | null;
  setInvitation(token: string, maskedPhone: string): void;
  setTicket(ticket: string): void;
  reset(): void;
}

const OnboardingContext = createContext<Onboarding | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [ticket, setTicketState] = useState<string | null>(null);
  const value = useMemo<Onboarding>(
    () => ({
      token,
      maskedPhone,
      ticket,
      setInvitation(t, phone) {
        setToken(t);
        setMaskedPhone(phone);
        setTicketState(null);
      },
      setTicket: setTicketState,
      reset() {
        setToken(null);
        setMaskedPhone(null);
        setTicketState(null);
      },
    }),
    [maskedPhone, ticket, token],
  );
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): Onboarding {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error('useOnboarding outside OnboardingProvider');
  return value;
}
