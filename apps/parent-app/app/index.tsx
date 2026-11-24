import { Redirect } from 'expo-router';
import { useSession } from '../src/session/SessionProvider';

export default function Index() {
  const { state } = useSession();
  return <Redirect href={state.status === 'signedIn' ? '/home' : '/login'} />;
}
