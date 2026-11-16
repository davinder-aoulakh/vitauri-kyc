// A page shown inside another page (a dashboard tab, a Tenant Config tab) must not draw the app shell again.
// AppShell reads this context and renders only its children when it is true.
import { createContext } from 'react';

export const EmbeddedContext = createContext(false);
