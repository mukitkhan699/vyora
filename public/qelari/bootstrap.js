'use strict';

async function startQelari() {
  const status = document.getElementById('accessStatus');
  if (status) status.hidden = false;
  try {
    const response = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Sign in to Zunari to use Qelari.');
    const session = await response.json();
    const accountId = session?.authenticated && session?.user?.id != null
      ? String(session.user.id)
      : '';
    if (!accountId || typeof session.csrfToken !== 'string') {
      throw new Error('Sign in to Zunari to use Qelari.');
    }

    window.QELARI_ACCOUNT_ID = accountId;
    window.QELARI_CSRF_TOKEN = session.csrfToken;
    document.body.classList.remove('auth-pending');
    status?.remove();

    const script = document.createElement('script');
    script.src = '/qelari/app.js';
    script.onerror = () => {
      if (status) {
        status.textContent = 'Qelari could not be loaded. Refresh the page to try again.';
        status.hidden = false;
        document.body.appendChild(status);
      }
    };
    document.body.appendChild(script);
  } catch (error) {
    if (status) {
      status.textContent = error instanceof Error ? error.message : 'Sign in to Zunari to use Qelari.';
      status.hidden = false;
    }
  }
}

void startQelari();
