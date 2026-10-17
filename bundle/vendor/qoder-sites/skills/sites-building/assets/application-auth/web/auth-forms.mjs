const base = '/functions/v1/app/auth';
export async function configureAuthForms(document, { fetch: transport = globalThis.fetch, origin = globalThis.location.origin } = {}) {
  const forms = [...document.querySelectorAll('form[data-auth]')];
  const error = document.querySelector('[role="alert"]');
  const showError = () => { if (error) error.textContent = '登录暂时不可用，请刷新重试。'; };
  for (const form of forms) {
    form.querySelector('button').disabled = true;
    form.method = 'post';
    // Reacquire CSRF on every explicit submission, never fetch the redirecting POST.
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button');
      if (button.disabled) return;
      button.disabled = true;
      try {
        const response = await transport(`${base}/csrf`, { credentials: 'same-origin', cache: 'no-store' });
        const body = await response.json();
        if (!response.ok || typeof body.csrfToken !== 'string' || !body.csrfToken) throw new Error('csrf_unavailable');
        form.elements.namedItem('csrfToken').value = body.csrfToken;
        form.elements.namedItem('callbackUrl').value = `${origin}/`;
        // Native navigation carries Set-Cookie and follows the provider's 302.
        document.defaultView.HTMLFormElement.prototype.submit.call(form);
      } catch { showError(); button.disabled = false; }
    });
  }
  try {
    const response = await transport(`${base}/providers`, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('providers_unavailable');
    const providers = await response.json();
    for (const form of forms) {
      const provider = form.dataset.auth;
      form.hidden = provider !== 'signout' && !Object.hasOwn(providers, provider);
      form.querySelector('button').disabled = false;
    }
  } catch { showError(); }
}
