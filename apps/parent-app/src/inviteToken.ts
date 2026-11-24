import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function fromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const hash = url.indexOf('#');
  if (hash < 0) return null;
  const token = url.slice(hash + 1);
  return TOKEN.test(token) ? token : null;
}

/**
 * Reads the invitation token from the link fragment (`/invite#<token>`). The fragment is never
 * sent to any server by the browser, so the token does not reach access logs. On the web the
 * fragment is then removed from the address bar and history, so it is not left behind.
 */
export async function readInviteToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    const loc = globalThis.location;
    const token = fromUrl(loc?.href);
    if (token && globalThis.history?.replaceState) {
      globalThis.history.replaceState(null, '', `${loc.pathname}${loc.search}`);
    }
    return token;
  }
  return fromUrl(await Linking.getInitialURL());
}
